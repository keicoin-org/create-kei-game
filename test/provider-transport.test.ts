import { describe, expect, test } from 'bun:test'

import {
  ANTHROPIC_VERSION,
  createProviderTransport,
  systemInstruction,
  type HttpFetch,
  type HttpRequest,
  type HttpResponse,
} from '../src/provider-transport.js'
import { resolveProvider, type ResolvedProvider } from '../src/providers.js'
import { EngineError, type ModelMessage, type ModelResponse, type ToolDefinition } from '../src/runtime.js'

const secret = 'sk-provider-secret-never-leaked'
const environment = Object.freeze({ TEST_PROVIDER_KEY: secret })

const tools: readonly ToolDefinition[] = [
  { name: 'write_file', description: 'Write a file.', inputSchema: { type: 'object' } },
]

const history: readonly ModelMessage[] = [
  { role: 'user', content: 'Add a door.' },
  { role: 'assistant', content: 'Writing it.', toolCalls: [{ id: 'call-1', name: 'write_file', arguments: { path: 'src/door.ts' } }] },
  { role: 'tool', callId: 'call-1', name: 'write_file', content: '{"ok":true}' },
  { role: 'user', content: 'Now add a key.' },
]

interface Capture {
  readonly calls: Array<{ url: string; request: HttpRequest; body: Record<string, unknown> }>
  readonly fetch: HttpFetch
}

function scripted(reply: unknown, status = 200): Capture {
  const calls: Capture['calls'] = []
  const fetch: HttpFetch = async (url, request) => {
    calls.push({ url, request, body: JSON.parse(request.body) as Record<string, unknown> })
    return response(typeof reply === 'string' ? reply : JSON.stringify(reply), status)
  }
  return { calls, fetch }
}

function response(text: string, status: number): HttpResponse {
  return { ok: status >= 200 && status < 300, status, async text() { return text } }
}

function provider(id: string, overrides: Record<string, string> = {}): ResolvedProvider {
  return resolveProvider({ provider: id, apiKeyEnv: 'TEST_PROVIDER_KEY', ...overrides })
}

async function generate(
  capture: Capture,
  resolved: ResolvedProvider,
  messages: readonly ModelMessage[] = history,
): Promise<ModelResponse> {
  const transport = createProviderTransport({ fetch: capture.fetch, environment })
  return await transport.generate({
    provider: resolved,
    model: 'model-id',
    workspace: '/workspace/game',
    brief: 'Build a cooperative puzzle.',
    messages,
    tools,
    signal: new AbortController().signal,
  })
}

describe('anthropic messages protocol', () => {
  test('posts to /v1/messages with the dated header and the key in x-api-key only', async () => {
    const capture = scripted({ content: [{ type: 'text', text: 'Done.' }] })
    await generate(capture, provider('anthropic'))

    const call = capture.calls[0]!
    expect(call.url).toBe('https://api.anthropic.com/v1/messages')
    expect(call.request.headers).toEqual({
      'content-type': 'application/json',
      accept: 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      'x-api-key': secret,
    })
    expect(call.request.body).not.toContain('Bearer')
    expect(call.body.system).toBe(systemInstruction('/workspace/game', 'Build a cooperative puzzle.'))
    expect(call.body.tools).toEqual([
      { name: 'write_file', description: 'Write a file.', input_schema: { type: 'object' } },
    ])
  })

  test('carries a tool result in a user message, as this protocol requires', async () => {
    const capture = scripted({ content: [{ type: 'text', text: 'Done.' }] })
    await generate(capture, provider('anthropic'))

    expect(capture.calls[0]!.body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Add a door.' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Writing it.' },
          { type: 'tool_use', id: 'call-1', name: 'write_file', input: { path: 'src/door.ts' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: '{"ok":true}' }] },
      { role: 'user', content: [{ type: 'text', text: 'Now add a key.' }] },
    ])
  })

  test('merges consecutive tool results into one message and drops an empty assistant turn', async () => {
    const capture = scripted({ content: [] })
    await generate(capture, provider('anthropic'), [
      { role: 'assistant', content: '' },
      { role: 'assistant', content: '', toolCalls: [
        { id: 'a', name: 'write_file', arguments: {} },
        { id: 'b', name: 'write_file', arguments: {} },
      ] },
      { role: 'tool', callId: 'a', name: 'write_file', content: 'one' },
      { role: 'tool', callId: 'b', name: 'write_file', content: 'two' },
    ])

    const messages = capture.calls[0]!.body.messages as Array<Record<string, unknown>>
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('assistant')
    expect((messages[0]!.content as unknown[])).toHaveLength(2)
    expect(messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'a', content: 'one' },
        { type: 'tool_result', tool_use_id: 'b', content: 'two' },
      ],
    })
  })

  test('reads text and tool_use blocks out of the reply', async () => {
    const capture = scripted({
      content: [
        { type: 'text', text: 'Adding the key.' },
        { type: 'tool_use', id: 'call-9', name: 'write_file', input: { path: 'src/key.ts' } },
      ],
    })
    expect(await generate(capture, provider('anthropic'))).toEqual({
      content: 'Adding the key.',
      toolCalls: [{ id: 'call-9', name: 'write_file', arguments: { path: 'src/key.ts' } }],
    })
  })
})

