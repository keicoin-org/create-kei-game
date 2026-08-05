import { posix, win32 } from 'node:path'

import {
  ENGINE_ERROR_MESSAGES,
  EngineError,
  EngineSession,
  type EngineEvent,
  type EngineLimits,
  type EngineRequest,
  type EngineTool,
  type ModelTransport,
} from './runtime.js'
import { resolveProvider } from './providers.js'
import { MAX_BRIEF_LENGTH, MAX_MODEL_LENGTH } from './harness.js'
import { IntentError, parseMmoIntent } from './intent.js'
import { planBrief, type ImplementationPlan } from './plan.js'
import { planMmo } from './planner.js'

export { ENGINE_ERROR_MESSAGES } from './runtime.js'

export const ENGINE_PROTOCOL_VERSION = 1 as const
export const MAX_JSONL_LINE_BYTES = 64 * 1024
export const MAX_ENGINE_SESSIONS = 16

export type ProtocolErrorCode =
  | 'invalid_json'
  | 'invalid_message'
  | 'missing_inputs'
  | 'unsupported_version'
  | 'line_too_large'
  | 'session_exists'
  | 'session_not_found'
  | 'session_busy'
  | 'session_limit'
  | 'internal_error'

export interface RuntimeFactory {
  create(request: EngineRequest): {
    readonly transport: ModelTransport
    readonly tools?: readonly EngineTool[]
    readonly limits?: Partial<EngineLimits>
  }
}

type InputCommand =
  | { readonly v: 1; readonly type: 'open'; readonly id: string; readonly request: EngineRequest }
  | { readonly v: 1; readonly type: 'turn'; readonly id: string; readonly prompt: string }
  | { readonly v: 1; readonly type: 'cancel'; readonly id: string }
  | { readonly v: 1; readonly type: 'close'; readonly id: string }
  | { readonly v: 1; readonly type: 'shutdown' }

export type ProtocolOutput =
  | { readonly v: 1; readonly type: 'accepted'; readonly id: string; readonly command: 'open' | 'turn' | 'cancel' | 'close' }
  /** The machine-readable plan, sent once per session that was opened from an intent. */
  | { readonly v: 1; readonly type: 'plan'; readonly id: string; readonly plan: ImplementationPlan }
  | { readonly v: 1; readonly type: 'event'; readonly id: string; readonly seq: number; readonly event: EngineEvent }
  | { readonly v: 1; readonly type: 'error'; readonly id?: string; readonly error: { readonly code: ProtocolErrorCode | EngineError['code']; readonly message: string; readonly field?: string } }
  | { readonly v: 1; readonly type: 'shutdown' }

type ProtocolErrorOutput = Extract<ProtocolOutput, { type: 'error' }>

