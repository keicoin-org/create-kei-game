/** Unit proof for the project-owned protocol and authoritative shard. */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { projectFiles } from '../src/scaffold.js'
import { planFor } from './fixtures.js'

const root = mkdtempSync(join(tmpdir(), 'kei-network-unit-'))

interface ProtocolModule {
  readonly decodeClientMessage: (raw: string) =>
    | { readonly ok: true; readonly message: Record<string, unknown> }
    | { readonly ok: false; readonly code: string }
  readonly serverMessageOf: (raw: string) => unknown
}

interface ShardModule {
  readonly createShard: () => {
    readonly state: {
      readonly tick: number
      readonly players: Readonly<Record<string, { readonly x: number; readonly y: number; readonly z: number }>>
    }
    readonly join: (id: string) => void
    readonly leave: (id: string) => void
    readonly advance: (ms: number) => void
    readonly enqueue: (
      id: string,
      input: { readonly seq: number; readonly moveX: number; readonly moveY: number; readonly buttons: number },
    ) => void
  }
}

let protocol: ProtocolModule
let shardModule: ShardModule

beforeAll(async () => {
  const plan = planFor({
    name: 'Network Unit',
    dimension: '2d',
    gameplay: 'Players meet in one shared authoritative construction room.',
  })
  for (const file of projectFiles({ slug: 'network-unit', title: 'Network Unit' }, plan)) {
    if (!['src/shared/simulation.ts', 'src/shared/protocol.ts', 'src/server/main.ts'].includes(file.path)) continue
    const target = join(root, ...file.path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.contents, 'utf8')
  }
  protocol = await import(pathToFileURL(join(root, 'src/shared/protocol.ts')).href) as ProtocolModule
  shardModule = await import(pathToFileURL(join(root, 'src/server/main.ts')).href) as ShardModule
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('generated game protocol v1', () => {
  test('accepts only exact hello and intent messages', () => {
    expect(protocol.decodeClientMessage('{"v":1,"type":"hello"}')).toEqual({
      ok: true,
      message: { v: 1, type: 'hello' },
    })
    expect(protocol.decodeClientMessage('{"v":1,"type":"input","seq":2,"moveX":1,"moveY":0,"buttons":0}')).toEqual({
      ok: true,
      message: { v: 1, type: 'input', seq: 2, moveX: 1, moveY: 0, buttons: 0 },
    })
    expect(protocol.decodeClientMessage('{"v":1,"type":"hello","extra":true}')).toEqual({
      ok: false,
      code: 'invalid_message',
    })
  })

  test('refuses stale protocol, invalid axes, and authority claims by stable code', () => {
    expect(protocol.decodeClientMessage('{"v":2,"type":"hello"}')).toEqual({
      ok: false,
      code: 'protocol_mismatch',
    })
    expect(protocol.decodeClientMessage('{"v":1,"type":"input","seq":1,"moveX":2,"moveY":0,"buttons":0}')).toEqual({
      ok: false,
      code: 'invalid_message',
    })
    for (const forged of [
      { v: 1, type: 'teleport', position: { x: 999, y: 0, z: 0 } },
      { v: 1, type: 'input', seq: 1, moveX: 0, moveY: 0, buttons: 0, playerId: 'somebody-else' },
      { v: 1, type: 'state', players: {} },
      { v: 1, type: 'input', seq: 2, moveX: 0, moveY: 0, buttons: 0, balance: '999' },
      { v: 1, type: 'settlement', settlementResult: { accepted: true } },
    ]) {
      expect(protocol.decodeClientMessage(JSON.stringify(forged))).toEqual({
        ok: false,
        code: 'authority_violation',
      })
    }
  })

  test('does not accept an invented server refusal as part of protocol v1', () => {
    expect(protocol.serverMessageOf('{"v":1,"type":"refused","code":"whatever"}')).toBeNull()
    expect(protocol.serverMessageOf('{"v":1,"type":"refused","code":"stale_input"}')).toEqual({
      v: 1,
      type: 'refused',
      code: 'stale_input',
    })
  })

  test('accepts only exact server snapshot and player records', () => {
    const valid = {
      v: 1,
      type: 'snapshot',
      ackSeq: 3,
      world: { tick: 4, players: { player: { x: 1, y: 0, z: 2 } } },
    }
    expect(protocol.serverMessageOf(JSON.stringify(valid))).toEqual(valid)
    expect(protocol.serverMessageOf(JSON.stringify({
      ...valid,
      world: { ...valid.world, invented: true },
    }))).toBeNull()
    expect(protocol.serverMessageOf(JSON.stringify({
      ...valid,
      world: { tick: 4, players: { player: { x: 1, y: 0, z: 2, invented: true } } },
    }))).toBeNull()
  })
})

describe('generated authoritative shard', () => {
  test('assigns dynamic players, applies one tick of intent, then stops without another input', () => {
    const shard = shardModule.createShard()
    shard.join('server-a')
    shard.join('server-b')
    const before = shard.state.players['server-a']
    expect(before).toBeDefined()
    expect(shard.state.players['server-b']).toBeDefined()

    shard.enqueue('server-a', { seq: 1, moveX: 1, moveY: 0, buttons: 0 })
    shard.advance(50)
    const moved = shard.state.players['server-a']
    expect(moved!.x).toBeGreaterThan(before!.x)

    shard.advance(50)
    expect(shard.state.players['server-a']!.x).toBe(moved!.x)
    expect(shard.state.tick).toBe(2)

    shard.leave('server-b')
    expect(shard.state.players['server-b']).toBeUndefined()
  })

  test('retains fractional elapsed time and catches up by whole authoritative steps', () => {
    const shard = shardModule.createShard()
    shard.join('server-a')
    shard.enqueue('server-a', { seq: 1, moveX: 1, moveY: 0, buttons: 0 })
    shard.advance(125)
    expect(shard.state.tick).toBe(2)
    shard.advance(24)
    expect(shard.state.tick).toBe(2)
    shard.advance(1)
    expect(shard.state.tick).toBe(3)
  })
})
