/** Project-owned networking emitted into every generated MMO. */

import type { WorkspaceFile } from './source.js'

export const CONNECTION_PATH = 'src/client/connection.ts'
export const HEADLESS_CLIENT_PATH = 'src/client/headless.ts'
export const SERVER_PATH = 'src/server/main.ts'
export const PROTOCOL_PATH = 'src/shared/protocol.ts'
export const DEV_SERVER_PATH = 'src/server/dev-server.mjs'
export const HEADLESS_CLIENT_BUNDLE = 'headless/headless.js'
export const DEV_SERVICE = 'kei-game-server'
export const GAME_PROTOCOL_VERSION = 1
export const GAME_SOCKET_PATH = '/game'
export const WEBSOCKET_PACKAGE = 'ws'
export const WEBSOCKET_RANGE = '^8.18.3'

export function networkProjectFiles(): readonly WorkspaceFile[] {
  return Object.freeze([
    { path: PROTOCOL_PATH, contents: protocolSource() },
    { path: CONNECTION_PATH, contents: connectionSource() },
    { path: HEADLESS_CLIENT_PATH, contents: headlessSource() },
    { path: SERVER_PATH, contents: serverSource() },
    { path: DEV_SERVER_PATH, contents: devServerSource() },
  ])
}

function protocolSource(): string {
  return `import type { PlayerInput, WorldState } from './simulation.js'

export const PROTOCOL_VERSION = ${GAME_PROTOCOL_VERSION} as const
export const GAME_PATH = '${GAME_SOCKET_PATH}'
export const MAX_MESSAGE_BYTES = 64 * 1024

export interface HelloMessage {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'hello'
}

export interface InputMessage extends PlayerInput {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'input'
}

export type ClientMessage = HelloMessage | InputMessage

export interface WelcomeMessage {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'welcome'
  readonly playerId: string
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
  'position', 'x', 'y', 'z', 'tick', 'players', 'balance', 'inventory', 'currency',
  'item', 'mint', 'transfer', 'settlement', 'settlementResult', 'playerId', 'state',
])
const REFUSAL_CODES = new Set<RefusalCode>([
  'protocol_mismatch', 'invalid_message', 'authority_violation',
  'stale_input', 'session_order', 'rate_limited', 'origin_refused', 'server_busy',
])

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
    return exact(value, ['v', 'type'])
      ? { ok: true, message: { v: PROTOCOL_VERSION, type: 'hello' } }
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
      (value.buttons as number) < 0
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
  return { ok: false, code: 'invalid_message' }
}

function worldOf(value: unknown): WorldState | null {
  const candidate = record(value)
  if (
    candidate === null ||
    !exact(candidate, ['tick', 'players']) ||
    !Number.isSafeInteger(candidate.tick) ||
    (candidate.tick as number) < 0
  ) return null
  const players = record(candidate.players)
  if (players === null) return null
  for (const player of Object.values(players)) {
    const position = record(player)
    if (
      position === null ||
      !exact(position, ['x', 'y', 'z']) ||
      typeof position.x !== 'number' || !Number.isFinite(position.x) ||
      typeof position.y !== 'number' || !Number.isFinite(position.y) ||
      typeof position.z !== 'number' || !Number.isFinite(position.z)
    ) return null
  }
  return candidate as unknown as WorldState
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
    if (!exact(value, ['v', 'type', 'playerId', 'snapshot'])) return null
    const snapshot = worldOf(value.snapshot)
    return snapshot === null ? null : { v: PROTOCOL_VERSION, type: 'welcome', playerId: value.playerId, snapshot }
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

function connectionSource(): string {
  return `import {
  GAME_PATH,
  PROTOCOL_VERSION,
  serverMessageOf,
  type RefusalCode,
  type SnapshotMessage,
} from '../shared/protocol.js'
import type { PlayerInput, WorldState } from '../shared/simulation.js'

export class GameConnectionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'GameConnectionError'
  }
}

