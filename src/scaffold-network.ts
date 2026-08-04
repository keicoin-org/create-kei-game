/** Project-owned networking emitted into every generated MMO. */

import type { WorkspaceFile } from './source.js'

export const CONNECTION_PATH = 'src/client/connection.ts'
export const ACTION_REDUCER_PATH = 'src/client/action-events.ts'
export const HEADLESS_CLIENT_PATH = 'src/client/headless.ts'
export const RESTART_PROOF_PATH = 'src/client/restart-proof.ts'
export const SERVER_PATH = 'src/server/main.ts'
export const PERSISTENCE_PATH = 'src/server/persistence.ts'
export const PROTOCOL_PATH = 'src/shared/protocol.ts'
export const ACTION_PATH = 'src/shared/actions.ts'
export const DEV_SERVER_PATH = 'src/server/dev-server.mjs'
export const HEADLESS_CLIENT_BUNDLE = 'headless/headless.js'
export const DEV_SERVICE = 'kei-game-server'
export const GAME_PROTOCOL_VERSION = 2
export const GAME_SOCKET_PATH = '/game'
export const WEBSOCKET_PACKAGE = 'ws'
export const WEBSOCKET_RANGE = '^8.18.3'

export function networkProjectFiles(projectSlug: string): readonly WorkspaceFile[] {
  return Object.freeze([
    { path: ACTION_PATH, contents: actionSource() },
    { path: PROTOCOL_PATH, contents: protocolSource() },
    { path: ACTION_REDUCER_PATH, contents: actionReducerSource() },
    { path: CONNECTION_PATH, contents: connectionSource(projectSlug) },
    { path: HEADLESS_CLIENT_PATH, contents: headlessSource() },
    { path: RESTART_PROOF_PATH, contents: restartProofSource() },
    { path: SERVER_PATH, contents: serverSource() },
    { path: PERSISTENCE_PATH, contents: persistenceSource() },
    { path: DEV_SERVER_PATH, contents: devServerSource() },
  ])
}

function actionSource(): string {
  return `/** Versioned semantic contract for the training-sentinel authority slice. */
export const ACTION_VERSION = 1 as const
export const TRAINING_SENTINEL_ID = 'training-sentinel' as const
export const ACTION_RANGE = 2
export const ACTION_ANTICIPATION_TICKS = 2
export const ACTION_RECOVERY_TICKS = 2
export const ACTION_COOLDOWN_TICKS = 4
export const MAX_ACTION_EVENTS = 32
export const XP_PER_ACTION_CONTACT = 10

export type ActionKind = 'interact' | 'strike'
export type ActionPhase = 'anticipation' | 'contact' | 'recovery'
export type ActionOutcome = 'accepted' | 'applied' | 'completed'

export interface ActionIntent {
  readonly actionVersion: typeof ACTION_VERSION
  readonly kind: ActionKind
  readonly targetId: typeof TRAINING_SENTINEL_ID
}

export interface ActionEvent {
  readonly actionVersion: typeof ACTION_VERSION
  readonly eventId: number
  readonly tick: number
  readonly actorId: string
  readonly targetId: typeof TRAINING_SENTINEL_ID
  readonly kind: ActionKind
  readonly phase: ActionPhase
  readonly outcome: ActionOutcome
  readonly contact: boolean
}

export interface SentinelState {
  readonly id: typeof TRAINING_SENTINEL_ID
  readonly x: number
  readonly y: number
  readonly z: number
  readonly interactions: number
  readonly strikes: number
}

export interface EncounterState {
  readonly sentinel: SentinelState
  readonly events: readonly ActionEvent[]
}

export function emptyEncounter(): EncounterState {
  return {
    sentinel: { id: TRAINING_SENTINEL_ID, x: 0, y: 0, z: 0, interactions: 0, strikes: 0 },
    events: [],
  }
}
`
}

function actionReducerSource(): string {
  return `import type { ActionEvent } from '../shared/actions.js'
import type { WorldState } from '../shared/simulation.js'

export interface ActionFeedback {
  readonly eventId: number
  readonly phase: ActionEvent['phase']
  readonly kind: ActionEvent['kind']
  readonly contact: boolean
  readonly actorId: string
  readonly targetId: ActionEvent['targetId']
}

export interface ActionEventReducer {
  readonly lastEventId: () => number
  readonly reduce: (world: WorldState) => readonly ActionFeedback[]
}

/** Duplicate and older snapshots cannot replay presentation feedback. */
export function createActionEventReducer(initialEventId = 0): ActionEventReducer {
  let last = initialEventId
  return {
    lastEventId: () => last,
    reduce(world) {
      const feedback: ActionFeedback[] = []
      const ordered = [...world.encounter.events].sort((left, right) => left.eventId - right.eventId)
      for (const event of ordered) {
        if (event.eventId <= last) continue
        last = event.eventId
        feedback.push({
          eventId: event.eventId,
          phase: event.phase,
          kind: event.kind,
          contact: event.contact,
          actorId: event.actorId,
          targetId: event.targetId,
        })
      }
      return feedback
    },
  }
}
`
}

