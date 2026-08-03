import { describe, expect, test } from 'bun:test'

import {
  EngineError,
  EngineSession,
  ScriptedTransport,
  deterministicTool,
  type EngineEvent,
  type EngineRequest,
  type EngineScheduler,
  type ModelMessage,
  type ModelResponse,
  type ModelTransport,
} from '../src/runtime.js'

const secret = 'sk-must-never-appear'
const request: EngineRequest = {
  workspace: '/workspace/game',
  provider: {
    provider: 'openai', protocol: 'responses', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY',
  },
  model: 'model-id',
  brief: 'Build a small game.',
}

async function run(session: EngineSession, prompt = 'Continue the game.', signal?: AbortSignal): Promise<EngineEvent[]> {
  const events: EngineEvent[] = []
  await session.runTurn(prompt, (event) => { events.push(event) }, signal)
  return events
}

describe('shared engine session', () => {
  test('persists transcript across turns and emits bounded deterministic events', async () => {
    const transport = new ScriptedTransport([{ content: 'First.' }, { content: 'Second.' }])
    const session = new EngineSession({ request, transport })
    expect(await run(session, 'One')).toEqual([
      { type: 'turn_started', turn: 1 },
      { type: 'assistant', turn: 1, content: 'First.' },
      { type: 'completed', turns: 1, outputBytes: 6 },
    ])
    await run(session, 'Two')
    expect(transport.inputs[1]!.messages.map(({ role }) => role)).toEqual(['user', 'assistant', 'user'])
  })

  test('returns a frozen transcript snapshot rather than the mutable session array', async () => {
    const session = new EngineSession({ request, transport: new ScriptedTransport([{ content: 'Done.' }]) })
    await run(session)
    const snapshot = session.messages
    expect(Object.isFrozen(snapshot)).toBeTrue()
    expect(() => (snapshot as unknown as ModelMessage[]).push({ role: 'user', content: 'Injected.' })).toThrow()
    expect(session.messages).toHaveLength(2)
  })

  test('detaches and freezes nested model tool calls across transport, tool, and public snapshots', async () => {
    const originalArguments = { nested: { value: 1 } }
    let round = 0
    const transport: ModelTransport = {
      async generate(input) {
        round += 1
        if (round === 1) {
          return { content: '', toolCalls: [{ id: 'call', name: 'edit', arguments: originalArguments }] }
        }
        const assistant = input.messages.find((message) => message.role === 'assistant')!
        expect(() => { (assistant as { content: string }).content = 'mutated' }).toThrow()
        const args = (assistant as Extract<ModelMessage, { role: 'assistant' }>).toolCalls![0]!.arguments as { nested: { value: number } }
        expect(() => { args.nested.value = 8 }).toThrow()
        return { content: 'Done.' }
      },
    }
    const session = new EngineSession({
      request,
      transport,
      tools: [deterministicTool('edit', (value) => {
        ;(value as { nested: { value: number } }).nested.value = 9
        return 'ok'
      })],
    })
    await run(session)
    originalArguments.nested.value = 7
    const snapshot = session.messages
    const assistant = snapshot.find((message) => message.role === 'assistant') as Extract<ModelMessage, { role: 'assistant' }>
    const args = assistant.toolCalls![0]!.arguments as { nested: { value: number } }
    expect(args.nested.value).toBe(1)
    expect(() => { args.nested.value = 6 }).toThrow()
    expect((session.messages.find((message) => message.role === 'assistant') as Extract<ModelMessage, { role: 'assistant' }>).toolCalls![0]!.arguments).toEqual({ nested: { value: 1 } })
  })

  test('runs deterministic tools through the same model loop without emitting arguments or results', async () => {
    const transport = new ScriptedTransport([
      { content: '', toolCalls: [{ id: 'call-1', name: 'sum', arguments: { a: 2, b: 3 } }] },
      { content: 'Five.' },
    ])
    const session = new EngineSession({
      request,
      transport,
      tools: [deterministicTool('sum', (value) => {
        const args = value as { a: number; b: number }
        return { answer: args.a + args.b }
      })],
    })
    const events = await run(session)
    expect(events.map(({ type }) => type)).toEqual([
      'turn_started', 'tool_started', 'tool_finished', 'turn_started', 'assistant', 'completed',
    ])
    expect(JSON.stringify(events)).not.toContain('answer')
    expect(transport.inputs[1]!.messages.at(-1)).toEqual({ role: 'tool', callId: 'call-1', name: 'sum', content: '{"answer":5}' })
  })

  test('rolls back all partial history after transport, tool, cancellation, and limit failures', async () => {
    const cases: Array<{ response: ModelResponse | ((signal: AbortSignal) => Promise<ModelResponse>); options?: ConstructorParameters<typeof EngineSession>[0]['limits']; tool?: ReturnType<typeof deterministicTool>; expected: string }> = [
      { response: async () => { throw new Error(secret) }, expected: 'transport_error' },
      { response: { content: 'partial', toolCalls: [{ id: 'x', name: 'bad', arguments: {} }] }, tool: deterministicTool('bad', () => { throw new Error(secret) }), expected: 'tool_error' },
      { response: { content: 'too long' }, options: { maxOutputBytes: 1 }, expected: 'output_limit' },
    ]
    for (const item of cases) {
      const session = new EngineSession({ request, transport: new ScriptedTransport([item.response]), tools: item.tool ? [item.tool] : [], limits: item.options })
      await expect(run(session)).rejects.toMatchObject({ code: item.expected })
      expect(session.messages).toEqual([])
    }

    const waiting = new ScriptedTransport([() => new Promise<ModelResponse>(() => {})])
    const cancelled = new EngineSession({ request, transport: waiting })
    const controller = new AbortController()
    const pending = run(cancelled, 'secret prompt', controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    expect(cancelled.messages).toEqual([])

    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    const neverStarts = new ScriptedTransport([{ content: secret }])
    const preCancelled = new EngineSession({ request, transport: neverStarts })
    await expect(run(preCancelled, 'no start', alreadyAborted.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(preCancelled.messages).toEqual([])
  })

  test('refuses concurrent direct turns and becomes reusable after cancellation', async () => {
    let release!: (value: ModelResponse) => void
    const transport = new ScriptedTransport([
      () => new Promise<ModelResponse>((resolve) => { release = resolve }),
      { content: 'Later.' },
    ])
    const session = new EngineSession({ request, transport })
    const controller = new AbortController()
    const first = run(session, 'First', controller.signal)
    await expect(run(session, 'Overlap')).rejects.toMatchObject({ code: 'invalid_runtime' })
    controller.abort()
    await expect(first).rejects.toMatchObject({ code: 'cancelled' })
    release({ content: 'Ignored.' })
    await expect(run(session, 'After')).resolves.toBeArray()
  })

  test('enforces turn, call, argument, per-result, and cumulative-result bounds', async () => {
    const tool = deterministicTool('echo', (value) => value)
    const failures = [
      new EngineSession({ request, transport: new ScriptedTransport([{ content: '', toolCalls: [{ id: '1', name: 'echo', arguments: {} }] }]), tools: [tool], limits: { maxTurns: 1 } }),
      new EngineSession({ request, transport: new ScriptedTransport([{ content: '', toolCalls: [{ id: '1', name: 'echo', arguments: {} }, { id: '2', name: 'echo', arguments: {} }] }]), tools: [tool], limits: { maxToolCallsPerTurn: 1 } }),
      new EngineSession({ request, transport: new ScriptedTransport([{ content: '', toolCalls: [{ id: '1', name: 'echo', arguments: 'xx' }] }]), tools: [tool], limits: { maxToolArgumentBytes: 3 } }),
      new EngineSession({ request, transport: new ScriptedTransport([{ content: '', toolCalls: [{ id: '1', name: 'echo', arguments: 'xx' }] }]), tools: [tool], limits: { maxToolResultBytes: 1 } }),
      new EngineSession({ request, transport: new ScriptedTransport([{ content: '', toolCalls: [{ id: '1', name: 'echo', arguments: 'a' }, { id: '2', name: 'echo', arguments: 'b' }] }]), tools: [tool], limits: { maxToolResultBytes: 10, maxToolResultTotalBytes: 1 } }),
    ]
    const codes = ['turn_limit', 'tool_call_limit', 'tool_argument_limit', 'tool_result_limit', 'tool_result_limit']
    for (let index = 0; index < failures.length; index += 1) {
      await expect(run(failures[index]!)).rejects.toMatchObject({ code: codes[index] })
      expect(failures[index]!.messages).toEqual([])
    }
  })

  test('bounds direct prompts and model-supplied tool identifiers without reflecting them', async () => {
    const promptSession = new EngineSession({ request, transport: new ScriptedTransport([]), limits: { maxPromptBytes: 3 } })
    await expect(run(promptSession, 'four')).rejects.toMatchObject({ code: 'prompt_limit' })
    expect(promptSession.messages).toEqual([])

    const unsafeName = `tool-${secret}-${'x'.repeat(200)}`
    const callSession = new EngineSession({
      request,
      transport: new ScriptedTransport([{ content: '', toolCalls: [{ id: 'id', name: unsafeName, arguments: {} }] }]),
      limits: { maxToolNameBytes: 16 },
    })
    try { await run(callSession); throw new Error('expected failure') } catch (error) {
      expect(error).toMatchObject({ code: 'transport_error' })
      expect(JSON.stringify(error)).not.toContain(unsafeName)
    }

    const unsafeId = `id-${secret}-${'x'.repeat(200)}`
    const idSession = new EngineSession({
      request,
      transport: new ScriptedTransport([{ content: '', toolCalls: [{ id: unsafeId, name: 'missing', arguments: {} }] }]),
      limits: { maxToolCallIdBytes: 16 },
    })
    try { await run(idSession); throw new Error('expected failure') } catch (error) {
      expect(JSON.stringify(error)).not.toContain(unsafeId)
    }

    const unavailable = `missing-${secret}`
    const missingSession = new EngineSession({
      request,
      transport: new ScriptedTransport([{ content: '', toolCalls: [{ id: 'id', name: unavailable, arguments: {} }] }]),
    })
    try { await run(missingSession); throw new Error('expected failure') } catch (error) {
      expect(error).toMatchObject({ code: 'tool_not_found' })
      expect(JSON.stringify(error)).not.toContain(unavailable)
    }
  })

  test('bounds retained session history across otherwise valid repeated turns', async () => {
    const session = new EngineSession({
      request,
      transport: new ScriptedTransport([{ content: 'b' }, { content: 'd' }]),
      limits: { maxHistoryBytes: 2 },
    })
    await run(session, 'a')
    await expect(run(session, 'c')).rejects.toMatchObject({ code: 'history_limit' })
    expect(session.messages).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ])
  })

  test('uses injected scheduling for deterministic wall-time cancellation', async () => {
    let timeout!: () => void
    const scheduler: EngineScheduler = {
      setTimeout(callback) { timeout = callback; return 1 },
      clearTimeout() {},
    }
    const session = new EngineSession({
      request,
      transport: new ScriptedTransport([() => new Promise<ModelResponse>(() => {})]),
      scheduler,
      limits: { maxWallTimeMs: 10 },
    })
    const pending = run(session)
    timeout()
    await expect(pending).rejects.toMatchObject({ code: 'timeout' })
    expect(session.messages).toEqual([])
  })

  test('never exposes thrown transport/tool values through stable errors', async () => {
    for (const thrown of [new Error(secret), new EngineError('transport_error', secret, { field: secret })]) {
      const session = new EngineSession({ request, transport: new ScriptedTransport([async () => { throw thrown }]) })
      try { await run(session); throw new Error('expected failure') } catch (error) {
        expect(error).toBeInstanceOf(EngineError)
        expect(error).toMatchObject({ code: 'transport_error', message: 'Model transport failed.' })
        expect(JSON.stringify(error)).not.toContain(secret)
        expect(String(error)).not.toContain(secret)
      }
    }
  })
})
