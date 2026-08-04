/**
 * The real provider call, for the three protocols the registry knows.
 *
 * `fetch` and the environment both arrive as arguments, which is the whole
 * reason the tests below can drive Anthropic's, OpenAI's, and the
 * chat-completions wire shapes without a network or a live key.
 *
 * Two rules hold everywhere in this file. The credential is read from the
 * inherited environment at the moment of the call and goes into exactly one
 * request header — it is never stored on an object, never written to a message,
 * and never part of an error. And every failure becomes one of the stable
 * `EngineError` codes with a fixed message, so a response body, a URL, or a
 * provider's own prose can never travel back out through a diagnostic.
 */

import { EngineError, type ModelMessage, type ModelResponse, type ModelTransport, type ToolCall, type ToolDefinition } from './runtime.js'
import type { ProviderProtocol, ResolvedProvider } from './providers.js'

/** Anthropic's dated API contract. The only version this speaks. */
export const ANTHROPIC_VERSION = '2023-06-01'
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096
/** A reply larger than this is a malfunction, not a long answer. */
export const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024

const PROTOCOL_PATHS: Readonly<Record<ProviderProtocol, string>> = Object.freeze({
  messages: '/v1/messages',
  responses: '/responses',
  chat_completions: '/chat/completions',
})

export interface HttpResponse {
  readonly ok: boolean
  readonly status: number
  text(): Promise<string>
}

export interface HttpRequest {
  readonly method: 'POST'
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  readonly signal: AbortSignal
}

/** Structurally satisfied by the platform `fetch`, and by a test double. */
export type HttpFetch = (url: string, request: HttpRequest) => Promise<HttpResponse>

export interface ProviderTransportOptions {
  readonly fetch: HttpFetch
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly maxOutputTokens?: number
  readonly maxResponseBytes?: number
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failed(code: EngineError['code'], message: string): never {
  throw new EngineError(code, message)
}

/**
 * Own properties only, for the same reason `requireApiKeyEnvironment` does it: a
 * legal environment name like `constructor` must not resolve against a prototype.
 */
function credential(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = Object.hasOwn(environment, name) ? environment[name] : undefined
  if (typeof value !== 'string' || value.trim() === '') {
    failed('credential_unset', 'The provider credential environment variable is not set.')
  }
  return value.trim()
}

/**
 * What the model is told before it is told anything else. It names the
 * workspace and the brief, and it says the one thing this file spends its whole
 * length enforcing from the other side.
 */
export function systemInstruction(workspace: string, brief: string): string {
  return [
    'You are the Kei creation harness, building a game project with its developer.',
    '',
    `The project workspace is: ${workspace}`,
    'Every tool path is relative to that workspace. Nothing outside it is reachable.',
    '',
    'Work in small, verifiable steps. Read before you overwrite. Write plain,',
    'readable code the developer owns: no hidden framework, no config DSL, and no',
    'dependency on this harness at runtime.',
    '',
    'Never write an API key, seed, token, or any other credential into a project',
    'file. Credentials belong to the harness and stay in its environment.',
    '',
    'The game to build:',
    brief,
  ].join('\n')
}

interface CallInput {
  readonly provider: ResolvedProvider
  readonly model: string
  readonly workspace: string
  readonly brief: string
  readonly messages: readonly ModelMessage[]
  readonly tools: readonly ToolDefinition[]
  readonly signal: AbortSignal
}

export function createProviderTransport(options: ProviderTransportOptions): ModelTransport {
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES

  return {
    async generate(input: CallInput): Promise<ModelResponse> {
      const key = credential(options.environment, input.provider.apiKeyEnv)
      const instruction = systemInstruction(input.workspace, input.brief)
      const protocol = input.provider.protocol
      const body =
        protocol === 'messages' ? messagesBody(input, instruction, maxOutputTokens)
        : protocol === 'responses' ? responsesBody(input, instruction, maxOutputTokens)
        : chatCompletionsBody(input, instruction, maxOutputTokens)

      let response: HttpResponse
      try {
        response = await options.fetch(`${input.provider.baseUrl}${PROTOCOL_PATHS[protocol]}`, {
          method: 'POST',
          headers: headersFor(protocol, key),
          body: JSON.stringify(body),
          signal: input.signal,
        })
      } catch {
        // A DNS failure, a refused connection, and a TLS error are all the same
        // fact to a caller, and the exception text is the provider's to phrase.
        failed('provider_unavailable', 'The provider could not be reached.')
      }

      const text = await readBounded(response, maxResponseBytes)
      if (!response.ok) failed(statusCode(response.status), statusMessage(response.status))

      let parsed: unknown
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        failed('provider_response_invalid', 'The provider returned a response the engine cannot use.')
      }
      if (!isRecord(parsed)) {
        failed('provider_response_invalid', 'The provider returned a response the engine cannot use.')
      }
      return protocol === 'messages' ? messagesReply(parsed)
        : protocol === 'responses' ? responsesReply(parsed)
        : chatCompletionsReply(parsed)
    },
  }
}