describe('openai responses protocol', () => {
  test('posts to /responses with a bearer credential and opts out of retention', async () => {
    const capture = scripted({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }] })
    await generate(capture, provider('openai'))

    const call = capture.calls[0]!
    expect(call.url).toBe('https://api.openai.com/v1/responses')
    expect(call.request.headers.authorization).toBe(`Bearer ${secret}`)
    expect(call.request.headers['x-api-key']).toBeUndefined()
    expect(call.body.store).toBe(false)
    expect(call.body.instructions).toContain('Build a cooperative puzzle.')
    expect(call.body.tools).toEqual([
      { type: 'function', name: 'write_file', description: 'Write a file.', parameters: { type: 'object' } },
    ])
  })

  test('renders the transcript as typed input items with serialized call arguments', async () => {
    const capture = scripted({ output: [] })
    await generate(capture, provider('openai'))

    expect(capture.calls[0]!.body.input).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Add a door.' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Writing it.' }] },
      { type: 'function_call', call_id: 'call-1', name: 'write_file', arguments: '{"path":"src/door.ts"}' },
      { type: 'function_call_output', call_id: 'call-1', output: '{"ok":true}' },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Now add a key.' }] },
    ])
  })

  test('parses function_call items and their JSON argument string', async () => {
    const capture = scripted({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'Adding.' }] },
        { type: 'function_call', call_id: 'call-2', name: 'write_file', arguments: '{"path":"src/key.ts"}' },
      ],
    })
    expect(await generate(capture, provider('openai'))).toEqual({
      content: 'Adding.',
      toolCalls: [{ id: 'call-2', name: 'write_file', arguments: { path: 'src/key.ts' } }],
    })
  })

  test('refuses to guess when tool arguments are not JSON', async () => {
    const capture = scripted({
      output: [{ type: 'function_call', call_id: 'call-3', name: 'write_file', arguments: '{not json' }],
    })
    await expect(generate(capture, provider('openai'))).rejects.toMatchObject({
      code: 'provider_response_invalid',
    })
  })
})

describe('chat completions protocol', () => {
  test('posts to /chat/completions with the instruction as a system message', async () => {
    const capture = scripted({ choices: [{ message: { content: 'Done.' } }] })
    await generate(capture, provider('deepseek'))

    const call = capture.calls[0]!
    expect(call.url).toBe('https://api.deepseek.com/chat/completions')
    expect(call.request.headers.authorization).toBe(`Bearer ${secret}`)
    expect(call.body.messages).toEqual([
      { role: 'system', content: systemInstruction('/workspace/game', 'Build a cooperative puzzle.') },
      { role: 'user', content: 'Add a door.' },
      {
        role: 'assistant',
        content: 'Writing it.',
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'write_file', arguments: '{"path":"src/door.ts"}' } }],
      },
      { role: 'tool', tool_call_id: 'call-1', content: '{"ok":true}' },
      { role: 'user', content: 'Now add a key.' },
    ])
  })

  test('parses the first choice and its tool calls', async () => {
    const capture = scripted({
      choices: [{
        message: {
          content: 'Adding.',
          tool_calls: [{ id: 'call-4', type: 'function', function: { name: 'write_file', arguments: '{"path":"a.ts"}' } }],
        },
      }],
    })
    expect(await generate(capture, provider('zai'))).toEqual({
      content: 'Adding.',
      toolCalls: [{ id: 'call-4', name: 'write_file', arguments: { path: 'a.ts' } }],
    })
  })

  test('honours a custom provider base URL rather than a built-in one', async () => {
    const capture = scripted({ choices: [{ message: { content: 'Done.' } }] })
    await generate(capture, provider('custom', {
      protocol: 'chat_completions',
      baseUrl: 'https://models.example.test/v1',
    }))
    expect(capture.calls[0]!.url).toBe('https://models.example.test/v1/chat/completions')
  })
})