function protocolSource(): string {
  return `import {
  ACTION_VERSION,
  MAX_ACTION_EVENTS,
  TRAINING_SENTINEL_ID,
  type ActionEvent,
  type ActionIntent,
  type EncounterState,
} from './actions.js'
import { levelForXp, type PlayerInput, type WorldState } from './simulation.js'

export const PROTOCOL_VERSION = ${GAME_PROTOCOL_VERSION} as const
export const GAME_PATH = '${GAME_SOCKET_PATH}'
export const MAX_MESSAGE_BYTES = 64 * 1024

export interface HelloMessage {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'hello'
  readonly resumeToken?: string
}

export interface InputMessage extends PlayerInput {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'input'
}

export interface ActionMessage extends ActionIntent {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'action'
  readonly seq: number
}

export type ClientMessage = HelloMessage | InputMessage | ActionMessage

export interface WelcomeMessage {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'welcome'
  readonly playerId: string
  /** Present only for a newly created character. Resume returns it once. */
  readonly resumeToken?: string
  readonly snapshot: WorldState
}

export interface SnapshotMessage {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'snapshot'
  readonly ackSeq: number
  readonly world: WorldState
}

export type RefusalCode =
  | 'protocol_mismatch'
  | 'invalid_message'
  | 'authority_violation'
  | 'stale_input'
  | 'session_order'
  | 'rate_limited'
  | 'origin_refused'
  | 'server_busy'
  | 'resume_refused'
  | 'resume_in_use'
  | 'action_target_refused'
  | 'action_too_far'
  | 'action_busy'
  | 'action_cooldown'

export interface RefusedMessage {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'refused'
  readonly code: RefusalCode
}

export type ServerMessage = WelcomeMessage | SnapshotMessage | RefusedMessage
export type DecodeResult =
  | { readonly ok: true; readonly message: ClientMessage }
  | { readonly ok: false; readonly code: RefusalCode }

const AUTHORITY_KEYS = new Set([
  'position', 'x', 'y', 'z', 'tick', 'players', 'xp', 'level', 'progression',
  'balance', 'balances', 'currency', 'inventory', 'items', 'seed', 'wallet', 'walletSeed',
  'item', 'mint', 'transfer', 'settlement', 'settlementResult', 'playerId', 'state',
  'damage', 'health', 'outcome', 'contact', 'eventId', 'actorId', 'phase',
])
const REFUSAL_CODES = new Set<RefusalCode>([
  'protocol_mismatch', 'invalid_message', 'authority_violation',
  'stale_input', 'session_order', 'rate_limited', 'origin_refused', 'server_busy',
  'resume_refused', 'resume_in_use', 'action_target_refused', 'action_too_far',
  'action_busy', 'action_cooldown',
])
const RESUME_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function finiteAxis(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1
}

export function decodeClientMessage(raw: string): DecodeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, code: 'invalid_message' }
  }
  const value = record(parsed)
  if (value === null) return { ok: false, code: 'invalid_message' }
  if (
    value.type === 'teleport' ||
    value.type === 'state' ||
    Object.keys(value).some((key) => AUTHORITY_KEYS.has(key))
  ) {
    return { ok: false, code: 'authority_violation' }
  }
  if (value.v !== PROTOCOL_VERSION) return { ok: false, code: 'protocol_mismatch' }
  if (value.type === 'hello') {
    if (exact(value, ['v', 'type'])) {
      return { ok: true, message: { v: PROTOCOL_VERSION, type: 'hello' } }
    }
    return exact(value, ['v', 'type', 'resumeToken']) && typeof value.resumeToken === 'string'
      ? { ok: true, message: { v: PROTOCOL_VERSION, type: 'hello', resumeToken: value.resumeToken } }
      : { ok: false, code: 'invalid_message' }
  }
  if (value.type === 'input') {
    if (!exact(value, ['v', 'type', 'seq', 'moveX', 'moveY', 'buttons'])) {
      return { ok: false, code: 'invalid_message' }
    }
    if (
      !Number.isSafeInteger(value.seq) ||
      (value.seq as number) < 0 ||
      !finiteAxis(value.moveX) ||
      !finiteAxis(value.moveY) ||
      !Number.isSafeInteger(value.buttons) ||
      (value.buttons as number) < 0 ||
      value.buttons !== 0
    ) {
      return { ok: false, code: 'invalid_message' }
    }
    return {
      ok: true,
      message: {
        v: PROTOCOL_VERSION,
        type: 'input',
        seq: value.seq as number,
        moveX: value.moveX,
        moveY: value.moveY,
        buttons: value.buttons as number,
      },
    }
  }
  if (value.type === 'action') {
    if (!exact(value, ['v', 'type', 'seq', 'actionVersion', 'kind', 'targetId'])) {
      return { ok: false, code: 'invalid_message' }
    }
    if (!Number.isSafeInteger(value.seq) || (value.seq as number) < 0 || value.actionVersion !== ACTION_VERSION) {
      return { ok: false, code: 'invalid_message' }
    }
    if (value.kind !== 'interact' && value.kind !== 'strike') {
      return { ok: false, code: 'invalid_message' }
    }
    if (value.targetId !== TRAINING_SENTINEL_ID) {
      return { ok: false, code: 'action_target_refused' }
    }
    return {
      ok: true,
      message: {
        v: PROTOCOL_VERSION,
        type: 'action',
        seq: value.seq as number,
        actionVersion: ACTION_VERSION,
        kind: value.kind,
        targetId: TRAINING_SENTINEL_ID,
      },
    }
  }
  return { ok: false, code: 'invalid_message' }
}

function actionEventOf(value: unknown): ActionEvent | null {
  const event = record(value)
  if (
    event === null ||
    !exact(event, ['actionVersion', 'eventId', 'tick', 'actorId', 'targetId', 'kind', 'phase', 'outcome', 'contact']) ||
    event.actionVersion !== ACTION_VERSION ||
    !Number.isSafeInteger(event.eventId) || (event.eventId as number) < 1 ||
    !Number.isSafeInteger(event.tick) || (event.tick as number) < 0 ||
    typeof event.actorId !== 'string' || event.actorId.length < 1 || event.actorId.length > 128 ||
    event.targetId !== TRAINING_SENTINEL_ID ||
    (event.kind !== 'interact' && event.kind !== 'strike') ||
    (event.phase !== 'anticipation' && event.phase !== 'contact' && event.phase !== 'recovery') ||
    (event.outcome !== 'accepted' && event.outcome !== 'applied' && event.outcome !== 'completed') ||
    typeof event.contact !== 'boolean' || event.contact !== (event.phase === 'contact')
  ) return null
  return event as unknown as ActionEvent
}

function encounterOf(value: unknown, worldTick: number): EncounterState | null {
  const encounter = record(value)
  if (encounter === null || !exact(encounter, ['sentinel', 'events']) || !Array.isArray(encounter.events)) return null
  const sentinel = record(encounter.sentinel)
  if (
    sentinel === null ||
    !exact(sentinel, ['id', 'x', 'y', 'z', 'interactions', 'strikes']) ||
    sentinel.id !== TRAINING_SENTINEL_ID ||
    typeof sentinel.x !== 'number' || !Number.isFinite(sentinel.x) ||
    typeof sentinel.y !== 'number' || !Number.isFinite(sentinel.y) ||
    typeof sentinel.z !== 'number' || !Number.isFinite(sentinel.z) ||
    !Number.isSafeInteger(sentinel.interactions) || (sentinel.interactions as number) < 0 ||
    !Number.isSafeInteger(sentinel.strikes) || (sentinel.strikes as number) < 0 ||
    encounter.events.length > MAX_ACTION_EVENTS
  ) return null
  const events = encounter.events.map(actionEventOf)
  if (events.some((event) => event === null || event.tick > worldTick)) return null
  for (let index = 1; index < events.length; index += 1) {
    if (
      (events[index]?.eventId ?? 0) <= (events[index - 1]?.eventId ?? 0) ||
      (events[index]?.tick ?? 0) < (events[index - 1]?.tick ?? 0)
    ) return null
  }
  return { sentinel: sentinel as unknown as EncounterState['sentinel'], events: events as readonly ActionEvent[] }
}

function worldOf(value: unknown): WorldState | null {
  const candidate = record(value)
  if (
    candidate === null ||
    !exact(candidate, ['tick', 'players', 'encounter']) ||
    !Number.isSafeInteger(candidate.tick) ||
    (candidate.tick as number) < 0
  ) return null
  const players = record(candidate.players)
  if (players === null) return null
  for (const player of Object.values(players)) {
    const position = record(player)
    if (
      position === null ||
      !exact(position, ['x', 'y', 'z', 'xp', 'level']) ||
      typeof position.x !== 'number' || !Number.isFinite(position.x) ||
      typeof position.y !== 'number' || !Number.isFinite(position.y) ||
      typeof position.z !== 'number' || !Number.isFinite(position.z) ||
      !Number.isSafeInteger(position.xp) || (position.xp as number) < 0 ||
      !Number.isSafeInteger(position.level) ||
      position.level !== levelForXp(position.xp as number)
    ) return null
  }
  const encounter = encounterOf(candidate.encounter, candidate.tick as number)
  return encounter === null
    ? null
    : { tick: candidate.tick as number, players: players as WorldState['players'], encounter }
}

export function serverMessageOf(raw: string): ServerMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const value = record(parsed)
  if (value === null || value.v !== PROTOCOL_VERSION) return null
  if (
    value.type === 'refused' &&
    exact(value, ['v', 'type', 'code']) &&
    typeof value.code === 'string' &&
    REFUSAL_CODES.has(value.code as RefusalCode)
  ) return value as unknown as RefusedMessage
  if (value.type === 'welcome' && typeof value.playerId === 'string') {
    const resumed = exact(value, ['v', 'type', 'playerId', 'snapshot'])
    const created = exact(value, ['v', 'type', 'playerId', 'resumeToken', 'snapshot']) &&
      typeof value.resumeToken === 'string' && RESUME_TOKEN_PATTERN.test(value.resumeToken)
    if (!resumed && !created) return null
    const snapshot = worldOf(value.snapshot)
    if (snapshot === null) return null
    return created
      ? { v: PROTOCOL_VERSION, type: 'welcome', playerId: value.playerId, resumeToken: value.resumeToken as string, snapshot }
      : { v: PROTOCOL_VERSION, type: 'welcome', playerId: value.playerId, snapshot }
  }
  if (value.type === 'snapshot' && Number.isSafeInteger(value.ackSeq)) {
    if (!exact(value, ['v', 'type', 'ackSeq', 'world'])) return null
    const world = worldOf(value.world)
    return world === null ? null : { v: PROTOCOL_VERSION, type: 'snapshot', ackSeq: value.ackSeq as number, world }
  }
  return null
}

export function refused(code: RefusalCode): RefusedMessage {
  return { v: PROTOCOL_VERSION, type: 'refused', code }
}
`
}