function headersFor(protocol: ProviderProtocol, key: string): Record<string, string> {
  if (protocol === 'messages') {
    return {
      'content-type': 'application/json',
      accept: 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      'x-api-key': key,
    }
  }
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    authorization: `Bearer ${key}`,
  }
}

async function readBounded(response: HttpResponse, maximum: number): Promise<string> {
  let text: string
  try {
    text = await response.text()
  } catch {
    failed('provider_unavailable', 'The provider could not be reached.')
  }
  // Measured after the read rather than streamed: a body has already been
  // buffered by the time `text()` resolves, and the cap exists to stop an
  // absurd payload reaching the parser and the transcript, not the socket.
  if (new TextEncoder().encode(text).byteLength > maximum) {
    failed('provider_response_invalid', 'The provider returned a response the engine cannot use.')
  }
  return text
}

function statusCode(status: number): EngineError['code'] {
  if (status === 401 || status === 403) return 'provider_auth_error'
  if (status === 429) return 'provider_rate_limited'
  if (status === 408 || status >= 500) return 'provider_unavailable'
  if (status >= 400) return 'provider_request_invalid'
  return 'transport_error'
}

function statusMessage(status: number): string {
  switch (statusCode(status)) {
    case 'provider_auth_error': return 'The provider rejected the inherited credential.'
    case 'provider_rate_limited': return 'The provider rate-limited this request.'
    case 'provider_unavailable': return 'The provider could not be reached.'
    case 'provider_request_invalid': return 'The provider rejected the request as invalid.'
    default: return 'Model transport failed.'
  }
}

function serializedArguments(value: unknown): string {
  const serialized = JSON.stringify(value ?? {})
  return serialized === undefined ? '{}' : serialized
}

function parsedArguments(value: unknown): unknown {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'string') return value
  if (value.trim() === '') return {}
  try {
    return JSON.parse(value) as unknown
  } catch {
    // The model asked for a tool with arguments that are not JSON. There is no
    // safe repair, and guessing one would run a tool the model did not describe.
    failed('provider_response_invalid', 'The provider returned a response the engine cannot use.')
  }
}

// ── messages: Anthropic ──────────────────────────────────────────────────────

/**
 * Anthropic carries tool results in a *user* message, so every run of
 * consecutive tool messages in the flat engine transcript collapses into one.
 */
function messagesBody(input: CallInput, instruction: string, maxOutputTokens: number): JsonRecord {
  const messages: JsonRecord[] = []
  let results: JsonRecord[] = []
  const flush = (): void => {
    if (results.length === 0) return
    messages.push({ role: 'user', content: results })
    results = []
  }

  for (const message of input.messages) {
    if (message.role === 'tool') {
      results.push({ type: 'tool_result', tool_use_id: message.callId, content: message.content })
      continue
    }
    flush()
    if (message.role === 'user') {
      messages.push({ role: 'user', content: [{ type: 'text', text: message.content }] })
      continue
    }
    const blocks: JsonRecord[] = []
    if (message.content !== '') blocks.push({ type: 'text', text: message.content })
    for (const call of message.toolCalls ?? []) {
      blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments ?? {} })
    }
    // An assistant turn with neither text nor a tool call is not a content block
    // Anthropic will accept, and it carries nothing the next turn needs.
    if (blocks.length > 0) messages.push({ role: 'assistant', content: blocks })
  }
  flush()

  return {
    model: input.model,
    max_tokens: maxOutputTokens,
    system: instruction,
    messages,
    ...(input.tools.length === 0 ? {} : {
      tools: input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
    }),
  }
}