describe('failures are stable, and never carry the credential or the body', () => {
  test('an unset credential fails before any request is made', async () => {
    const capture = scripted({ choices: [] })
    const transport = createProviderTransport({ fetch: capture.fetch, environment: {} })
    await expect(transport.generate({
      provider: provider('openai'),
      model: 'model-id',
      workspace: '/workspace/game',
      brief: 'Build it.',
      messages: history,
      tools,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'credential_unset' })
    expect(capture.calls).toHaveLength(0)
  })

  test('an inherited name that resolves only on Object.prototype is still unset', async () => {
    const capture = scripted({ choices: [] })
    const transport = createProviderTransport({ fetch: capture.fetch, environment: {} })
    await expect(transport.generate({
      provider: provider('openai', { apiKeyEnv: 'constructor' }),
      model: 'model-id',
      workspace: '/workspace/game',
      brief: 'Build it.',
      messages: history,
      tools,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'credential_unset' })
  })

  test('maps each HTTP status to one stable code with a fixed message', async () => {
    const cases = [
      [401, 'provider_auth_error'],
      [403, 'provider_auth_error'],
      [429, 'provider_rate_limited'],
      [400, 'provider_request_invalid'],
      [404, 'provider_request_invalid'],
      [408, 'provider_unavailable'],
      [500, 'provider_unavailable'],
      [503, 'provider_unavailable'],
    ] as const

    for (const [status, code] of cases) {
      const capture = scripted(`{"error":{"message":"${secret} quota for org acme"}}`, status)
      let thrown: unknown
      try { await generate(capture, provider('openai')) } catch (error) { thrown = error }
      expect(thrown).toBeInstanceOf(EngineError)
      expect((thrown as EngineError).code).toBe(code)
      expect((thrown as EngineError).message).not.toContain(secret)
      expect((thrown as EngineError).message).not.toContain('acme')
    }
  })

  test('a network failure is unavailable, and the thrown cause never escapes', async () => {
    const fetch: HttpFetch = async () => { throw new Error(`getaddrinfo ENOTFOUND ${secret}`) }
    let thrown: unknown
    try { await generate({ calls: [], fetch }, provider('openai')) } catch (error) { thrown = error }
    expect(thrown).toMatchObject({ code: 'provider_unavailable' })
    expect((thrown as EngineError).message).not.toContain(secret)
  })

  test('a body that is not JSON, or not the expected shape, is response_invalid', async () => {
    for (const reply of ['<html>gateway</html>', '[]', '{}', '{"output":"text"}', '{"choices":[{}]}']) {
      await expect(generate(scripted(reply), provider('openai'))).rejects.toMatchObject({
        code: 'provider_response_invalid',
      })
    }
  })

  test('a reply over the response cap is rejected rather than parsed', async () => {
    const fetch: HttpFetch = async () => response(JSON.stringify({ output: [] }).padEnd(5000, ' '), 200)
    const transport = createProviderTransport({ fetch, environment, maxResponseBytes: 128 })
    await expect(transport.generate({
      provider: provider('openai'),
      model: 'model-id',
      workspace: '/workspace/game',
      brief: 'Build it.',
      messages: history,
      tools,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'provider_response_invalid' })
  })
})

describe('the system instruction', () => {
  test('names the workspace and the brief and forbids writing credentials', () => {
    const instruction = systemInstruction('/workspace/game', 'Build a cooperative puzzle.')
    expect(instruction).toContain('/workspace/game')
    expect(instruction).toContain('Build a cooperative puzzle.')
    expect(instruction).toContain('Never write an API key')
    expect(instruction).toContain('Kei')
  })
})