function connectionSource(projectSlug: string): string {
  return `import { ACTION_VERSION, type ActionIntent } from '../shared/actions.js'
import {
  GAME_PATH,
  PROTOCOL_VERSION,
  serverMessageOf,
  type RefusalCode,
  type SnapshotMessage,
} from '../shared/protocol.js'
import type { PlayerInput, WorldState } from '../shared/simulation.js'
import { createActionEventReducer, type ActionFeedback } from './action-events.js'

export const RESUME_STORAGE_KEY = ${JSON.stringify(`kei-game:${projectSlug}:resume-token`)}

export class GameConnectionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'GameConnectionError'
  }
}

export interface GameConnection {
  readonly playerId: string
  /** The opaque server-issued capability. Keep it private; never log it. */
  readonly resumeToken: string
  readonly world: () => WorldState
  readonly sendInput: (input: PlayerInput) => void
  readonly sendAction: (intent: ActionIntent & { readonly seq: number }) => void
  readonly sendRaw: (value: unknown) => void
  readonly waitForSnapshot: (predicate: (message: SnapshotMessage) => boolean, timeoutMs?: number) => Promise<SnapshotMessage>
  readonly waitForRefusal: (code: RefusalCode, timeoutMs?: number) => Promise<void>
  readonly onSnapshot: (listener: (world: WorldState) => void) => () => void
  readonly onActionFeedback: (listener: (feedback: readonly ActionFeedback[]) => void) => () => void
  readonly close: () => void
}

function socketUrl(value: string): string {
  const url = new URL(value)
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:'
  url.pathname = GAME_PATH
  url.search = ''
  url.searchParams.set('protocol', String(PROTOCOL_VERSION))
  return url.href
}

export function connectGame(value: string, resumeToken?: string, timeoutMs = 5_000): Promise<GameConnection> {
  return new Promise<GameConnection>((resolve, reject) => {
    const socket = new WebSocket(socketUrl(value))
    let current: WorldState | null = null
    let settled = false
    const snapshotWaiters = new Set<{
      predicate: (message: SnapshotMessage) => boolean
      resolve: (message: SnapshotMessage) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }>()
    const refusalWaiters = new Set<{
      code: RefusalCode
      resolve: () => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }>()
    const listeners = new Set<(world: WorldState) => void>()
    const actionListeners = new Set<(feedback: readonly ActionFeedback[]) => void>()
    const actions = createActionEventReducer()
    const opening = setTimeout(() => {
      socket.close()
      reject(new GameConnectionError('connect_timeout', 'The game server did not welcome this client in time.'))
    }, timeoutMs)

    const failWaiters = (error: Error): void => {
      for (const waiter of snapshotWaiters) { clearTimeout(waiter.timer); waiter.reject(error) }
      for (const waiter of refusalWaiters) { clearTimeout(waiter.timer); waiter.reject(error) }
      snapshotWaiters.clear()
      refusalWaiters.clear()
    }

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify(resumeToken === undefined
        ? { v: PROTOCOL_VERSION, type: 'hello' }
        : { v: PROTOCOL_VERSION, type: 'hello', resumeToken }))
    })
    socket.addEventListener('message', (event) => {
      const message = serverMessageOf(String(event.data))
      if (message === null) {
        const error = new GameConnectionError('invalid_server_message', 'The game server sent a message outside protocol v2.')
        if (!settled) reject(error)
        failWaiters(error)
        socket.close()
        return
      }
      if (message.type === 'welcome' && !settled) {
        const activeToken = message.resumeToken ?? resumeToken
        if (activeToken === undefined) {
          const error = new GameConnectionError('missing_resume_token', 'The game server did not return a token for a new character.')
          reject(error)
          failWaiters(error)
          socket.close()
          return
        }
        settled = true
        clearTimeout(opening)
        current = message.snapshot
        actions.reduce(message.snapshot)
        const connection: GameConnection = {
          playerId: message.playerId,
          resumeToken: activeToken,
          world: () => current as WorldState,
          sendInput: (input) => socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'input', ...input })),
          sendAction: (intent) => socket.send(JSON.stringify({
            v: PROTOCOL_VERSION, type: 'action', seq: intent.seq,
            actionVersion: ACTION_VERSION, kind: intent.kind, targetId: intent.targetId,
          })),
          sendRaw: (raw) => socket.send(JSON.stringify(raw)),
          waitForSnapshot: (predicate, waitMs = 5_000) => new Promise((waitResolve, waitReject) => {
            const waiter = {
              predicate,
              resolve: waitResolve,
              reject: waitReject,
              timer: setTimeout(() => {
                snapshotWaiters.delete(waiter)
                waitReject(new GameConnectionError('snapshot_timeout', 'No matching authoritative snapshot arrived in time.'))
              }, waitMs),
            }
            snapshotWaiters.add(waiter)
          }),
          waitForRefusal: (code, waitMs = 5_000) => new Promise((waitResolve, waitReject) => {
            const waiter = {
              code,
              resolve: waitResolve,
              reject: waitReject,
              timer: setTimeout(() => {
                refusalWaiters.delete(waiter)
                waitReject(new GameConnectionError('refusal_timeout', 'The expected refusal did not arrive in time.'))
              }, waitMs),
            }
            refusalWaiters.add(waiter)
          }),
          onSnapshot: (listener) => { listeners.add(listener); listener(current as WorldState); return () => listeners.delete(listener) },
          onActionFeedback: (listener) => { actionListeners.add(listener); return () => actionListeners.delete(listener) },
          close: () => socket.close(1000, 'client done'),
        }
        resolve(connection)
        return
      }
      if (message.type === 'snapshot') {
        current = message.world
        const feedback = actions.reduce(message.world)
        if (feedback.length > 0) for (const listener of actionListeners) listener(feedback)
        for (const listener of listeners) listener(message.world)
        for (const waiter of [...snapshotWaiters]) {
          if (!waiter.predicate(message)) continue
          clearTimeout(waiter.timer)
          snapshotWaiters.delete(waiter)
          waiter.resolve(message)
        }
        return
      }
      if (message.type === 'refused') {
        if (!settled) {
          clearTimeout(opening)
          reject(new GameConnectionError(message.code, 'The game server refused this connection.'))
        }
        for (const waiter of [...refusalWaiters]) {
          if (waiter.code !== message.code) continue
          clearTimeout(waiter.timer)
          refusalWaiters.delete(waiter)
          waiter.resolve()
        }
      }
    })
    socket.addEventListener('close', () => {
      clearTimeout(opening)
      const error = new GameConnectionError('connection_closed', 'The game connection closed.')
      if (!settled) reject(error)
      failWaiters(error)
    })
    socket.addEventListener('error', () => {
      if (!settled) reject(new GameConnectionError('connect_failed', 'The game server connection failed.'))
    })
  })
}
`
}

