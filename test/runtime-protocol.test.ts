import { describe, expect, test } from 'bun:test'

import { MAX_JSONL_LINE_BYTES, runJsonlEngine, type ProtocolOutput } from '../src/runtime-protocol.js'
import { ScriptedTransport, type EngineRequest, type ModelResponse } from '../src/runtime.js'

const request: EngineRequest = {
  workspace: '/workspace/game',
  provider: { provider: 'openai', protocol: 'responses', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY' },
  model: 'model-id',
  brief: 'Build a game.',
}

const line = (value: unknown) => `${JSON.stringify(value)}\n`
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function execute(
  input: AsyncIterable<string | Uint8Array>,
  transport: ScriptedTransport,
): Promise<ProtocolOutput[]> {
  const output: ProtocolOutput[] = []
  await runJsonlEngine(input, (written) => { output.push(JSON.parse(written) as ProtocolOutput) }, { create: () => ({ transport }) })
  return output
}

describe('versioned JSONL engine boundary', () => {
  test('keeps one session across repeated turns with ordered sequence numbers', async () => {
    const transport = new ScriptedTransport([{ content: 'One.' }, { content: 'Two.' }])
    async function* input() {
      yield line({ v: 1, type: 'open', id: 'game', request })
      yield line({ v: 1, type: 'turn', id: 'game', prompt: 'First' })
      await pause()
      yield line({ v: 1, type: 'turn', id: 'game', prompt: 'Second' })
      await pause()
      yield line({ v: 1, type: 'close', id: 'game' })
      yield line({ v: 1, type: 'shutdown' })
    }
    const output = await execute(input(), transport)
    expect(output.filter(({ type }) => type === 'accepted').map((item) => item.type === 'accepted' ? item.command : '')).toEqual(['open', 'turn', 'turn', 'close'])
    const events = output.filter((item): item is Extract<ProtocolOutput, { type: 'event' }> => item.type === 'event')
    expect(events.map(({ seq }) => seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(events.filter(({ event }) => event.type === 'assistant').map(({ event }) => event.type === 'assistant' ? event.content : '')).toEqual(['One.', 'Two.'])
    expect(transport.inputs[1]!.messages.map(({ role }) => role)).toEqual(['user', 'assistant', 'user'])
    expect(output.at(-1)).toEqual({ v: 1, type: 'shutdown' })
  })

  test('accepts cancellation while a turn is running and rolls back before shutdown', async () => {
    const transport = new ScriptedTransport([() => new Promise<ModelResponse>(() => {})])
    async function* input() {
      yield line({ v: 1, type: 'open', id: 'game', request })
      yield line({ v: 1, type: 'turn', id: 'game', prompt: 'Wait' })
      await pause()
      yield line({ v: 1, type: 'cancel', id: 'game' })
      await pause()
      yield line({ v: 1, type: 'close', id: 'game' })
      yield line({ v: 1, type: 'shutdown' })
    }
    const output = await execute(input(), transport)
    expect(output).toContainEqual({ v: 1, type: 'accepted', id: 'game', command: 'cancel' })
    expect(output).toContainEqual({ v: 1, type: 'error', id: 'game', error: { code: 'cancelled', message: 'Engine turn was cancelled.' } })
    expect(output.at(-1)).toEqual({ v: 1, type: 'shutdown' })
  })

  test('shutdown is terminal and suppresses the aborted active-turn error', async () => {
    const transport = new ScriptedTransport([() => new Promise<ModelResponse>(() => {})])
    async function* input() {
      yield line({ v: 1, type: 'open', id: 'game', request })
      yield line({ v: 1, type: 'turn', id: 'game', prompt: 'Wait' })
      await pause()
      yield line({ v: 1, type: 'shutdown' })
    }
    const output = await execute(input(), transport)
    expect(output.at(-1)).toEqual({ v: 1, type: 'shutdown' })
    expect(output.some((item) => item.type === 'error' && item.id === 'game')).toBeFalse()
  })

  test('rejects malformed commands, unsupported versions, relative workspaces, and invalid providers', async () => {
    async function* input() {
      yield '{\n'
      yield line({ v: 2, type: 'shutdown' })
      yield line({ v: 1, type: 'open', id: 'relative', request: { ...request, workspace: './game' } })
      yield line({ v: 1, type: 'open', id: 'provider', request: { ...request, provider: { ...request.provider, provider: 'made-up' } } })
      yield line({ v: 1, type: 'open', id: 'secret', request: { ...request, provider: { ...request.provider, apiKey: 'hidden' } } })
      yield line({ v: 1, type: 'turn', id: 'missing', prompt: 'x' })
      yield line({ v: 1, type: 'shutdown' })
    }
    const output = await execute(input(), new ScriptedTransport([]))
    expect(output.filter(({ type }) => type === 'error').map((item) => item.type === 'error' ? item.error.code : '')).toEqual([
      'invalid_json', 'unsupported_version', 'invalid_message', 'invalid_message', 'invalid_message', 'session_not_found',
    ])
  })

  test('enforces the line byte limit before JSON parsing and recovers on a later chunk', async () => {
    async function* input() {
      yield `${' '.repeat(MAX_JSONL_LINE_BYTES + 1)}\n${line({ v: 1, type: 'shutdown' })}`
    }
    const output = await execute(input(), new ScriptedTransport([]))
    expect(output[0]).toMatchObject({ type: 'error', error: { code: 'line_too_large' } })
    expect(output.at(-1)).toEqual({ v: 1, type: 'shutdown' })
  })

  test('never includes input, thrown values, or credential references in errors', async () => {
    const secret = 'sk-do-not-serialize'
    const bad = { ...request, provider: { ...request.provider, apiKeyEnv: secret } }
    async function* input() {
      yield line({ v: 1, type: 'open', id: 'bad', request: bad })
      yield line({ v: 1, type: 'open', id: 'boom', request })
      yield line({ v: 1, type: 'turn', id: 'boom', prompt: 'x' })
      await pause()
      yield line({ v: 1, type: 'shutdown' })
    }
    const output = await execute(input(), new ScriptedTransport([async () => { throw new Error(secret) }]))
    expect(JSON.stringify(output)).not.toContain(secret)
  })

  test('an intent-opened session plans here and sends the plan back once', async () => {
    const intent = { name: 'Wonderlands', dimension: '3d', gameplay: 'A fantasy mmorpg with quests and loot.' }
    const { brief: _brief, ...withoutBrief } = request
    async function* input() {
      yield line({ v: 1, type: 'open', id: 'game', request: { ...withoutBrief, intent } })
      yield line({ v: 1, type: 'turn', id: 'game', prompt: 'x' })
      await pause()
      yield line({ v: 1, type: 'shutdown' })
    }
    const transport = new ScriptedTransport([{ content: 'Done.' }])
    const output = await execute(input(), transport)

    const plans = output.filter((item): item is Extract<ProtocolOutput, { type: 'plan' }> => item.type === 'plan')
    expect(plans).toHaveLength(1)
    expect(plans[0]!.plan.planVersion).toBe(2)
    expect(plans[0]!.plan.intent.name).toBe('Wonderlands')
    expect(plans[0]!.plan.reference.strategy).toBe('clone')
    // The plan lands immediately after the session exists, before any event.
    expect(output.findIndex(({ type }) => type === 'plan')).toBe(1)
    // And the model is told the plan, not a caller's own words.
    expect(transport.inputs[0]!.brief).toContain('CAPABILITY PACKETS')
  })

  test('an intent-opened session requires an explicit dimension, while explicit auto remains valid', async () => {
    const { brief: _brief, ...withoutBrief } = request
    async function* input() {
      yield line({ v: 1, type: 'open', id: 'missing', request: { ...withoutBrief, intent: { name: 'g', gameplay: 'Questing' } } })
      yield line({ v: 1, type: 'open', id: 'blank', request: { ...withoutBrief, intent: { name: 'g', dimension: ' ', gameplay: 'Questing' } } })
      yield line({ v: 1, type: 'open', id: 'null', request: { ...withoutBrief, intent: { name: 'g', dimension: null, gameplay: 'Questing' } } })
      yield line({ v: 1, type: 'open', id: 'auto', request: { ...withoutBrief, intent: { name: 'g', dimension: 'auto', gameplay: 'Questing' } } })
      yield line({ v: 1, type: 'shutdown' })
    }
    const output = await execute(input(), new ScriptedTransport([]))
    expect(output.slice(0, 3)).toEqual([
      { v: 1, type: 'error', id: 'missing', error: { code: 'missing_inputs', message: 'Engine request is missing required input.', field: 'request.intent.dimension' } },
      { v: 1, type: 'error', id: 'blank', error: { code: 'missing_inputs', message: 'Engine request is missing required input.', field: 'request.intent.dimension' } },
      { v: 1, type: 'error', id: 'null', error: { code: 'missing_inputs', message: 'Engine request is missing required input.', field: 'request.intent.dimension' } },
    ])
    expect(output).toContainEqual({ v: 1, type: 'accepted', id: 'auto', command: 'open' })
    expect(output.find((item) => item.type === 'plan' && item.id === 'auto')).toMatchObject({ plan: { intent: { dimension: 'auto' } } })
  })

  test('a brief-opened session carries no plan, which is the compatibility path', async () => {
    async function* input() {
      yield line({ v: 1, type: 'open', id: 'game', request })
      yield line({ v: 1, type: 'shutdown' })
    }
    const output = await execute(input(), new ScriptedTransport([]))
    expect(output.some(({ type }) => type === 'plan')).toBeFalse()
  })

  test('refuses a request that gives both an intent and a brief, or neither', async () => {
    const intent = { name: 'g', gameplay: 'Questing' }
    const { brief: _brief, ...withoutBrief } = request
    async function* input() {
      yield line({ v: 1, type: 'open', id: 'both', request: { ...request, intent } })
      yield line({ v: 1, type: 'open', id: 'neither', request: withoutBrief })
      yield line({ v: 1, type: 'open', id: 'bad', request: { ...withoutBrief, intent: { name: 'g', dimension: '3d' } } })
      yield line({ v: 1, type: 'shutdown' })
    }
    const output = await execute(input(), new ScriptedTransport([]))
    const errors = output.filter((item): item is Extract<ProtocolOutput, { type: 'error' }> => item.type === 'error')
    expect(errors.map(({ error }) => error.code)).toEqual([
      'invalid_message',
      'invalid_message',
      'invalid_message',
    ])
    expect(errors.map(({ error }) => error.field)).toEqual([
      'request.intent',
      'request.intent',
      'request.intent.gameplay',
    ])
  })

  test('does not reflect a huge secret-like unavailable tool name in protocol errors', async () => {
    const unsafeName = `tool-sk-private-${'x'.repeat(500)}`
    const transport = new ScriptedTransport([{ content: '', toolCalls: [{ id: 'call', name: unsafeName, arguments: {} }] }])
    async function* input() {
      yield line({ v: 1, type: 'open', id: 'game', request })
      yield line({ v: 1, type: 'turn', id: 'game', prompt: 'x' })
      await pause()
      yield line({ v: 1, type: 'shutdown' })
    }
    const output = await execute(input(), transport)
    expect(output).toContainEqual({
      v: 1,
      type: 'error',
      id: 'game',
      error: { code: 'transport_error', message: 'Model transport failed.' },
    })
    expect(JSON.stringify(output)).not.toContain(unsafeName)
  })
})