interface OpenSession {
  readonly engine: EngineSession
  sequence: number
  active?: AbortController
  pending?: Promise<void>
  suppressErrors?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function protocolFailure(code: ProtocolErrorCode, message: string, id?: string, field?: string): ProtocolErrorOutput {
  return {
    v: 1,
    type: 'error',
    ...(id === undefined ? {} : { id }),
    error: { code, message, ...(field === undefined ? {} : { field }) },
  }
}

type ParsedRequest =
  | { readonly ok: true; readonly request: EngineRequest }
  | { readonly ok: false; readonly field: string; readonly code?: 'missing_inputs' }

function rejected(field: string, code?: 'missing_inputs'): ParsedRequest {
  return { ok: false, field, ...(code === undefined ? {} : { code }) }
}

/**
 * A session is opened from an `intent` — which this plans, so the plan is
 * always harness-authored and a caller cannot hand the model a description the
 * harness never derived. A raw `brief` is still accepted, as the compatibility
 * path for a caller that has its own text and no intent to plan from.
 */
function parseRequest(value: unknown): ParsedRequest {
  if (!isRecord(value)) return rejected('request')
  if (!hasOnlyKeys(value, ['workspace', 'provider', 'model', 'brief', 'intent'])) return rejected('request')
  if (typeof value.workspace !== 'string' || value.workspace.trim() === '') return rejected('request.workspace')
  if (!posix.isAbsolute(value.workspace) && !win32.isAbsolute(value.workspace)) return rejected('request.workspace')
  if (typeof value.model !== 'string' || value.model.trim() === '' || value.model.length > MAX_MODEL_LENGTH) {
    return rejected('request.model')
  }
  if ((value.brief === undefined) === (value.intent === undefined)) {
    return rejected('request.intent')
  }
  if (!isRecord(value.provider)) return rejected('request.provider')
  const provider = value.provider
  if (!hasOnlyKeys(provider, ['provider', 'protocol', 'baseUrl', 'apiKeyEnv'])) return rejected('request.provider')
  if (typeof provider.provider !== 'string') return rejected('request.provider')

  let plan: ImplementationPlan | undefined
  let brief: string
  if (value.intent === undefined) {
    if (typeof value.brief !== 'string' || value.brief.trim() === '' || value.brief.length > MAX_BRIEF_LENGTH) {
      return rejected('request.brief')
    }
    brief = value.brief
  } else {
    if (isRecord(value.intent) && (
      value.intent.dimension === undefined ||
      value.intent.dimension === null ||
      (typeof value.intent.dimension === 'string' && value.intent.dimension.trim() === '')
    )) {
      return rejected('request.intent.dimension', 'missing_inputs')
    }
    try {
      plan = planMmo(parseMmoIntent(value.intent))
    } catch (error) {
      return rejected(error instanceof IntentError ? `request.intent.${error.details.field ?? 'intent'}` : 'request.intent')
    }
    brief = planBrief(plan)
  }

  let resolved
  try {
    resolved = resolveProvider({
      provider: provider.provider,
      protocol: typeof provider.protocol === 'string' ? provider.protocol : undefined,
      baseUrl: typeof provider.baseUrl === 'string' ? provider.baseUrl : undefined,
      apiKeyEnv: typeof provider.apiKeyEnv === 'string' ? provider.apiKeyEnv : undefined,
    })
  } catch {
    return rejected('request.provider')
  }

  return {
    ok: true,
    request: {
      workspace: value.workspace,
      model: value.model,
      brief,
      provider: resolved,
      ...(plan === undefined ? {} : { plan }),
    },
  }
}

function parseCommand(value: unknown): InputCommand | ProtocolErrorOutput {
  if (!isRecord(value)) return protocolFailure('invalid_message', 'Protocol input must be one JSON object.')
  const id = typeof value.id === 'string' ? value.id : undefined
  if (value.v !== ENGINE_PROTOCOL_VERSION) {
    return protocolFailure('unsupported_version', 'Protocol version is not supported.', id, 'v')
  }
  if (value.type === 'shutdown') {
    return hasOnlyKeys(value, ['v', 'type'])
      ? { v: 1, type: 'shutdown' }
      : protocolFailure('invalid_message', 'Protocol command contains unknown fields.', undefined, 'command')
  }
  if (!id || id.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    return protocolFailure('invalid_message', 'Session id is not valid.', undefined, 'id')
  }
  switch (value.type) {
    case 'open': {
      if (!hasOnlyKeys(value, ['v', 'type', 'id', 'request'])) {
        return protocolFailure('invalid_message', 'Protocol command contains unknown fields.', id, 'command')
      }
      const parsed = parseRequest(value.request)
      return parsed.ok
        ? { v: 1, type: 'open', id, request: parsed.request }
        : protocolFailure(
          parsed.code ?? 'invalid_message',
          parsed.code === 'missing_inputs'
            ? 'Engine request is missing required input.'
            : 'Engine request is not valid.',
          id,
          parsed.field,
        )
    }
    case 'turn':
      return hasOnlyKeys(value, ['v', 'type', 'id', 'prompt']) && typeof value.prompt === 'string' && value.prompt.trim() !== ''
        ? { v: 1, type: 'turn', id, prompt: value.prompt }
        : protocolFailure('invalid_message', 'Turn prompt is not valid.', id, 'prompt')
    case 'cancel': return hasOnlyKeys(value, ['v', 'type', 'id'])
      ? { v: 1, type: 'cancel', id }
      : protocolFailure('invalid_message', 'Protocol command contains unknown fields.', id, 'command')
    case 'close': return hasOnlyKeys(value, ['v', 'type', 'id'])
      ? { v: 1, type: 'close', id }
      : protocolFailure('invalid_message', 'Protocol command contains unknown fields.', id, 'command')
    default: return protocolFailure('invalid_message', 'Protocol command is not supported.', id, 'type')
  }
}

function publicError(error: unknown, id: string): ProtocolOutput {
  if (error instanceof EngineError) {
    return {
      v: 1,
      type: 'error',
      id,
      error: { code: error.code, message: ENGINE_ERROR_MESSAGES[error.code] },
    }
  }
  return protocolFailure('internal_error', 'Engine failed unexpectedly.', id)
}

class JsonlReader {
  readonly #decoder = new TextDecoder('utf-8', { fatal: true })
  readonly #parts: Uint8Array[] = []
  #bytes = 0
  #discarding = false