export interface GameConnection {
  readonly playerId: string
  readonly world: () => WorldState
  readonly sendInput: (input: PlayerInput) => void
  readonly sendRaw: (value: unknown) => void
  readonly waitForSnapshot: (predicate: (message: SnapshotMessage) => boolean, timeoutMs?: number) => Promise<SnapshotMessage>
  readonly waitForRefusal: (code: RefusalCode, timeoutMs?: number) => Promise<void>
  readonly onSnapshot: (listener: (world: WorldState) => void) => () => void
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

export function connectGame(value: string, timeoutMs = 5_000): Promise<GameConnection> {
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
      socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'hello' }))
    })
    socket.addEventListener('message', (event) => {
      const message = serverMessageOf(String(event.data))
      if (message === null) {
        const error = new GameConnectionError('invalid_server_message', 'The game server sent a message outside protocol v1.')
        if (!settled) reject(error)
        failWaiters(error)
        socket.close()
        return
      }
      if (message.type === 'welcome' && !settled) {
        settled = true
        clearTimeout(opening)
        current = message.snapshot
        const connection: GameConnection = {
          playerId: message.playerId,
          world: () => current as WorldState,
          sendInput: (input) => socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'input', ...input })),
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
          close: () => socket.close(1000, 'client done'),
        }
        resolve(connection)
        return
      }
      if (message.type === 'snapshot') {
        current = message.world
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

function headlessSource(): string {
  return `import { connectGame } from './connection.js'

const endpoint = process.argv[2]
if (endpoint === undefined) {
  process.stderr.write(JSON.stringify({ event: 'error', code: 'missing_server_url' }) + '\\n')
  process.exit(2)
}

const output = (value: unknown): void => process.stdout.write(JSON.stringify(value) + '\\n')

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
  const authorityRefusal = attacker.waitForRefusal('authority_violation')
  attacker.sendRaw({ v: 1, type: 'teleport', position: { x: 999, y: 999, z: 999 } })
  await authorityRefusal
  const afterAttack = await first.waitForSnapshot((message) => message.world.tick > stopped.world.tick)
  if (Object.values(afterAttack.world.players).some((player) => player.x === 999 || player.y === 999 || player.z === 999)) {
    throw new Error('an authority-forging message changed the world')
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
    protocol: 1,
    players: [first.playerId, second.playerId],
    firstObservedBySecond: firstMoved.world.players[first.playerId],
    secondObservedByFirst: secondMoved.world.players[second.playerId],
    staleInputRefused: true,
    authorityViolationRefused: true,
    rateLimited: true,
    disconnectObserved: true,
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

function serverSource(): string {
  return `import {
  emptyWorld,
  joinWorld,
  leaveWorld,
  STEP_MS,
  step,
  type PlayerInput,
  type WorldState,
} from '../shared/simulation.js'

export interface Shard {
  readonly state: WorldState
  readonly join: (playerId: string) => void
  readonly leave: (playerId: string) => void
  readonly advance: (elapsedMs: number) => void
  readonly enqueue: (playerId: string, input: PlayerInput) => void
}

export function createShard(): Shard {
  let state: WorldState = emptyWorld(false)
  let accumulator = 0
  let pending: Record<string, PlayerInput> = {}

  return {
    get state() { return state },
    join(playerId) { state = joinWorld(state, playerId) },
    leave(playerId) { state = leaveWorld(state, playerId); delete pending[playerId] },
    advance(elapsedMs) {
      accumulator += elapsedMs
      while (accumulator >= STEP_MS) {
        state = step(state, pending, STEP_MS / 1000)
        pending = {}
        accumulator -= STEP_MS
      }
    },
    enqueue(playerId, input) { if (state.players[playerId] !== undefined) pending[playerId] = input },
  }
}
`
}

function devServerSource(): string {
  return `#!/usr/bin/env bun
import { randomUUID } from 'node:crypto'
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
  const session = { socket, playerId: randomUUID(), welcomed: false, lastSeq: -1, tokens: 40, refilledAt: Date.now() }
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
      if (decoded.code !== 'stale_input' && decoded.code !== 'rate_limited') {
        socket.close(decoded.code === 'protocol_mismatch' ? 4001 : decoded.code === 'authority_violation' ? 4003 : 4002, decoded.code)
      }
      return
    }
    const message = decoded.message
    if (message.type === 'hello') {
      if (session.welcomed) { send(session, refused('session_order')); socket.close(4002, 'session_order'); return }
      session.welcomed = true
      clearTimeout(helloTimeout)
      shard.join(session.playerId)
      send(session, { v: PROTOCOL_VERSION, type: 'welcome', playerId: session.playerId, snapshot: shard.state })
      for (const peer of sessions) if (peer.welcomed) snapshot(peer)
      return
    }
    if (!session.welcomed) { send(session, refused('session_order')); socket.close(4002, 'session_order'); return }
    if (message.seq <= session.lastSeq) { send(session, refused('stale_input')); return }
    session.lastSeq = message.seq
    shard.enqueue(session.playerId, message)
  })
  socket.on('close', () => {
    clearTimeout(helloTimeout)
    sessions.delete(session)
    if (session.welcomed) {
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
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  clearInterval(tick)
  for (const session of sessions) session.socket.close(1001, 'server stopping')
  sockets.close()
  http.close(() => process.exit(0))
  http.closeAllConnections?.()
})

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