function restartProofSource(): string {
  return `import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'

import { ACTION_VERSION, TRAINING_SENTINEL_ID } from '../shared/actions.js'
import { connectGame, GameConnectionError, type GameConnection } from './connection.js'

const root = mkdtempSync(join(tmpdir(), 'kei-restart-proof-'))
const databasePath = join(root, 'world.sqlite')

interface RunningServer {
  readonly child: ChildProcessWithoutNullStreams
  readonly url: string
  readonly socketUrl: string
}

interface ExitResult {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

async function waitForProcessExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<ExitResult | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode }
  }
  return await new Promise((resolve) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = (result: ExitResult | null): void => {
      if (settled) return
      settled = true
      if (timeout !== undefined) clearTimeout(timeout)
      child.off('exit', onExit)
      resolve(result)
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish({ code, signal })
    }
    timeout = setTimeout(() => finish(null), timeoutMs)
    child.once('exit', onExit)
    // The process can exit between the fast-path check and listener
    // registration. Recheck after subscribing and settle through the same
    // idempotent path so a clean exit cannot become a false timeout.
    if (child.exitCode !== null || child.signalCode !== null) {
      finish({ code: child.exitCode, signal: child.signalCode })
    }
  })
}

async function terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  try { child.kill('SIGTERM') } catch { /* It may have exited between checks. */ }
  if (await waitForProcessExit(child, 5_000) !== null) return

  if (process.platform === 'win32' && child.pid !== undefined) {
    const killed = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      encoding: 'utf8', timeout: 10_000, windowsHide: true,
    })
    if (killed.error !== undefined) throw new Error('restart proof taskkill failed: ' + killed.error.message)
  } else {
    try { child.kill('SIGKILL') } catch { /* It may have exited between checks. */ }
  }
  if (await waitForProcessExit(child, 5_000) === null) {
    throw new Error('restart proof child did not exit after bounded termination')
  }
}

function preservePrimary(primary: unknown, cleanup: unknown): unknown {
  if (primary === null) return cleanup
  if (primary instanceof Error) {
    const cleanupMessage = cleanup instanceof Error ? cleanup.message : String(cleanup)
    primary.message += ' (cleanup also failed: ' + cleanupMessage + ')'
  }
  return primary
}

async function startServer(): Promise<RunningServer> {
  const child = spawn(process.execPath, ['src/server/dev-server.mjs'], {
    cwd: process.cwd(), windowsHide: true,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', KEI_WORLD_DB: databasePath, NO_COLOR: '1' },
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let stdout = ''
  let stderr = ''
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('restart proof server readiness timed out')), 45_000)
      const inspect = (chunk: string): void => {
        stdout += chunk
        for (const line of stdout.split(/\\r?\\n/)) {
          try {
            const value = JSON.parse(line) as Record<string, unknown>
            if (value.event === 'ready' && value.protocol === 2 && typeof value.url === 'string' && typeof value.socketUrl === 'string') {
              clearTimeout(timeout)
              resolve({ child, url: value.url, socketUrl: value.socketUrl })
              return
            }
          } catch { /* Non-JSON output is not readiness. */ }
        }
      }
      child.stdout.on('data', inspect)
      child.stderr.on('data', (chunk: string) => { stderr += chunk })
      child.once('exit', (code, signal) => {
        clearTimeout(timeout)
        reject(new Error('restart proof server exited before ready: ' + JSON.stringify({ code, signal, stderr })))
      })
    })
  } catch (primary) {
    try { await terminateChild(child) }
    catch (cleanup) { throw preservePrimary(primary, cleanup) }
    throw primary
  }
}

async function stopServer(server: RunningServer): Promise<void> {
  const response = await fetch(new URL('/__dev/stop', server.url), {
    method: 'POST', signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('clean stop endpoint returned ' + response.status)
  const exited = await waitForProcessExit(server.child, 10_000)
  if (exited === null) throw new Error('clean server exit timed out')
  if (exited.code !== 0) throw new Error('server exited ' + String(exited.code ?? exited.signal))
}

async function expectRefusal(action: Promise<unknown>, code: string): Promise<void> {
  try {
    await action
  } catch (error) {
    if (error instanceof GameConnectionError && error.code === code) return
    throw error
  }
  throw new Error('expected refusal ' + code)
}

function exactCharacter(connection: GameConnection, expected: { readonly playerId: string; readonly x: number; readonly y: number; readonly z: number; readonly xp: number; readonly level: number }): void {
  const player = connection.world().players[connection.playerId]
  if (
    connection.playerId !== expected.playerId || player === undefined ||
    player.x !== expected.x || player.y !== expected.y || player.z !== expected.z ||
    player.xp !== expected.xp || player.level !== expected.level
  ) throw new Error('durable character did not restore exactly')
}

let server: RunningServer | null = null
let failure: unknown = null
let evidence: Record<string, unknown> | null = null
try {
  server = await startServer()
  const first = await connectGame(server.socketUrl)
  const second = await connectGame(server.socketUrl)
  await second.waitForSnapshot((message) => message.world.players[first.playerId] !== undefined)
  const initial = second.world().players[first.playerId]
  if (initial === undefined) throw new Error('first character was not visible')
  first.sendInput({ seq: 1, moveX: 1, moveY: 0, buttons: 0 })
  await second.waitForSnapshot((message) => (message.world.players[first.playerId]?.x ?? initial.x) > initial.x)
  first.sendAction({
    seq: 2, actionVersion: ACTION_VERSION, kind: 'interact', targetId: TRAINING_SENTINEL_ID,
  })
  const progressed = await second.waitForSnapshot((message) => (message.world.players[first.playerId]?.xp ?? 0) > 0)
  const settled = await second.waitForSnapshot((message) => message.world.tick >= progressed.world.tick + 4)
  const authored = settled.world.players[first.playerId]
  if (authored === undefined) throw new Error('progressed character disappeared')
  if (authored.xp !== 10 || settled.world.encounter.sentinel.interactions !== 1) {
    throw new Error('action contact did not mutate progression exactly once before restart')
  }
  const expected = { playerId: first.playerId, ...authored }
  const resumeToken = first.resumeToken
  first.close()
  second.close()
  await stopServer(server)
  server = null

  server = await startServer()
  const resumed = await connectGame(server.socketUrl, resumeToken)
  exactCharacter(resumed, expected)
  await expectRefusal(connectGame(server.socketUrl, resumeToken), 'resume_in_use')
  await expectRefusal(connectGame(server.socketUrl, 'A'.repeat(43)), 'resume_refused')
  await expectRefusal(connectGame(server.socketUrl, 'malformed'), 'resume_refused')

  const beforeForgeryTick = resumed.world().tick
  const refusal = resumed.waitForRefusal('authority_violation')
  resumed.sendRaw({
    v: 2, type: 'action', seq: 3, actionVersion: 1, kind: 'strike', targetId: TRAINING_SENTINEL_ID,
    actorId: resumed.playerId, damage: 999, outcome: 'won', xp: 999999, level: 999,
    progression: { xp: 999999 }, inventory: ['forged'], balance: 999999, wallet: { seed: 'forged' },
  })
  await refusal
  const afterForgery = await resumed.waitForSnapshot((message) => message.world.tick > beforeForgeryTick)
  const live = afterForgery.world.players[resumed.playerId]
  if (live === undefined || live.x !== expected.x || live.y !== expected.y || live.z !== expected.z ||
    live.xp !== expected.xp || live.level !== expected.level) {
    throw new Error('forged state changed the live character')
  }
  resumed.close()
  await stopServer(server)
  server = null

  server = await startServer()
  const verified = await connectGame(server.socketUrl, resumeToken)
  exactCharacter(verified, expected)

  const database = new Database(databasePath, { readonly: true, strict: true })
  const columnStatement = database.prepare('PRAGMA table_info(characters)')
  const columns = columnStatement.all().map((row) => String((row as { name: unknown }).name))
  columnStatement.finalize()
  const forbidden = ['balance', 'currency', 'item', 'inventory', 'seed', 'resume_token']
  if (columns.some((column) => forbidden.some((word) => column.toLowerCase().includes(word)))) {
    throw new Error('world database contains a forbidden ownership column')
  }
  const countStatement = database.prepare('SELECT COUNT(*) AS count FROM characters')
  const count = countStatement.get() as { count: number }
  countStatement.finalize()
  database.close(true)
  if (count.count !== 2) throw new Error('refused resume attempts created durable characters')
  const bytes = readFileSync(databasePath)
  if (bytes.includes(Buffer.from(resumeToken, 'utf8'))) throw new Error('plaintext resume token reached SQLite')

  verified.close()
  await stopServer(server)
  server = null
  evidence = {
    event: 'restart_proof', protocol: 2, playerId: expected.playerId,
    restoredExactly: true, progressionAuthored: expected.xp > 0,
    actionContactPersistedOnce: expected.xp === 10,
    randomTokenRefused: true, malformedTokenRefused: true, duplicateTokenRefused: true,
    forgeryRefused: true, forgeryNotPersisted: true, plaintextTokenAbsent: true,
    durableCharacters: count.count,
  }
} catch (error) {
  failure = error
} finally {
  let mayRemove = true
  if (server !== null) {
    try { await terminateChild(server.child) }
    catch (cleanup) { failure = preservePrimary(failure, cleanup); mayRemove = false }
  }
  if (mayRemove) {
    try { rmSync(root, { recursive: true, force: true }) }
    catch (cleanup) { failure = preservePrimary(failure, cleanup) }
  }
}

if (failure !== null) {
  process.stderr.write(JSON.stringify({
    event: 'error', code: failure instanceof GameConnectionError ? failure.code : 'restart_proof_failed',
    message: failure instanceof Error ? failure.message : String(failure),
  }) + '\\n')
  process.exitCode = 1
} else if (evidence !== null) {
  process.stdout.write(JSON.stringify(evidence) + '\\n')
}
`
}

