import type { HarnessRequest } from './harness.js'
import type { ImplementationPlan } from './plan.js'
import type { ResolvedProvider } from './providers.js'

export const DEFAULT_ENGINE_LIMITS = Object.freeze({
  maxPromptBytes: 64 * 1024,
  maxHistoryBytes: 4 * 1024 * 1024,
  maxTurns: 24,
  maxOutputBytes: 512 * 1024,
  maxToolCallsPerTurn: 32,
  maxToolCallIdBytes: 256,
  maxToolNameBytes: 128,
  maxToolArgumentBytes: 64 * 1024,
  maxToolResultBytes: 64 * 1024,
  maxToolResultTotalBytes: 512 * 1024,
  maxWallTimeMs: 30 * 60 * 1000,
})

export interface EngineLimits {
  readonly maxPromptBytes: number
  readonly maxHistoryBytes: number
  readonly maxTurns: number
  readonly maxOutputBytes: number
  readonly maxToolCallsPerTurn: number
  readonly maxToolCallIdBytes: number
  readonly maxToolNameBytes: number
  readonly maxToolArgumentBytes: number
  readonly maxToolResultBytes: number
  readonly maxToolResultTotalBytes: number
  readonly maxWallTimeMs: number
}

export interface EngineRequest {
  readonly workspace: string
  readonly provider: ResolvedProvider
  readonly model: string
  /** The plan, rendered for the system instruction. */
  readonly brief: string
  /**
   * The plan itself, when there is one. The brief is what the model is told;
   * this is what the front end and the JSONL caller can act on.
   */
  readonly plan?: ImplementationPlan
}

export function engineRequestFromHarness(request: HarnessRequest, workspace: string): EngineRequest {
  return Object.freeze({
    workspace,
    provider: request.provider,
    model: request.model,
    brief: request.brief,
    plan: request.plan,
  })
}

export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: unknown
}

export type ModelMessage =
  | { readonly role: 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly content: string; readonly toolCalls?: readonly ToolCall[] }
  | { readonly role: 'tool'; readonly callId: string; readonly name: string; readonly content: string }

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}

export interface ModelResponse {
  readonly content: string
  readonly toolCalls?: readonly ToolCall[]
}

export interface ModelTransport {
  generate(input: {
    readonly provider: ResolvedProvider
    readonly model: string
    readonly workspace: string
    readonly brief: string
    readonly messages: readonly ModelMessage[]
    readonly tools: readonly ToolDefinition[]
    readonly signal: AbortSignal
  }): Promise<ModelResponse>
}

export interface EngineTool {
  readonly definition: ToolDefinition
  execute(argumentsValue: unknown, context: {
    readonly workspace: string
    readonly signal: AbortSignal
  }): Promise<unknown>
}

export type EngineEvent =
  | { readonly type: 'turn_started'; readonly turn: number }
  | { readonly type: 'assistant'; readonly turn: number; readonly content: string }
  | { readonly type: 'tool_started'; readonly turn: number; readonly callId: string; readonly name: string }
  | { readonly type: 'tool_finished'; readonly turn: number; readonly callId: string; readonly name: string; readonly bytes: number }
  | { readonly type: 'completed'; readonly turns: number; readonly outputBytes: number }

export type EngineErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'prompt_limit'
  | 'history_limit'
  | 'turn_limit'
  | 'output_limit'
  | 'tool_call_limit'
  | 'tool_argument_limit'
  | 'tool_result_limit'
  | 'transport_error'
  | 'credential_unset'
  | 'provider_auth_error'
  | 'provider_rate_limited'
  | 'provider_request_invalid'
  | 'provider_unavailable'
  | 'provider_response_invalid'
  | 'tool_not_found'
  | 'tool_error'
  | 'invalid_runtime'

export class EngineError extends Error {
  override readonly name = 'EngineError'

  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly details: Readonly<{ field?: string }> = {},
  ) {
    super(message)
  }
}

/**
 * The one place an engine failure is phrased. Every front end, and every
 * failure this engine raises on behalf of an adapter, reports from this table
 * rather than from a caught `error.message` — so no transport or tool can widen
 * what a diagnostic says, deliberately or by pasting a credential into it.
 */