  push(chunk: Uint8Array | string): Array<string | ProtocolOutput> {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk
    const lines: Array<string | ProtocolOutput> = []
    let start = 0
    for (let index = 0; index < bytes.byteLength; index += 1) {
      if (bytes[index] !== 0x0a) continue
      if (this.#discarding) {
        this.#discarding = false
      } else if (this.#append(bytes.subarray(start, index))) {
        lines.push(protocolFailure('line_too_large', 'Protocol line exceeded its byte limit.'))
        this.#clear()
      } else {
        lines.push(this.#finish())
      }
      start = index + 1
    }
    if (start < bytes.byteLength && !this.#discarding && this.#append(bytes.subarray(start))) {
      lines.push(protocolFailure('line_too_large', 'Protocol line exceeded its byte limit.'))
      this.#clear()
      this.#discarding = true
    }
    return lines
  }

  finish(): string | ProtocolOutput | undefined {
    if (this.#discarding) return undefined
    return this.#bytes === 0 ? undefined : this.#finish()
  }

  #append(part: Uint8Array): boolean {
    this.#bytes += part.byteLength
    if (part.byteLength > 0) this.#parts.push(part)
    return this.#bytes > MAX_JSONL_LINE_BYTES
  }

  #finish(): string | ProtocolOutput {
    try {
      const combined = new Uint8Array(this.#bytes)
      let offset = 0
      for (const part of this.#parts) { combined.set(part, offset); offset += part.byteLength }
      const withoutCr = combined.at(-1) === 0x0d ? combined.subarray(0, combined.byteLength - 1) : combined
      if (withoutCr.byteLength === 0) return protocolFailure('invalid_json', 'Protocol line must contain one JSON object.')
      try {
        return this.#decoder.decode(withoutCr)
      } catch {
        return protocolFailure('invalid_json', 'Protocol line must be valid UTF-8 JSON.')
      }
    } finally {
      this.#clear()
    }
  }

  #clear(): void {
    this.#parts.length = 0
    this.#bytes = 0
  }
}

export async function runJsonlEngine(
  input: AsyncIterable<Uint8Array | string>,
  write: (line: string) => void | Promise<void>,
  factory: RuntimeFactory,
): Promise<void> {
  const sessions = new Map<string, OpenSession>()
  let outputTail = Promise.resolve()
  let shuttingDown = false
  const send = (message: ProtocolOutput): Promise<void> => {
    outputTail = outputTail.then(async () => await write(`${JSON.stringify(message)}\n`))
    return outputTail
  }

  const handle = async (line: string | ProtocolOutput): Promise<void> => {
    if (typeof line !== 'string') { await send(line); return }
    let parsed: unknown
    try { parsed = JSON.parse(line) as unknown } catch { await send(protocolFailure('invalid_json', 'Protocol line must be valid JSON.')); return }
    const command = parseCommand(parsed)
    if (command.type === 'error') { await send(command); return }
    if (command.type === 'shutdown') {
      shuttingDown = true
      for (const session of sessions.values()) {
        session.suppressErrors = true
        session.active?.abort()
      }
      await Promise.allSettled([...sessions.values()].map((session) => session.pending).filter((value): value is Promise<void> => value !== undefined))
      await send({ v: 1, type: 'shutdown' })
      return
    }

    const current = sessions.get(command.id)
    if (command.type === 'open') {
      if (current) { await send(protocolFailure('session_exists', 'Session is already open.', command.id)); return }
      if (sessions.size >= MAX_ENGINE_SESSIONS) { await send(protocolFailure('session_limit', 'Open session limit reached.', command.id)); return }
      try {
        const runtime = factory.create(command.request)
        sessions.set(command.id, { engine: new EngineSession({ request: command.request, ...runtime }), sequence: 0 })
        await send({ v: 1, type: 'accepted', id: command.id, command: 'open' })
        // The plan crosses the boundary once, right after the session exists,
        // so whatever is driving this can act on the same document the model got.
        if (command.request.plan) {
          await send({ v: 1, type: 'plan', id: command.id, plan: command.request.plan })
        }
      } catch (error) { await send(publicError(error, command.id)) }
      return
    }
    if (!current) { await send(protocolFailure('session_not_found', 'Session is not open.', command.id)); return }

    if (command.type === 'cancel') {
      current.active?.abort()
      await send({ v: 1, type: 'accepted', id: command.id, command: 'cancel' })
      return
    }
    if (command.type === 'close') {
      if (current.active) { await send(protocolFailure('session_busy', 'Session has an active turn.', command.id)); return }
      sessions.delete(command.id)
      await send({ v: 1, type: 'accepted', id: command.id, command: 'close' })
      return
    }
    if (current.active) { await send(protocolFailure('session_busy', 'Session has an active turn.', command.id)); return }

    const controller = new AbortController()
    current.active = controller
    await send({ v: 1, type: 'accepted', id: command.id, command: 'turn' })
    current.pending = current.engine.runTurn(
      command.prompt,
      async (event) => {
        current.sequence += 1
        await send({ v: 1, type: 'event', id: command.id, seq: current.sequence, event })
      },
      controller.signal,
    ).catch(async (error) => {
      if (!current.suppressErrors) await send(publicError(error, command.id))
    }).finally(() => {
      current.active = undefined
      current.pending = undefined
    })
  }

  const reader = new JsonlReader()
  try {
    for await (const chunk of input) {
      if (shuttingDown) break
      const lines = reader.push(chunk)
      for (const line of lines) { await handle(line); if (shuttingDown) break }
    }
    if (!shuttingDown) {
      const final = reader.finish()
      if (final !== undefined) await handle(final)
    }
  } finally {
    for (const session of sessions.values()) session.active?.abort()
    await Promise.allSettled([...sessions.values()].map((session) => session.pending).filter((value): value is Promise<void> => value !== undefined))
    await outputTail
  }
}
