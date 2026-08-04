/** The smallest project-owned game transport needed for one headless client. */

import type { WorkspaceFile } from './source.js'

export const CONNECTION_PATH = 'src/client/connection.ts'
export const HEADLESS_CLIENT_PATH = 'src/client/headless.ts'
export const PROTOCOL_PATH = 'src/shared/protocol.ts'
export const HEADLESS_CLIENT_BUNDLE = 'headless/headless.js'
export const GAME_SOCKET_PATH = '/game'
export const GAME_PROTOCOL_VERSION = 1
export const WEBSOCKET_PACKAGE = 'ws'
export const WEBSOCKET_RANGE = '^8.18.3'

export function connectionProjectFiles(): readonly WorkspaceFile[] {
  return Object.freeze([
    { path: PROTOCOL_PATH, contents: protocolSource() },
    { path: CONNECTION_PATH, contents: connectionSource() },
    { path: HEADLESS_CLIENT_PATH, contents: headlessSource() },
  ])
}

function protocolSource(): string {
  return `import type { WorldState } from './simulation.js'

export const PROTOCOL_VERSION = ${GAME_PROTOCOL_VERSION} as const
export const GAME_PATH = '${GAME_SOCKET_PATH}'
export const MAX_MESSAGE_BYTES = 64 * 1024

export type RefusalCode = 'protocol_mismatch' | 'invalid_message' | 'session_order'

export interface WelcomeMessage {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'welcome'
  readonly playerId: string
  readonly snapshot: WorldState
}

export interface RefusedMessage {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'refused'
  readonly code: RefusalCode
}

export type ServerMessage = WelcomeMessage | RefusedMessage

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

export function helloCode(raw: string): RefusalCode | null {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return 'invalid_message' }
  const value = record(parsed)
  if (value === null) return 'invalid_message'
  if (value.v !== PROTOCOL_VERSION) return 'protocol_mismatch'
  return value.type === 'hello' && exact(value, ['v', 'type']) ? null : 'invalid_message'
}

function worldOf(value: unknown): WorldState | null {
  const candidate = record(value)
  if (candidate === null || !Number.isSafeInteger(candidate.tick) || (candidate.tick as number) < 0) return null
  if (!exact(candidate, ['tick', 'players'])) return null
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
  try { parsed = JSON.parse(raw) } catch { return null }
  const value = record(parsed)
  if (value === null || value.v !== PROTOCOL_VERSION) return null
  if (
    value.type === 'refused' &&
    exact(value, ['v', 'type', 'code']) &&
    ['protocol_mismatch', 'invalid_message', 'session_order'].includes(String(value.code))
  ) {
    return value as unknown as RefusedMessage
  }
  if (
    value.type !== 'welcome' ||
    !exact(value, ['v', 'type', 'playerId', 'snapshot']) ||
    typeof value.playerId !== 'string' ||
    value.playerId.length === 0
  ) return null
  const snapshot = worldOf(value.snapshot)
  return snapshot === null
    ? null
    : { v: PROTOCOL_VERSION, type: 'welcome', playerId: value.playerId, snapshot }
}

export function refused(code: RefusalCode): RefusedMessage {
  return { v: PROTOCOL_VERSION, type: 'refused', code }
}
`
}

function connectionSource(): string {
  return `import { GAME_PATH, PROTOCOL_VERSION, serverMessageOf } from '../shared/protocol.js'
import type { WorldState } from '../shared/simulation.js'

export class GameConnectionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'GameConnectionError'
  }
}

export interface GameConnection {
  readonly playerId: string
  readonly snapshot: WorldState
  /** Resolves only after the WebSocket close handshake completes. */
  readonly close: () => Promise<void>
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
    let welcomed = false
    let closeResolve: (() => void) | undefined
    const closed = new Promise<void>((done) => { closeResolve = done })
    const opening = setTimeout(() => {
      socket.close()
      reject(new GameConnectionError('connect_timeout', 'The game server did not welcome this client in time.'))
    }, timeoutMs)

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'hello' }))
    })
    socket.addEventListener('message', (event) => {
      const message = serverMessageOf(String(event.data))
      if (message === null) {
        clearTimeout(opening)
        socket.close()
        reject(new GameConnectionError('invalid_server_message', 'The game server sent a message outside protocol v1.'))
        return
      }
      if (message.type === 'refused') {
        clearTimeout(opening)
        socket.close()
        reject(new GameConnectionError(message.code, 'The game server refused the connection.'))
        return
      }
      if (welcomed) {
        socket.close()
        return
      }
      welcomed = true
      clearTimeout(opening)
      resolve({
        playerId: message.playerId,
        snapshot: message.snapshot,
        close: async () => {
          if (socket.readyState === WebSocket.CLOSED) return
          socket.close(1000, 'client done')
          await new Promise<void>((done, fail) => {
            const timer = setTimeout(
              () => fail(new GameConnectionError('disconnect_timeout', 'The game connection did not close in time.')),
              timeoutMs,
            )
            void closed.then(() => { clearTimeout(timer); done() })
          })
        },
      })
    })
    socket.addEventListener('close', () => {
      clearTimeout(opening)
      closeResolve?.()
      if (!welcomed) reject(new GameConnectionError('connection_closed', 'The game connection closed before welcome.'))
    })
    socket.addEventListener('error', () => {
      if (!welcomed) reject(new GameConnectionError('connect_failed', 'The game server connection failed.'))
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

try {
  const connection = await connectGame(endpoint)
  if (connection.snapshot.players[connection.playerId] === undefined) {
    throw new Error('the authoritative snapshot omitted this client')
  }
  await connection.close()
  process.stdout.write(JSON.stringify({
    event: 'headless_connected',
    protocol: ${GAME_PROTOCOL_VERSION},
    playerId: connection.playerId,
    tick: connection.snapshot.tick,
    cleanDisconnect: true,
  }) + '\\n')
} catch (error) {
  process.stderr.write(JSON.stringify({
    event: 'error',
    code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'headless_connect_failed',
    message: error instanceof Error ? error.message : String(error),
  }) + '\\n')
  process.exit(1)
}
`
}