export const ENGINE_ERROR_MESSAGES: Readonly<Record<EngineErrorCode, string>> = Object.freeze({
  cancelled: 'Engine turn was cancelled.',
  timeout: 'Engine turn exceeded its time limit.',
  prompt_limit: 'Turn prompt exceeded its byte limit.',
  history_limit: 'Session transcript exceeded its byte limit.',
  turn_limit: 'Engine turn count exceeded its limit.',
  output_limit: 'Model output exceeded its byte limit.',
  tool_call_limit: 'Model requested too many tools in one turn.',
  tool_argument_limit: 'Tool arguments exceeded their byte limit.',
  tool_result_limit: 'Tool result exceeded its byte limit.',
  transport_error: 'Model transport failed.',
  credential_unset: 'The provider credential environment variable is not set.',
  provider_auth_error: 'The provider rejected the inherited credential.',
  provider_rate_limited: 'The provider rate-limited this request.',
  provider_request_invalid: 'The provider rejected the request as invalid.',
  provider_unavailable: 'The provider could not be reached.',
  provider_response_invalid: 'The provider returned a response the engine cannot use.',
  tool_not_found: 'Model requested an unavailable tool.',
  tool_error: 'Tool execution failed.',
  invalid_runtime: 'Engine runtime is not valid.',
})

export interface EngineScheduler {
  setTimeout(callback: () => void, milliseconds: number): unknown
  clearTimeout(handle: unknown): void
}

const nodeScheduler: EngineScheduler = {
  setTimeout(callback, milliseconds) {
    return globalThis.setTimeout(callback, milliseconds)
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

export interface EngineSessionOptions {
  readonly request: EngineRequest
  readonly transport: ModelTransport
  readonly tools?: readonly EngineTool[]
  readonly limits?: Partial<EngineLimits>
  readonly scheduler?: EngineScheduler
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new EngineError('invalid_runtime', 'Engine limit is not valid.', { field })
  }
  return value
}

function resolvedLimits(values: Partial<EngineLimits> = {}): EngineLimits {
  return Object.freeze({
    maxPromptBytes: positiveInteger(values.maxPromptBytes ?? DEFAULT_ENGINE_LIMITS.maxPromptBytes, 'maxPromptBytes'),
    maxHistoryBytes: positiveInteger(values.maxHistoryBytes ?? DEFAULT_ENGINE_LIMITS.maxHistoryBytes, 'maxHistoryBytes'),
    maxTurns: positiveInteger(values.maxTurns ?? DEFAULT_ENGINE_LIMITS.maxTurns, 'maxTurns'),
    maxOutputBytes: positiveInteger(values.maxOutputBytes ?? DEFAULT_ENGINE_LIMITS.maxOutputBytes, 'maxOutputBytes'),
    maxToolCallsPerTurn: positiveInteger(values.maxToolCallsPerTurn ?? DEFAULT_ENGINE_LIMITS.maxToolCallsPerTurn, 'maxToolCallsPerTurn'),
    maxToolCallIdBytes: positiveInteger(values.maxToolCallIdBytes ?? DEFAULT_ENGINE_LIMITS.maxToolCallIdBytes, 'maxToolCallIdBytes'),
    maxToolNameBytes: positiveInteger(values.maxToolNameBytes ?? DEFAULT_ENGINE_LIMITS.maxToolNameBytes, 'maxToolNameBytes'),
    maxToolArgumentBytes: positiveInteger(values.maxToolArgumentBytes ?? DEFAULT_ENGINE_LIMITS.maxToolArgumentBytes, 'maxToolArgumentBytes'),
    maxToolResultBytes: positiveInteger(values.maxToolResultBytes ?? DEFAULT_ENGINE_LIMITS.maxToolResultBytes, 'maxToolResultBytes'),
    maxToolResultTotalBytes: positiveInteger(values.maxToolResultTotalBytes ?? DEFAULT_ENGINE_LIMITS.maxToolResultTotalBytes, 'maxToolResultTotalBytes'),
    maxWallTimeMs: positiveInteger(values.maxWallTimeMs ?? DEFAULT_ENGINE_LIMITS.maxWallTimeMs, 'maxWallTimeMs'),
  })
}

function safeToolResult(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new Error('unsupported')
    return serialized
  } catch {
    throw new EngineError('tool_error', 'Tool returned a value that cannot be serialized.')
  }
}

