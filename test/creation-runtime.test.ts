import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { nodeToolFs, nodeToolPath } from '../src/adapters.js'
import {
  FIRST_TURN_PROMPT,
  createCreationRuntime,
  creationRuntimeFactory,
  runCreationTurn,
  type CreationRuntimeOptions,
} from '../src/creation-runtime.js'
import type { HttpFetch, HttpRequest } from '../src/provider-transport.js'
import { resolveProvider } from '../src/providers.js'
import type { EngineEvent, EngineRequest } from '../src/runtime.js'
import { runJsonlEngine, type ProtocolOutput } from '../src/runtime-protocol.js'

const secret = 'sk-creation-secret-never-leaked'
const environment = Object.freeze({ TEST_CREATION_KEY: secret })
const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'create-kei-mmo-run-'))
  roots.push(root)
  return root
}

function request(root: string): EngineRequest {
  return {
    workspace: root,
    provider: resolveProvider({ provider: 'openai', apiKeyEnv: 'TEST_CREATION_KEY' }),
    model: 'model-id',
    brief: 'Build a tiny cooperative puzzle.',
  }
}

/** One scripted `/responses` reply per model round, in order. */
function scriptedFetch(replies: readonly unknown[]): {
  fetch: HttpFetch
  sent: Array<{ url: string; request: HttpRequest }>
} {
  const sent: Array<{ url: string; request: HttpRequest }> = []
  const queue = [...replies]
  const fetch: HttpFetch = async (url, httpRequest) => {
    sent.push({ url, request: httpRequest })
    const reply = queue.shift()
    if (reply === undefined) throw new Error('scripted replies exhausted')
    const body = JSON.stringify(reply)
    return { ok: true, status: 200, async text() { return body } }
  }
  return { fetch, sent }
}

function options(fetch: HttpFetch): CreationRuntimeOptions {
  return { fetch, environment, fs: nodeToolFs, path: nodeToolPath }
}

const writeMain = {
  output: [
    { type: 'message', content: [{ type: 'output_text', text: 'Writing the entry point.' }] },
    {
      type: 'function_call',
      call_id: 'call-1',
      name: 'write_file',
      arguments: JSON.stringify({ path: 'src/main.ts', content: 'export function start() {}\n' }),
    },
  ],
}

const listFirst = {
  output: [{ type: 'function_call', call_id: 'call-0', name: 'list_files', arguments: '{}' }],
}

const finished = {
  output: [{ type: 'message', content: [{ type: 'output_text', text: 'The puzzle is in place.' }] }],
}