function headlessSource(): string {
  return `import { ACTION_VERSION, TRAINING_SENTINEL_ID, type ActionEvent } from '../shared/actions.js'
import type { WorldState } from '../shared/simulation.js'
import { createActionEventReducer } from './action-events.js'
import { connectGame } from './connection.js'

const endpoint = process.argv[2]
if (endpoint === undefined) {
  process.stderr.write(JSON.stringify({ event: 'error', code: 'missing_server_url' }) + '\\n')
  process.exit(2)
}

const output = (value: unknown): void => process.stdout.write(JSON.stringify(value) + '\\n')
const eventOf = (world: WorldState, actorId: string, kind: ActionEvent['kind'], phase: ActionEvent['phase']): ActionEvent | undefined =>
  world.encounter.events.find((event) => event.actorId === actorId && event.kind === kind && event.phase === phase)

try {
  const first = await connectGame(endpoint)
  const second = await connectGame(endpoint)
  const both = (world: ReturnType<typeof first.world>): boolean =>
    world.players[first.playerId] !== undefined && world.players[second.playerId] !== undefined
  await first.waitForSnapshot((message) => both(message.world))
  await second.waitForSnapshot((message) => both(message.world))

  const firstStart = second.world().players[first.playerId]
  const secondStart = first.world().players[second.playerId]
  if (firstStart === undefined || secondStart === undefined) throw new Error('both players were not present')

  first.sendInput({ seq: 1, moveX: 1, moveY: 0, buttons: 0 })
  const firstMoved = await second.waitForSnapshot((message) =>
    (message.world.players[first.playerId]?.x ?? firstStart.x) > firstStart.x,
  )

  second.sendInput({ seq: 1, moveX: 0, moveY: 1, buttons: 0 })
  const secondMoved = await first.waitForSnapshot((message) =>
    (message.world.players[second.playerId]?.z ?? secondStart.z) > secondStart.z,
  )

  const xpBeforeActions = first.world().players[first.playerId]?.xp ?? 0
  const sentinelBeforeActions = first.world().encounter.sentinel
  const ownContactWait = first.waitForSnapshot((message) =>
    eventOf(message.world, first.playerId, 'interact', 'contact') !== undefined,
  )
  const remoteContactWait = second.waitForSnapshot((message) =>
    eventOf(message.world, first.playerId, 'interact', 'contact') !== undefined,
  )
  const remoteRecoveryWait = second.waitForSnapshot((message) =>
    eventOf(message.world, first.playerId, 'interact', 'recovery') !== undefined,
  )
  const busyRefusal = first.waitForRefusal('action_busy')
  first.sendAction({
    seq: 2, actionVersion: ACTION_VERSION, kind: 'interact', targetId: TRAINING_SENTINEL_ID,
  })
  first.sendAction({
    seq: 3, actionVersion: ACTION_VERSION, kind: 'strike', targetId: TRAINING_SENTINEL_ID,
  })
  await busyRefusal
  const [ownContact, remoteContact, remoteRecovery] = await Promise.all([
    ownContactWait, remoteContactWait, remoteRecoveryWait,
  ])
  const ownInteractEvent = eventOf(ownContact.world, first.playerId, 'interact', 'contact')
  const remoteInteractEvent = eventOf(remoteContact.world, first.playerId, 'interact', 'contact')
  if (
    ownInteractEvent === undefined || remoteInteractEvent === undefined ||
    JSON.stringify(ownInteractEvent) !== JSON.stringify(remoteInteractEvent)
  ) throw new Error('two clients did not observe the same authored contact event')
  const interacted = remoteContact.world.players[first.playerId]
  if (
    interacted?.xp !== xpBeforeActions + 10 ||
    remoteContact.world.encounter.sentinel.interactions !== sentinelBeforeActions.interactions + 1 ||
    remoteContact.world.encounter.sentinel.strikes !== sentinelBeforeActions.strikes
  ) throw new Error('interact did not mutate progression and sentinel exactly once at contact')

  const cooldownRefusal = first.waitForRefusal('action_cooldown')
  first.sendAction({
    seq: 4, actionVersion: ACTION_VERSION, kind: 'strike', targetId: TRAINING_SENTINEL_ID,
  })
  await cooldownRefusal
  const recoveryEvent = eventOf(remoteRecovery.world, first.playerId, 'interact', 'recovery')
  if (recoveryEvent === undefined) throw new Error('interact recovery was not published')
  await first.waitForSnapshot((message) => message.world.tick >= recoveryEvent.tick + 4)

  const strikeContactWait = first.waitForSnapshot((message) =>
    eventOf(message.world, first.playerId, 'strike', 'contact') !== undefined,
  )
  const remoteStrikeWait = second.waitForSnapshot((message) =>
    eventOf(message.world, first.playerId, 'strike', 'contact') !== undefined,
  )
  first.sendAction({
    seq: 5, actionVersion: ACTION_VERSION, kind: 'strike', targetId: TRAINING_SENTINEL_ID,
  })
  const [strikeContact, remoteStrike] = await Promise.all([strikeContactWait, remoteStrikeWait])
  const strikeEvent = eventOf(strikeContact.world, first.playerId, 'strike', 'contact')
  const remoteStrikeEvent = eventOf(remoteStrike.world, first.playerId, 'strike', 'contact')
  if (
    strikeEvent === undefined || remoteStrikeEvent === undefined ||
    JSON.stringify(strikeEvent) !== JSON.stringify(remoteStrikeEvent)
  ) throw new Error('remote client did not observe the same strike contact')

  const reducer = createActionEventReducer()
  const firstFeedback = reducer.reduce(ownContact.world)
  const duplicateFeedback = reducer.reduce(ownContact.world)
  const laterFeedback = reducer.reduce(strikeContact.world)
  const outOfOrderFeedback = reducer.reduce(remoteContact.world)
  if (
    firstFeedback.length === 0 || laterFeedback.length === 0 ||
    duplicateFeedback.length !== 0 || outOfOrderFeedback.length !== 0
  ) throw new Error('action reducer replayed duplicate or out-of-order feedback')

  const afterContact = await second.waitForSnapshot((message) => message.world.tick >= strikeContact.world.tick + 3)
  if (
    afterContact.world.players[first.playerId]?.xp !== xpBeforeActions + 20 ||
    afterContact.world.encounter.sentinel.interactions !== sentinelBeforeActions.interactions + 1 ||
    afterContact.world.encounter.sentinel.strikes !== sentinelBeforeActions.strikes + 1
  ) throw new Error('a completed action applied contact progression more than once')

  const far = await connectGame(endpoint)
  let farPosition = far.world().players[far.playerId]
  if (farPosition === undefined) throw new Error('too-far probe player was missing')
  for (let seq = 1; seq <= 12; seq += 1) {
    const priorX = farPosition.x
    far.sendInput({ seq, moveX: 1, moveY: 0, buttons: 0 })
    const moved = await far.waitForSnapshot((message) => (message.world.players[far.playerId]?.x ?? priorX) > priorX)
    farPosition = moved.world.players[far.playerId]
    if (farPosition === undefined) throw new Error('too-far probe player disappeared')
  }
  if (Math.hypot(farPosition.x, farPosition.y, farPosition.z) <= 2) {
    throw new Error('the bounded too-far probe did not reach outside action range')
  }
  const beforeFar = afterContact.world.encounter.sentinel
  const tooFarRefusal = far.waitForRefusal('action_too_far')
  far.sendAction({
    seq: 13, actionVersion: ACTION_VERSION, kind: 'interact', targetId: TRAINING_SENTINEL_ID,
  })
  await tooFarRefusal
  const afterFar = await second.waitForSnapshot((message) => message.world.tick > afterContact.world.tick)
  if (
    afterFar.world.players[far.playerId]?.xp !== 0 ||
    afterFar.world.encounter.sentinel.interactions !== beforeFar.interactions ||
    afterFar.world.encounter.sentinel.strikes !== beforeFar.strikes
  ) throw new Error('a refused too-far action mutated authoritative progression')
  far.close()

  const beforeStale = first.world().players[first.playerId]
  const staleRefusal = first.waitForRefusal('stale_input')
  first.sendInput({ seq: 1, moveX: -1, moveY: 0, buttons: 0 })
  await staleRefusal
  const stopped = await first.waitForSnapshot((message) => message.world.tick >= firstMoved.world.tick + 2)
  const afterStale = stopped.world.players[first.playerId]
  if (beforeStale === undefined || afterStale === undefined || afterStale.x !== beforeStale.x) {
    throw new Error('a stale input changed authoritative position')
  }

  const attacker = await connectGame(endpoint)
  const beforeForgery = first.world()
  const authorityRefusal = attacker.waitForRefusal('authority_violation')
  attacker.sendRaw({
    v: 2, type: 'action', seq: 1, actionVersion: 1, kind: 'strike', targetId: TRAINING_SENTINEL_ID,
    actorId: first.playerId, damage: 999, outcome: 'won', progression: { xp: 999999 },
    balance: 999999, inventory: ['forged'], wallet: { seed: 'forged' },
  })
  await authorityRefusal
  const afterAttack = await first.waitForSnapshot((message) => message.world.tick > stopped.world.tick)
  if (
    afterAttack.world.players[first.playerId]?.xp !== beforeForgery.players[first.playerId]?.xp ||
    afterAttack.world.encounter.sentinel.interactions !== beforeForgery.encounter.sentinel.interactions ||
    afterAttack.world.encounter.sentinel.strikes !== beforeForgery.encounter.sentinel.strikes
  ) {
    throw new Error('an authority-forging action changed progression or encounter state')
  }

  const flooder = await connectGame(endpoint)
  const rateRefusal = flooder.waitForRefusal('rate_limited')
  for (let seq = 1; seq <= 50; seq += 1) {
    flooder.sendInput({ seq, moveX: 0, moveY: 0, buttons: 0 })
  }
  await rateRefusal

  attacker.close()
  flooder.close()
  second.close()
  await first.waitForSnapshot((message) => message.world.players[second.playerId] === undefined)
  first.close()

  output({
    event: 'shared_encounter',
    protocol: 2,
    players: [first.playerId, second.playerId],
    firstObservedBySecond: firstMoved.world.players[first.playerId],
    secondObservedByFirst: secondMoved.world.players[second.playerId],
    staleInputRefused: true,
    authorityViolationRefused: true,
    rateLimited: true,
    disconnectObserved: true,
    interactAccepted: true,
    strikeContactAccepted: true,
    remoteSemanticEventMatched: true,
    tooFarRefusedWithoutMutation: true,
    cooldownRefusedWithoutMutation: true,
    busyPhaseRefusedWithoutMutation: true,
    duplicateAndOutOfOrderDeduped: true,
    noDoubleProgression: true,
    forgedActionAuthorityRefused: true,
  })
} catch (error) {
  process.stderr.write(JSON.stringify({
    event: 'error',
    code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'headless_smoke_failed',
    message: error instanceof Error ? error.message : String(error),
  }) + '\\n')
  process.exit(1)
}
`
}