function freezeJson(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const pending: object[] = [value]
  const seen = new WeakSet<object>()
  const objects: object[] = []
  while (pending.length > 0) {
    const current = pending.pop()!
    if (seen.has(current)) continue
    seen.add(current)
    objects.push(current)
    for (const child of Object.values(current)) {
      if (typeof child === 'object' && child !== null) pending.push(child)
    }
  }
  for (const current of objects.reverse()) Object.freeze(current)
  return value
}

function snapshotMessages(messages: readonly ModelMessage[]): readonly ModelMessage[] {
  return Object.freeze(messages.map((message): ModelMessage => {
    switch (message.role) {
      case 'user': return Object.freeze({ role: 'user', content: message.content })
      case 'tool': return Object.freeze({ role: 'tool', callId: message.callId, name: message.name, content: message.content })
      case 'assistant': {
        const calls = message.toolCalls?.map((call) => Object.freeze({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        }))
        return Object.freeze({
          role: 'assistant',
          content: message.content,
          ...(calls?.length ? { toolCalls: Object.freeze(calls) } : {}),
        })
      }
    }
  }))
}

function aborted(signal: AbortSignal, timedOut: () => boolean): never {
  const code = timedOut() ? 'timeout' : 'cancelled'
  throw new EngineError(code, ENGINE_ERROR_MESSAGES[code])
}

/**
 * The only codes a transport is trusted to name for itself. Anything else it
 * throws — including a code that would misreport session control, such as
 * `cancelled` — collapses to `transport_error`, so an adapter can never dress a
 * failure up as something the engine decided.
 */
const TRANSPORT_CODES: ReadonlySet<EngineErrorCode> = new Set([
  'credential_unset',
  'provider_auth_error',
  'provider_rate_limited',
  'provider_request_invalid',
  'provider_unavailable',
  'provider_response_invalid',
])

/**
 * A transport chooses the *code* and never the words. The thrown error is
 * dropped rather than rethrown, because its message and details came from an
 * adapter and could carry a response body — or a credential — with them.
 */
function transportFailure(error: unknown): EngineError {
  const code = error instanceof EngineError && TRANSPORT_CODES.has(error.code)
    ? error.code
    : 'transport_error'
  return new EngineError(code, ENGINE_ERROR_MESSAGES[code])
}

async function raceAbort<T>(work: Promise<T>, signal: AbortSignal, timedOut: () => boolean): Promise<T> {
  if (signal.aborted) return aborted(signal, timedOut)
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      try { aborted(signal, timedOut) } catch (error) { reject(error) }
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
  })
}

export class EngineSession {
  readonly #request: EngineRequest
  readonly #transport: ModelTransport
  readonly #tools: ReadonlyMap<string, EngineTool>
  readonly #limits: EngineLimits
  readonly #scheduler: EngineScheduler
  readonly #messages: ModelMessage[] = []
  #historyBytes = 0
  #busy = false

  constructor(options: EngineSessionOptions) {
    this.#request = options.request
    this.#transport = options.transport
    this.#limits = resolvedLimits(options.limits)
    this.#scheduler = options.scheduler ?? nodeScheduler
    const tools = new Map<string, EngineTool>()
    for (const tool of options.tools ?? []) {
      const nameBytes = new TextEncoder().encode(tool.definition.name).byteLength
      if (tools.has(tool.definition.name) || tool.definition.name.trim() === '' || nameBytes > this.#limits.maxToolNameBytes) {
        throw new EngineError('invalid_runtime', 'Tool registry is not valid.', { field: 'tools' })
      }
      tools.set(tool.definition.name, tool)
    }
    this.#tools = tools
  }

  get messages(): readonly ModelMessage[] {
    return snapshotMessages(this.#messages)
  }

  #append(message: ModelMessage, bytes: number): void {
    if (this.#historyBytes + bytes > this.#limits.maxHistoryBytes) {
      throw new EngineError('history_limit', ENGINE_ERROR_MESSAGES.history_limit)
    }
    this.#messages.push(message)
    this.#historyBytes += bytes
  }