describe('a launched turn, end to end over a scripted provider', () => {
  test('runs the model/tool loop and writes real files into the workspace', async () => {
    const root = workspace()
    const script = scriptedFetch([listFirst, writeMain, finished])
    const events: EngineEvent[] = []
    const summary = await runCreationTurn(request(root), options(script.fetch), (event) => events.push(event))

    expect(summary).toMatchObject({ turns: 3, toolCalls: 2, summary: 'The puzzle is in place.' })
    expect(summary.written).toEqual(['src/main.ts'])
    expect(readFileSync(join(root, 'src', 'main.ts'), 'utf8')).toBe('export function start() {}\n')
    expect(events.map((event) => event.type)).toEqual([
      'turn_started', 'tool_started', 'tool_finished',
      'turn_started', 'assistant', 'tool_started', 'tool_finished',
      'turn_started', 'assistant', 'completed',
    ])
  })

  test('sends the tools, the brief, and the first-turn prompt to the provider', async () => {
    const root = workspace()
    const script = scriptedFetch([finished])
    await runCreationTurn(request(root), options(script.fetch))

    const body = JSON.parse(script.sent[0]!.request.body) as {
      instructions: string
      tools: Array<{ name: string }>
      input: Array<{ content?: Array<{ text: string }> }>
    }
    expect(script.sent[0]!.url).toBe('https://api.openai.com/v1/responses')
    expect(body.tools.map((tool) => tool.name)).toEqual(['list_files', 'read_file', 'write_file'])
    expect(body.instructions).toContain('Build a tiny cooperative puzzle.')
    expect(body.instructions).toContain(root)
    expect(body.input[0]!.content![0]!.text).toBe(FIRST_TURN_PROMPT)
  })

  test('feeds a tool result back so the next round sees it', async () => {
    const root = workspace()
    const script = scriptedFetch([writeMain, finished])
    await runCreationTurn(request(root), options(script.fetch))

    const second = JSON.parse(script.sent[1]!.request.body) as {
      input: Array<{ type: string; call_id?: string; output?: string }>
    }
    const result = second.input.find((item) => item.type === 'function_call_output')
    expect(result?.call_id).toBe('call-1')
    expect(result?.output).toContain('"ok":true')
    expect(result?.output).toContain('src/main.ts')
  })

  test('a tool refusal is a result the model can correct, not a failed turn', async () => {
    const root = workspace()
    const escape = {
      output: [{
        type: 'function_call',
        call_id: 'call-x',
        name: 'write_file',
        arguments: JSON.stringify({ path: '../planted.txt', content: 'x' }),
      }],
    }
    const script = scriptedFetch([escape, finished])
    const summary = await runCreationTurn(request(root), options(script.fetch))

    expect(summary.turns).toBe(2)
    expect(summary.written).toEqual([])
    expect(existsSync(join(root, '..', 'planted.txt'))).toBeFalse()
    const second = JSON.parse(script.sent[1]!.request.body) as { input: Array<{ output?: string }> }
    expect(second.input.find((item) => item.output !== undefined)?.output).toContain('"ok":false')
  })

  test('refuses to write the harness credential into the project', async () => {
    const root = workspace()
    const plant = {
      output: [{
        type: 'function_call',
        call_id: 'call-s',
        name: 'write_file',
        arguments: JSON.stringify({ path: 'src/config.ts', content: `export const key = '${secret}'` }),
      }],
    }
    const script = scriptedFetch([plant, finished])
    const summary = await runCreationTurn(request(root), options(script.fetch))

    expect(summary.written).toEqual([])
    expect(existsSync(join(root, 'src', 'config.ts'))).toBeFalse()
  })

  test('the credential reaches the provider header and nothing else', async () => {
    const root = workspace()
    const script = scriptedFetch([writeMain, finished])
    await runCreationTurn(request(root), options(script.fetch))

    for (const call of script.sent) {
      expect(call.request.headers.authorization).toBe(`Bearer ${secret}`)
      expect(call.request.body).not.toContain(secret)
    }
    expect(readFileSync(join(root, 'src', 'main.ts'), 'utf8')).not.toContain(secret)
  })

  test('an unset credential fails with a stable code before anything is written', async () => {
    const root = workspace()
    const script = scriptedFetch([writeMain])
    await expect(runCreationTurn(request(root), { ...options(script.fetch), environment: {} }))
      .rejects.toMatchObject({ code: 'credential_unset' })
    expect(script.sent).toHaveLength(0)
    expect(existsSync(join(root, 'src'))).toBeFalse()
  })

  test('a provider rejection surfaces as a stable code, not the provider prose', async () => {
    const root = workspace()
    const fetch: HttpFetch = async () => ({
      ok: false,
      status: 401,
      async text() { return `{"error":"invalid key ${secret}"}` },
    })
    let thrown: unknown
    try { await runCreationTurn(request(root), options(fetch)) } catch (error) { thrown = error }
    expect(thrown).toMatchObject({ code: 'provider_auth_error' })
    expect((thrown as Error).message).not.toContain(secret)
  })

  test('honours lowered limits from the embedder', async () => {
    const root = workspace()
    const script = scriptedFetch([listFirst, writeMain, finished])
    await expect(runCreationTurn(
      request(root),
      { ...options(script.fetch), limits: { maxTurns: 2 } },
    )).rejects.toMatchObject({ code: 'turn_limit' })
  })
})

describe('the same runtime behind the JSONL boundary', () => {
  test('a turn over the protocol writes files and reports the same events', async () => {
    const root = workspace()
    const script = scriptedFetch([writeMain, finished])
    const commands = [
      { v: 1, type: 'open', id: 'game', request: request(root) },
      { v: 1, type: 'turn', id: 'game', prompt: 'Build the puzzle.' },
    ]

    const written: ProtocolOutput[] = []
    // `turn` is acknowledged and then runs in the background, so the stream has
    // to stay open until the session reports it is finished.
    const input = (async function* () {
      for (const command of commands) yield `${JSON.stringify(command)}\n`
      while (!written.some((line) => line.type === 'event' && line.event.type === 'completed')) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      yield `${JSON.stringify({ v: 1, type: 'shutdown' })}\n`
    })()

    await runJsonlEngine(input, (line) => { written.push(JSON.parse(line) as ProtocolOutput) }, creationRuntimeFactory(options(script.fetch)))

    expect(written.map((line) => line.type)).toEqual([
      'accepted', 'accepted', 'event', 'event', 'event', 'event', 'event', 'event', 'event', 'shutdown',
    ])
    expect(readFileSync(join(root, 'src', 'main.ts'), 'utf8')).toBe('export function start() {}\n')
    const toolEvents = written.filter((line): line is Extract<ProtocolOutput, { type: 'event' }> => line.type === 'event')
    expect(toolEvents.map((line) => line.event.type)).toEqual([
      'turn_started', 'assistant', 'tool_started', 'tool_finished',
      'turn_started', 'assistant', 'completed',
    ])
    // The boundary reports that a tool ran and how big its result was. It does
    // not repeat the arguments or the contents back over the wire.
    expect(JSON.stringify(written)).not.toContain('export function start')
    expect(JSON.stringify(written)).not.toContain(secret)
  })

  test('the factory builds one workspace tool set per session request', () => {
    const script = scriptedFetch([])
    const first = createCreationRuntime(request(workspace()), options(script.fetch))
    const second = createCreationRuntime(request(workspace()), options(script.fetch))
    expect(first.tools.map((tool) => tool.definition.name)).toEqual(['list_files', 'read_file', 'write_file'])
    expect(first.written).not.toBe(second.written)
  })
})