function persistenceSource(): string {
  return `import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Database } from 'bun:sqlite'

import { levelForXp, type PlayerState } from '../shared/simulation.js'

export const WORLD_SCHEMA_VERSION = 1
export const DEFAULT_WORLD_DB = '.kei-world/world.sqlite'
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export interface CharacterRecord extends PlayerState {
  readonly playerId: string
  readonly updatedAt: number
}

export class PersistenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'PersistenceError'
  }
}

/** Hash before lookup or storage. The plaintext token is never written to SQLite. */
export function hashResumeToken(token: string): string | null {
  if (!TOKEN_PATTERN.test(token)) return null
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function rows(database: Database, sql: string): readonly unknown[] {
  const statement = database.prepare(sql)
  try { return statement.all() }
  finally { statement.finalize() }
}

function row(database: Database, sql: string, binding?: string): unknown {
  const statement = database.prepare(sql)
  try { return binding === undefined ? statement.get() : statement.get(binding) }
  finally { statement.finalize() }
}

function columnsOf(database: Database, table: string): readonly string[] {
  return rows(database, 'PRAGMA table_info(' + table + ')')
    .map((value) => String((value as { name: unknown }).name))
}

function exactColumns(database: Database, table: string, expected: readonly string[]): boolean {
  const columns = columnsOf(database, table)
  return columns.length === expected.length && columns.every((column, index) => column === expected[index])
}

function prepareSchema(database: Database): void {
  const tables = rows(database,
    \"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name\",
  ).map((value) => String((value as { name: unknown }).name))

  if (tables.length === 0) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(\`CREATE TABLE world_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      ) STRICT\`)
      database.exec(\`CREATE TABLE characters (
        player_id TEXT PRIMARY KEY NOT NULL,
        resume_hash TEXT UNIQUE NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        z REAL NOT NULL,
        xp INTEGER NOT NULL CHECK (xp >= 0),
        level INTEGER NOT NULL CHECK (level >= 1),
        updated_at INTEGER NOT NULL
      ) STRICT\`)
      database.run('INSERT INTO world_metadata (key, value) VALUES (?, ?)', [
        'schema_version', String(WORLD_SCHEMA_VERSION),
      ])
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return
  }

  if (!tables.includes('world_metadata') || !tables.includes('characters')) {
    throw new PersistenceError('schema_invalid', 'The world database is missing its versioned schema.')
  }
  const version = row(database, 'SELECT value FROM world_metadata WHERE key = ?', 'schema_version') as
    | { value: unknown }
    | null
  if (version === null || version.value !== String(WORLD_SCHEMA_VERSION)) {
    throw new PersistenceError('schema_version_unsupported', 'The world database schema version is not supported.')
  }
  if (
    !exactColumns(database, 'world_metadata', ['key', 'value']) ||
    !exactColumns(database, 'characters', ['player_id', 'resume_hash', 'x', 'y', 'z', 'xp', 'level', 'updated_at'])
  ) {
    throw new PersistenceError('schema_invalid', 'The world database schema does not match its declared version.')
  }
}

function characterOf(row: unknown): CharacterRecord {
  const value = row as {
    player_id: string; x: number; y: number; z: number; xp: number; level: number; updated_at: number
  }
  if (!Number.isSafeInteger(value.xp) || value.xp < 0 || value.level !== levelForXp(value.xp)) {
    throw new PersistenceError('character_invalid', 'A durable character has invalid progression.')
  }
  for (const axis of [value.x, value.y, value.z]) {
    if (!Number.isFinite(axis)) throw new PersistenceError('character_invalid', 'A durable character has an invalid position.')
  }
  if (!Number.isSafeInteger(value.updated_at) || value.updated_at < 0) {
    throw new PersistenceError('character_invalid', 'A durable character has an invalid update time.')
  }
  return {
    playerId: value.player_id,
    x: value.x,
    y: value.y,
    z: value.z,
    xp: value.xp,
    level: value.level,
    updatedAt: value.updated_at,
  }
}

export class CharacterStore {
  readonly database: Database
  #closed = false

  constructor(readonly path = process.env.KEI_WORLD_DB ?? DEFAULT_WORLD_DB) {
    mkdirSync(dirname(path), { recursive: true })
    this.database = new Database(path, { create: true, strict: true })
    this.database.exec('PRAGMA journal_mode = WAL')
    this.database.exec('PRAGMA synchronous = FULL')
    try {
      prepareSchema(this.database)
    } catch (error) {
      this.database.close(true)
      throw error
    }
  }

  createCharacter(): { readonly character: CharacterRecord; readonly resumeToken: string } {
    const resumeToken = randomBytes(32).toString('base64url')
    const resumeHash = hashResumeToken(resumeToken)
    if (resumeHash === null) throw new PersistenceError('token_generation_failed', 'Could not create a resume capability.')
    const now = Date.now()
    const character: CharacterRecord = {
      playerId: randomUUID(), x: 0, y: 0, z: 0, xp: 0, level: levelForXp(0), updatedAt: now,
    }
    this.database.run(\`INSERT INTO characters
      (player_id, resume_hash, x, y, z, xp, level, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)\`, [
      character.playerId, resumeHash, character.x, character.y, character.z,
      character.xp, character.level, character.updatedAt,
    ])
    return { character, resumeToken }
  }

  findByResumeToken(token: string): CharacterRecord | null {
    const resumeHash = hashResumeToken(token)
    if (resumeHash === null) return null
    const found = row(this.database, \`SELECT player_id, x, y, z, xp, level, updated_at
      FROM characters WHERE resume_hash = ?\`, resumeHash)
    return found === null ? null : characterOf(found)
  }

  character(playerId: string): CharacterRecord | null {
    const found = row(this.database, \`SELECT player_id, x, y, z, xp, level, updated_at
      FROM characters WHERE player_id = ?\`, playerId)
    return found === null ? null : characterOf(found)
  }

  saveDirty(characters: readonly CharacterRecord[]): void {
    if (characters.length === 0) return
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const character of characters) {
        if (character.level !== levelForXp(character.xp)) {
          throw new PersistenceError('character_invalid', 'The shard tried to persist invalid progression.')
        }
        const result = this.database.run(\`UPDATE characters
          SET x = ?, y = ?, z = ?, xp = ?, level = ?, updated_at = ?
          WHERE player_id = ?\`, [
          character.x, character.y, character.z, character.xp, character.level,
          character.updatedAt, character.playerId,
        ])
        if (result.changes !== 1) {
          throw new PersistenceError('character_missing', 'The shard tried to save an unknown character.')
        }
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.database.close(true)
  }
}
`
}