  async runTurn(
    prompt: string,
    emit: (event: EngineEvent) => void | Promise<void>,
    parentSignal?: AbortSignal,
  ): Promise<void> {
    if (this.#busy) throw new EngineError('invalid_runtime', 'Engine session already has an active turn.', { field: 'session' })
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new EngineError('invalid_runtime', 'Turn prompt must be a nonblank string.', { field: 'prompt' })
    }
    const promptBytes = new TextEncoder().encode(prompt).byteLength
    if (promptBytes > this.#limits.maxPromptBytes) {
      throw new EngineError('prompt_limit', ENGINE_ERROR_MESSAGES.prompt_limit, { field: 'prompt' })
    }

    this.#busy = true
    const historyLength = this.#messages.length
    const historyBytes = this.#historyBytes
    const controller = new AbortController()
    let didTimeOut = false
    const onParentAbort = () => controller.abort()
    if (parentSignal?.aborted) controller.abort()
    else parentSignal?.addEventListener('abort', onParentAbort, { once: true })
    const timer = this.#scheduler.setTimeout(() => {
      didTimeOut = true
      controller.abort()
    }, this.#limits.maxWallTimeMs)
    const timedOut = () => didTimeOut

    let outputBytes = 0
    let toolResultBytes = 0
    let turns = 0
    try {
      this.#append(Object.freeze({ role: 'user', content: prompt }), promptBytes)
      while (true) {
        if (controller.signal.aborted) aborted(controller.signal, timedOut)
        if (turns >= this.#limits.maxTurns) {
          throw new EngineError('turn_limit', ENGINE_ERROR_MESSAGES.turn_limit)
        }
        turns += 1
        await emit({ type: 'turn_started', turn: turns })
        if (controller.signal.aborted) aborted(controller.signal, timedOut)

        let response: ModelResponse
        try {
          response = await raceAbort(
            this.#transport.generate({
              provider: this.#request.provider,
              model: this.#request.model,
              workspace: this.#request.workspace,
              brief: this.#request.brief,
              messages: snapshotMessages(this.#messages),
              tools: Object.freeze([...this.#tools.values()].map((tool) => tool.definition)),
              signal: controller.signal,
            }),
            controller.signal,
            timedOut,
          )
        } catch (error) {
          if (controller.signal.aborted) aborted(controller.signal, timedOut)
          throw transportFailure(error)
        }

        if (typeof response.content !== 'string' || !Array.isArray(response.toolCalls ?? [])) {
          throw new EngineError('transport_error', 'Model transport returned an invalid response.')
        }
        const contentBytes = new TextEncoder().encode(response.content).byteLength
        outputBytes += contentBytes
        if (outputBytes > this.#limits.maxOutputBytes) {
          throw new EngineError('output_limit', ENGINE_ERROR_MESSAGES.output_limit)
        }
        const calls = response.toolCalls ?? []
        if (calls.length > this.#limits.maxToolCallsPerTurn) {
          throw new EngineError('tool_call_limit', ENGINE_ERROR_MESSAGES.tool_call_limit)
        }
        const normalizedCalls: Array<{ stored: ToolCall; executionArguments: unknown; historyBytes: number }> = []
        for (const call of calls) {
          if (typeof call.id !== 'string' || call.id === '' || typeof call.name !== 'string' || call.name === '') {
            throw new EngineError('transport_error', 'Model transport returned an invalid tool call.')
          }
          const callIdBytes = new TextEncoder().encode(call.id).byteLength
          const callNameBytes = new TextEncoder().encode(call.name).byteLength
          if (callIdBytes > this.#limits.maxToolCallIdBytes || callNameBytes > this.#limits.maxToolNameBytes) {
            throw new EngineError('transport_error', 'Model transport returned an oversized tool call.')
          }
          if (!this.#tools.has(call.name)) {
            throw new EngineError('tool_not_found', ENGINE_ERROR_MESSAGES.tool_not_found)
          }
          let serializedArguments: string
          try {
            const serialized = JSON.stringify(call.arguments)
            if (serialized === undefined) throw new Error('unsupported')
            serializedArguments = serialized
          } catch {
            throw new EngineError('transport_error', 'Model transport returned invalid tool arguments.')
          }
          if (new TextEncoder().encode(serializedArguments).byteLength > this.#limits.maxToolArgumentBytes) {
            throw new EngineError('tool_argument_limit', ENGINE_ERROR_MESSAGES.tool_argument_limit)
          }
          let storedArguments: unknown
          let executionArguments: unknown
          try {
            storedArguments = freezeJson(JSON.parse(serializedArguments) as unknown)
            executionArguments = JSON.parse(serializedArguments) as unknown
          } catch {
            throw new EngineError('transport_error', 'Model transport returned invalid tool arguments.')
          }
          normalizedCalls.push({
            stored: Object.freeze({ id: call.id, name: call.name, arguments: storedArguments }),
            executionArguments,
            historyBytes: callIdBytes + callNameBytes + new TextEncoder().encode(serializedArguments).byteLength,
          })
        }
        const storedCalls = Object.freeze(normalizedCalls.map(({ stored }) => stored))
        this.#append(Object.freeze({
          role: 'assistant',
          content: response.content,
          ...(storedCalls.length ? { toolCalls: storedCalls } : {}),
        }), contentBytes + normalizedCalls.reduce((total, call) => total + call.historyBytes, 0))
        if (response.content !== '') await emit({ type: 'assistant', turn: turns, content: response.content })