function messagesReply(body: JsonRecord): ModelResponse {
  const blocks = body.content
  if (!Array.isArray(blocks)) {
    failed('provider_response_invalid', 'The provider returned a response the engine cannot use.')
  }
  const texts: string[] = []
  const calls: ToolCall[] = []
  for (const block of blocks) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text)
      continue
    }
    if (block.type !== 'tool_use') continue
    if (typeof block.id !== 'string' || typeof block.name !== 'string') {
      failed('provider_response_invalid', 'The provider returned a response the engine cannot use.')
    }
    calls.push({ id: block.id, name: block.name, arguments: block.input ?? {} })
  }
  return reply(texts, calls)
}

// ── responses: OpenAI ────────────────────────────────────────────────────────

function responsesBody(input: CallInput, instruction: string, maxOutputTokens: number): JsonRecord {
  const items: JsonRecord[] = []
  for (const message of input.messages) {
    if (message.role === 'user') {
      items.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: message.content }] })
      continue
    }
    if (message.role === 'tool') {
      items.push({ type: 'function_call_output', call_id: message.callId, output: message.content })
      continue
    }
    if (message.content !== '') {
      items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: message.content }] })
    }
    for (const call of message.toolCalls ?? []) {
      items.push({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: serializedArguments(call.arguments),
      })
    }
  }

  return {
    model: input.model,
    instructions: instruction,
    input: items,
    max_output_tokens: maxOutputTokens,
    // Nothing about this project needs to be retained on the provider's side.
    store: false,
    ...(input.tools.length === 0 ? {} : {
      tools: input.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
    }),
  }
}

function responsesReply(body: JsonRecord): ModelResponse {
  const output = body.output
  if (!Array.isArray(output)) {
    failed('provider_response_invalid', 'The provider returned a response the engine cannot use.')
  }
  const texts: string[] = []
  const calls: ToolCall[] = []
  for (const item of output) {
    if (!isRecord(item)) continue
    if (item.type === 'function_call') {
      const id = typeof item.call_id === 'string' ? item.call_id : item.id
      if (typeof id !== 'string' || typeof item.name !== 'string') {
        failed('provider_response_invalid', 'The provider returned a response the engine cannot use.')
      }
      calls.push({ id, name: item.name, arguments: parsedArguments(item.arguments) })
      continue
    }
    if (item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (isRecord(part) && part.type === 'output_text' && typeof part.text === 'string') texts.push(part.text)
    }
  }
  return reply(texts, calls)
}

// ── chat_completions: everything else ────────────────────────────────────────

function chatCompletionsBody(input: CallInput, instruction: string, maxOutputTokens: number): JsonRecord {
  const messages: JsonRecord[] = [{ role: 'system', content: instruction }]
  for (const message of input.messages) {
    if (message.role === 'user') {
      messages.push({ role: 'user', content: message.content })
      continue
    }
    if (message.role === 'tool') {
      messages.push({ role: 'tool', tool_call_id: message.callId, content: message.content })
      continue
    }
    const toolCalls = (message.toolCalls ?? []).map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: serializedArguments(call.arguments) },
    }))
    if (message.content === '' && toolCalls.length === 0) continue
    messages.push({
      role: 'assistant',
      content: message.content,
      ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
    })
  }

  return {
    model: input.model,
    messages,
    max_tokens: maxOutputTokens,
    ...(input.tools.length === 0 ? {} : {
      tools: input.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      })),
    }),
  }
}

function chatCompletionsReply(body: JsonRecord): ModelResponse {
  const choices = body.choices
  if (!Array.isArray(choices) || !isRecord(choices[0]) || !isRecord(choices[0].message)) {
    failed('provider_response_invalid', 'The provider returned a response the engine cannot use.')
  }
  const message = choices[0].message
  const texts = typeof message.content === 'string' && message.content !== '' ? [message.content] : []
  const calls: ToolCall[] = []
  for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    if (!isRecord(call) || !isRecord(call.function)) {
      failed('provider_response_invalid', 'The provider returned a response the engine cannot use.')
    }
    if (typeof call.id !== 'string' || typeof call.function.name !== 'string') {
      failed('provider_response_invalid', 'The provider returned a response the engine cannot use.')
    }
    calls.push({ id: call.id, name: call.function.name, arguments: parsedArguments(call.function.arguments) })
  }
  return reply(texts, calls)
}

function reply(texts: readonly string[], calls: readonly ToolCall[]): ModelResponse {
  return Object.freeze({
    content: texts.join('\n'),
    ...(calls.length === 0 ? {} : { toolCalls: Object.freeze([...calls]) }),
  })
}