function serverSource(): string {
  return `import {
  ACTION_ANTICIPATION_TICKS,
  ACTION_COOLDOWN_TICKS,
  ACTION_RANGE,
  ACTION_RECOVERY_TICKS,
  ACTION_VERSION,
  MAX_ACTION_EVENTS,
  TRAINING_SENTINEL_ID,
  XP_PER_ACTION_CONTACT,
  type ActionEvent,
  type ActionIntent,
  type ActionKind,
} from '../shared/actions.js'
import {
  emptyWorld,
  joinWorld,
  leaveWorld,
  STEP_MS,
  step,
  levelForXp,
  type PlayerInput,
  type WorldState,
} from '../shared/simulation.js'
import { CharacterStore, type CharacterRecord } from './persistence.js'

export type JoinResult =
  | { readonly ok: true; readonly playerId: string; readonly resumeToken?: string }
  | { readonly ok: false; readonly code: 'resume_refused' | 'resume_in_use' }

export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'action_target_refused' | 'action_too_far' | 'action_busy' | 'action_cooldown' }

export interface Shard {
  readonly state: WorldState
  readonly join: (resumeToken?: string) => JoinResult
  readonly leave: (playerId: string) => void
  readonly advance: (elapsedMs: number) => void
  readonly enqueue: (playerId: string, input: PlayerInput) => void
  readonly requestAction: (playerId: string, intent: ActionIntent) => ActionResult
  readonly character: (playerId: string) => CharacterRecord | null
  readonly close: () => void
}

export function createShard(store = new CharacterStore()): Shard {
  let state: WorldState = emptyWorld(false)
  let accumulator = 0
  let pending: Record<string, PlayerInput> = {}
  let nextEventId = 1
  const active = new Map<string, {
    readonly kind: ActionKind
    readonly contactTick: number
    readonly recoveryTick: number
    contactApplied: boolean
  }>()
  const cooldownUntil = new Map<string, number>()
  const playerState = (character: CharacterRecord) => ({
    x: character.x, y: character.y, z: character.z, xp: character.xp, level: character.level,
  })

  const save = (playerIds: readonly string[]): void => {
    const now = Date.now()
    store.saveDirty(playerIds.flatMap((playerId) => {
      const player = state.players[playerId]
      return player === undefined ? [] : [{ playerId, ...player, updatedAt: now }]
    }))
  }

  const appendEvent = (
    actorId: string,
    kind: ActionKind,
    phase: ActionEvent['phase'],
    outcome: ActionEvent['outcome'],
  ): void => {
    const event: ActionEvent = {
      actionVersion: ACTION_VERSION,
      eventId: nextEventId,
      tick: state.tick,
      actorId,
      targetId: TRAINING_SENTINEL_ID,
      kind,
      phase,
      outcome,
      contact: phase === 'contact',
    }
    nextEventId += 1
    state = {
      ...state,
      encounter: {
        ...state.encounter,
        events: [...state.encounter.events, event].slice(-MAX_ACTION_EVENTS),
      },
    }
  }

  return {
    get state() { return state },
    join(resumeToken) {
      if (resumeToken === undefined) {
        const created = store.createCharacter()
        state = joinWorld(state, created.character.playerId, playerState(created.character))
        return { ok: true, playerId: created.character.playerId, resumeToken: created.resumeToken }
      }
      const restored = store.findByResumeToken(resumeToken)
      if (restored === null) return { ok: false, code: 'resume_refused' }
      if (state.players[restored.playerId] !== undefined) return { ok: false, code: 'resume_in_use' }
      state = joinWorld(state, restored.playerId, playerState(restored))
      return { ok: true, playerId: restored.playerId }
    },
    leave(playerId) {
      state = leaveWorld(state, playerId)
      delete pending[playerId]
      active.delete(playerId)
      cooldownUntil.delete(playerId)
    },
    advance(elapsedMs) {
      accumulator += elapsedMs
      while (accumulator >= STEP_MS) {
        const before = state
        state = step(state, pending, STEP_MS / 1000)
        const dirty = new Set(Object.keys(pending).filter((playerId) => {
          const prior = before.players[playerId]
          const next = state.players[playerId]
          return prior !== undefined && next !== undefined && (
            prior.x !== next.x || prior.y !== next.y || prior.z !== next.z ||
            prior.xp !== next.xp || prior.level !== next.level
          )
        }))
        pending = {}
        for (const [actorId, action] of [...active]) {
          if (!action.contactApplied && state.tick >= action.contactTick) {
            const player = state.players[actorId]
            if (player === undefined) {
              active.delete(actorId)
              continue
            }
            const xp = player.xp + XP_PER_ACTION_CONTACT
            const sentinel = state.encounter.sentinel
            state = {
              ...state,
              players: {
                ...state.players,
                [actorId]: { ...player, xp, level: levelForXp(xp) },
              },
              encounter: {
                ...state.encounter,
                sentinel: {
                  ...sentinel,
                  interactions: sentinel.interactions + (action.kind === 'interact' ? 1 : 0),
                  strikes: sentinel.strikes + (action.kind === 'strike' ? 1 : 0),
                },
              },
            }
            action.contactApplied = true
            dirty.add(actorId)
            appendEvent(actorId, action.kind, 'contact', 'applied')
          }
          if (action.contactApplied && state.tick >= action.recoveryTick) {
            appendEvent(actorId, action.kind, 'recovery', 'completed')
            active.delete(actorId)
            cooldownUntil.set(actorId, state.tick + ACTION_COOLDOWN_TICKS)
          }
        }
        save([...dirty])
        accumulator -= STEP_MS
      }
    },
    enqueue(playerId, input) { if (state.players[playerId] !== undefined) pending[playerId] = input },
    requestAction(playerId, intent) {
      const player = state.players[playerId]
      if (player === undefined || intent.targetId !== TRAINING_SENTINEL_ID) {
        return { ok: false, code: 'action_target_refused' }
      }
      if (active.has(playerId)) return { ok: false, code: 'action_busy' }
      if ((cooldownUntil.get(playerId) ?? 0) > state.tick) return { ok: false, code: 'action_cooldown' }
      const sentinel = state.encounter.sentinel
      const distance = Math.hypot(player.x - sentinel.x, player.y - sentinel.y, player.z - sentinel.z)
      if (!Number.isFinite(distance) || distance > ACTION_RANGE) return { ok: false, code: 'action_too_far' }
      const contactTick = state.tick + ACTION_ANTICIPATION_TICKS
      active.set(playerId, {
        kind: intent.kind,
        contactTick,
        recoveryTick: contactTick + ACTION_RECOVERY_TICKS,
        contactApplied: false,
      })
      appendEvent(playerId, intent.kind, 'anticipation', 'accepted')
      return { ok: true }
    },
    character(playerId) { return store.character(playerId) },
    close() { store.close() },
  }
}
`
}