        if (calls.length === 0) {
          await emit({ type: 'completed', turns, outputBytes })
          return
        }

        for (const { stored: call, executionArguments } of normalizedCalls) {
          const tool = this.#tools.get(call.name)!
          await emit({ type: 'tool_started', turn: turns, callId: call.id, name: call.name })
          let value: unknown
          try {
            value = await raceAbort(
              tool.execute(executionArguments, { workspace: this.#request.workspace, signal: controller.signal }),
              controller.signal,
              timedOut,
            )
          } catch (error) {
            if (controller.signal.aborted) aborted(controller.signal, timedOut)
            throw new EngineError('tool_error', ENGINE_ERROR_MESSAGES.tool_error)
          }
          const result = safeToolResult(value)
          const bytes = new TextEncoder().encode(result).byteLength
          if (bytes > this.#limits.maxToolResultBytes) {
            throw new EngineError('tool_result_limit', ENGINE_ERROR_MESSAGES.tool_result_limit)
          }
          toolResultBytes += bytes
          if (toolResultBytes > this.#limits.maxToolResultTotalBytes) {
            throw new EngineError('tool_result_limit', 'Cumulative tool results exceeded their byte limit.')
          }
          this.#append(
            Object.freeze({ role: 'tool', callId: call.id, name: call.name, content: result }),
            bytes + new TextEncoder().encode(call.id).byteLength + new TextEncoder().encode(call.name).byteLength,
          )
          await emit({ type: 'tool_finished', turn: turns, callId: call.id, name: call.name, bytes })
        }
      }
    } catch (error) {
      this.#messages.splice(historyLength)
      this.#historyBytes = historyBytes
      throw error
    } finally {
      this.#scheduler.clearTimeout(timer)
      parentSignal?.removeEventListener('abort', onParentAbort)
      this.#busy = false
    }
  }
}

export class ScriptedTransport implements ModelTransport {
  readonly #responses: Array<ModelResponse | ((signal: AbortSignal) => Promise<ModelResponse>)>
  readonly inputs: Array<Parameters<ModelTransport['generate']>[0]> = []

  constructor(responses: readonly (ModelResponse | ((signal: AbortSignal) => Promise<ModelResponse>))[]) {
    this.#responses = [...responses]
  }

  async generate(input: Parameters<ModelTransport['generate']>[0]): Promise<ModelResponse> {
    this.inputs.push(input)
    const response = this.#responses.shift()
    if (!response) throw new Error('script exhausted')
    return typeof response === 'function' ? await response(input.signal) : response
  }
}

export function deterministicTool(
  name: string,
  execute: (argumentsValue: unknown) => unknown | Promise<unknown>,
): EngineTool {
  return {
    definition: { name, description: `Deterministic ${name} test tool.`, inputSchema: { type: 'object' } },
    async execute(argumentsValue) { return await execute(argumentsValue) },
  }
}