function devServerSource(): string {
  return `#!/usr/bin/env bun
import { isIP } from 'node:net'
import { stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { createServer } from 'node:http'
import { WebSocketServer } from '${WEBSOCKET_PACKAGE}'

import { build, OUT_DIR } from '../../scripts/build.mjs'
import { createShard } from './main.ts'
import { decodeClientMessage, GAME_PATH, MAX_MESSAGE_BYTES, PROTOCOL_VERSION, refused } from '../shared/protocol.ts'
import { STEP_MS } from '../shared/simulation.ts'

const HOST = process.env.HOST ?? '127.0.0.1'
const PORT = Number.parseInt(process.env.PORT ?? '5173', 10)
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1'])
const MAX_CONNECTIONS = 64
const HELLO_TIMEOUT_MS = 5_000
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
}

function fail(code, message) {
  process.stderr.write(JSON.stringify({ event: 'error', code, message }) + '\\n')
  process.exit(1)
}

if (isIP(HOST) === 0 || !LOOPBACK_HOSTS.has(HOST)) {
  fail('invalid_host', 'HOST must be the numeric loopback address 127.0.0.1 or ::1.')
}

function fileFor(urlPath) {
  let decoded
  try { decoded = decodeURIComponent(urlPath) } catch { return null }
  const wanted = decoded.endsWith('/') ? decoded + 'index.html' : decoded
  const target = resolve(OUT_DIR, '.' + wanted)
  return target === OUT_DIR || target.startsWith(OUT_DIR + sep) ? target : null
}

try { await build({ minify: false }) } catch (error) {
  fail(error && error.code ? error.code : 'build_failed', String(error && error.message ? error.message : error))
}

const shard = createShard()
const sessions = new Set()
const http = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://' + (request.headers.host ?? HOST))
  if (url.pathname === '/__dev/stop') {
    if (request.method !== 'POST') {
      response.writeHead(405, { 'content-type': TYPES['.json'], allow: 'POST' })
      response.end(JSON.stringify({ event: 'error', code: 'method_not_allowed' }))
      return
    }
    response.writeHead(202, { 'content-type': TYPES['.json'], connection: 'close' })
    response.end(JSON.stringify({ event: 'stopping' }), () => { void stop() })
    return
  }
  if (url.pathname === GAME_PATH) {
    response.writeHead(426, { 'content-type': TYPES['.json'] })
    response.end(JSON.stringify({ event: 'error', code: 'websocket_required', protocol: PROTOCOL_VERSION }))
    return
  }
  if (url.pathname === '/__dev/status') {
    response.writeHead(200, { 'content-type': TYPES['.json'] })
    response.end(JSON.stringify({
      service: '${DEV_SERVICE}', root: 'dist', entry: 'client/main.js',
      socketPath: GAME_PATH, protocol: PROTOCOL_VERSION,
    }))
    return
  }
  const target = fileFor(url.pathname)
  if (target === null) {
    response.writeHead(400, { 'content-type': TYPES['.json'] })
    response.end(JSON.stringify({ event: 'error', code: 'bad_path' }))
    return
  }
  try {
    const info = await stat(target)
    const file = Bun.file(info.isDirectory() ? join(target, 'index.html') : target)
    if (!(await file.exists())) throw new Error('not found')
    response.writeHead(200, {
      'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'content-length': file.size, 'cache-control': 'no-store',
    })
    response.end(Buffer.from(await file.arrayBuffer()))
  } catch {
    response.writeHead(404, { 'content-type': TYPES['.json'] })
    response.end(JSON.stringify({ event: 'error', code: 'not_found' }))
  }
})

const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })
http.on('upgrade', (request, socket, head) => {
  const host = request.headers.host
  if (host === undefined) { socket.destroy(); return }
  let url
  try {
    url = new URL(request.url ?? '/', 'http://' + host)
  } catch { socket.destroy(); return }
  if (url.pathname !== GAME_PATH) { socket.destroy(); return }
  const requestedHost = url.hostname.replace(/^\\[|\\]$/g, '')
  if (requestedHost !== HOST) { socket.destroy(); return }
  sockets.handleUpgrade(request, socket, head, (websocket) => sockets.emit('connection', websocket, request))
})

function send(session, value) { if (session.socket.readyState === 1) session.socket.send(JSON.stringify(value)) }
function snapshot(session) {
  send(session, { v: PROTOCOL_VERSION, type: 'snapshot', ackSeq: session.lastSeq, world: shard.state })
}

sockets.on('connection', (socket, request) => {
  const requestUrl = new URL(request.url ?? '/', 'http://' + (request.headers.host ?? HOST))
  let origin
  try { origin = request.headers.origin === undefined ? undefined : new URL(request.headers.origin) }
  catch { origin = null }
  if (origin === null || (origin !== undefined && origin.origin !== requestUrl.origin)) {
    socket.send(JSON.stringify(refused('origin_refused')))
    socket.close(4003, 'origin_refused')
    return
  }
  const requested = requestUrl.searchParams.get('protocol')
  if (requested !== String(PROTOCOL_VERSION)) {
    socket.send(JSON.stringify(refused('protocol_mismatch')))
    socket.close(4001, 'protocol_mismatch')
    return
  }
  if (sessions.size >= MAX_CONNECTIONS) {
    socket.send(JSON.stringify(refused('server_busy')))
    socket.close(4004, 'server_busy')
    return
  }
  const session = { socket, playerId: null, welcomed: false, lastSeq: -1, tokens: 40, refilledAt: Date.now() }
  sessions.add(session)
  const helloTimeout = setTimeout(() => {
    if (session.welcomed) return
    send(session, refused('session_order'))
    socket.close(4002, 'hello_timeout')
  }, HELLO_TIMEOUT_MS)
  socket.on('message', (bytes) => {
    const raw = String(bytes)
    if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) {
      send(session, refused('invalid_message')); socket.close(4002, 'invalid_message'); return
    }
    const now = Date.now()
    const refill = Math.floor((now - session.refilledAt) / 50)
    if (refill > 0) {
      session.tokens = Math.min(40, session.tokens + refill)
      session.refilledAt += refill * 50
    }
    if (session.tokens < 1) {
      send(session, refused('rate_limited'))
      socket.close(4008, 'rate_limited')
      return
    }
    session.tokens -= 1
    const decoded = decodeClientMessage(raw)
    if (!decoded.ok) {
      send(session, refused(decoded.code))
      if (decoded.code !== 'stale_input' && decoded.code !== 'rate_limited' && decoded.code !== 'authority_violation') {
        socket.close(decoded.code === 'protocol_mismatch' ? 4001 : 4002, decoded.code)
      }
      return
    }
    const message = decoded.message
    if (message.type === 'hello') {
      if (session.welcomed) { send(session, refused('session_order')); socket.close(4002, 'session_order'); return }
      const joined = shard.join(message.resumeToken)
      if (!joined.ok) {
        send(session, refused(joined.code))
        socket.close(4009, joined.code)
        return
      }
      session.welcomed = true
      session.playerId = joined.playerId
      clearTimeout(helloTimeout)
      send(session, joined.resumeToken === undefined
        ? { v: PROTOCOL_VERSION, type: 'welcome', playerId: joined.playerId, snapshot: shard.state }
        : { v: PROTOCOL_VERSION, type: 'welcome', playerId: joined.playerId, resumeToken: joined.resumeToken, snapshot: shard.state })
      for (const peer of sessions) if (peer.welcomed) snapshot(peer)
      return
    }
    if (!session.welcomed) { send(session, refused('session_order')); socket.close(4002, 'session_order'); return }
    if (message.seq <= session.lastSeq) { send(session, refused('stale_input')); return }
    session.lastSeq = message.seq
    if (session.playerId === null) { send(session, refused('session_order')); return }
    if (message.type === 'action') {
      const result = shard.requestAction(session.playerId, message)
      if (!result.ok) { send(session, refused(result.code)); return }
      for (const peer of sessions) if (peer.welcomed) snapshot(peer)
      return
    }
    shard.enqueue(session.playerId, message)
  })
  socket.on('close', () => {
    clearTimeout(helloTimeout)
    sessions.delete(session)
    if (session.welcomed && session.playerId !== null) {
      shard.leave(session.playerId)
      for (const peer of sessions) if (peer.welcomed) snapshot(peer)
    }
  })
})

let lastTick = performance.now()
const tick = setInterval(() => {
  const now = performance.now()
  shard.advance(Math.min(now - lastTick, STEP_MS * 5))
  lastTick = now
  for (const session of sessions) if (session.welcomed) snapshot(session)
}, STEP_MS)

http.on('error', (error) => fail('listen_failed', String(error && error.message ? error.message : error)))
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  clearInterval(tick)
  shard.close()
  for (const session of sessions) session.socket.close(1001, 'server stopping')
  await new Promise((resolve) => sockets.close(resolve))
  const httpClosed = new Promise((resolve) => http.close(resolve))
  http.closeAllConnections?.()
  await httpClosed
  process.exit(0)
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop() })

http.listen(PORT, HOST, () => {
  const address = http.address()
  const port = typeof address === 'object' && address !== null ? address.port : PORT
  const authority = HOST.includes(':') ? '[' + HOST + ']' : HOST
  const url = 'http://' + authority + ':' + port + '/'
  const socketUrl = 'ws://' + authority + ':' + port + GAME_PATH + '?protocol=' + PROTOCOL_VERSION
  process.stdout.write(JSON.stringify({
    event: 'ready', service: '${DEV_SERVICE}', url, socketUrl, host: HOST, port,
    protocol: PROTOCOL_VERSION, root: 'dist', pid: process.pid,
  }) + '\\n')
})
`
}
