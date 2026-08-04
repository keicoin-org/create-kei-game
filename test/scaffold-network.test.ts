/** Unit proof for the project-owned protocol, durable store, and shard. */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { projectFiles } from '../src/scaffold.js'
import { planFor } from './fixtures.js'

const root = mkdtempSync(join(tmpdir(), 'kei-network-unit-'))

interface Player {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly xp: number
  readonly level: number
}

interface ProtocolModule {
  readonly decodeClientMessage: (raw: string) =>
    | { readonly ok: true; readonly message: Record<string, unknown> }
    | { readonly ok: false; readonly code: string }
  readonly serverMessageOf: (raw: string) => unknown
}

interface CharacterStoreLike {
  readonly database: Database
  readonly createCharacter: () => { readonly character: Player & { readonly playerId: string }; readonly resumeToken: string }
  readonly findByResumeToken: (token: string) => (Player & { readonly playerId: string }) | null
  readonly character: (playerId: string) => (Player & { readonly playerId: string }) | null
  readonly saveDirty: (characters: readonly (Player & { readonly playerId: string; readonly updatedAt: number })[]) => void
  readonly close: () => void
}

interface PersistenceModule {
  readonly CharacterStore: new (path: string) => CharacterStoreLike
  readonly hashResumeToken: (token: string) => string | null
}

interface ShardModule {
  readonly createShard: (store: CharacterStoreLike) => {
    readonly state: { readonly tick: number; readonly players: Readonly<Record<string, Player>> }
    readonly join: (token?: string) =>
      | { readonly ok: true; readonly playerId: string; readonly resumeToken?: string }
      | { readonly ok: false; readonly code: string }
    readonly leave: (id: string) => void
    readonly advance: (ms: number) => void
    readonly enqueue: (
      id: string,
      input: { readonly seq: number; readonly moveX: number; readonly moveY: number; readonly buttons: number },
    ) => void
    readonly close: () => void
  }
}

let protocol: ProtocolModule
let persistence: PersistenceModule
let shardModule: ShardModule
let restartProof = ''

beforeAll(async () => {
  const plan = planFor({
    name: 'Network Unit',
    dimension: '2d',
    gameplay: 'Players meet in one shared authoritative construction room.',
  })
  const wanted = new Set([
    'src/shared/simulation.ts', 'src/shared/protocol.ts',
    'src/server/persistence.ts', 'src/server/main.ts',
  ])
  for (const file of projectFiles({ slug: 'network-unit', title: 'Network Unit' }, plan)) {
    if (file.path === 'src/client/restart-proof.ts') restartProof = file.contents
    if (!wanted.has(file.path)) continue
    const target = join(root, ...file.path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.contents, 'utf8')
  }
  protocol = await import(pathToFileURL(join(root, 'src/shared/protocol.ts')).href) as ProtocolModule
  persistence = await import(pathToFileURL(join(root, 'src/server/persistence.ts')).href) as PersistenceModule
  shardModule = await import(pathToFileURL(join(root, 'src/server/main.ts')).href) as ShardModule
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('generated game protocol v2', () => {
  test('accepts exact new, resume, and intent messages', () => {
    expect(protocol.decodeClientMessage('{"v":2,"type":"hello"}')).toEqual({
      ok: true, message: { v: 2, type: 'hello' },
    })
    expect(protocol.decodeClientMessage('{"v":2,"type":"hello","resumeToken":"opaque"}')).toEqual({
      ok: true, message: { v: 2, type: 'hello', resumeToken: 'opaque' },
    })
    expect(protocol.decodeClientMessage('{"v":2,"type":"input","seq":2,"moveX":1,"moveY":0,"buttons":1}')).toEqual({
      ok: true, message: { v: 2, type: 'input', seq: 2, moveX: 1, moveY: 0, buttons: 1 },
    })
    expect(protocol.decodeClientMessage('{"v":2,"type":"hello","extra":true}')).toEqual({
      ok: false, code: 'invalid_message',
    })
  })

  test('refuses stale protocol, invalid input, and every authority claim by stable code', () => {
    expect(protocol.decodeClientMessage('{"v":1,"type":"hello"}')).toEqual({
      ok: false, code: 'protocol_mismatch',
    })
    expect(protocol.decodeClientMessage('{"v":2,"type":"input","seq":1,"moveX":2,"moveY":0,"buttons":0}')).toEqual({
      ok: false, code: 'invalid_message',
    })
    for (const key of [
      'position', 'x', 'xp', 'level', 'progression', 'inventory', 'balance', 'balances',
      'currency', 'items', 'item', 'mint', 'transfer', 'settlement', 'settlementResult',
      'seed', 'walletSeed', 'playerId',
    ]) {
      expect(protocol.decodeClientMessage(JSON.stringify({
        v: 2, type: 'input', seq: 1, moveX: 0, moveY: 0, buttons: 0, [key]: 999,
      }))).toEqual({ ok: false, code: 'authority_violation' })
    }
  })

  test('accepts only exact server records including derived progression', () => {
    const valid = {
      v: 2, type: 'snapshot', ackSeq: 3,
      world: { tick: 4, players: { player: { x: 1, y: 0, z: 2, xp: 10, level: 2 } } },
    }
    expect(protocol.serverMessageOf(JSON.stringify(valid))).toEqual(valid)
    expect(protocol.serverMessageOf(JSON.stringify({ ...valid, world: { ...valid.world, invented: true } }))).toBeNull()
    expect(protocol.serverMessageOf(JSON.stringify({
      ...valid,
      world: { tick: 4, players: { player: { ...valid.world.players.player, invented: true } } },
    }))).toBeNull()
    expect(protocol.serverMessageOf(JSON.stringify({
      ...valid,
      world: { tick: 4, players: { player: { ...valid.world.players.player, level: 99 } } },
    }))).toBeNull()
    expect(protocol.serverMessageOf('{"v":2,"type":"refused","code":"resume_refused"}')).toEqual({
      v: 2, type: 'refused', code: 'resume_refused',
    })
  })
})

describe('generated durable character store', () => {
  test('stores only a token hash and saves dirty position/progression transactionally', () => {
    const path = join(root, 'store.sqlite')
    const store = new persistence.CharacterStore(path)
    const created = store.createCharacter()
    expect(created.resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(store.findByResumeToken(created.resumeToken)?.playerId).toBe(created.character.playerId)
    expect(store.findByResumeToken('malformed')).toBeNull()

    store.saveDirty([{ ...created.character, x: 4, xp: 10, level: 2, updatedAt: Date.now() }])
    expect(store.character(created.character.playerId)).toMatchObject({ x: 4, xp: 10, level: 2 })
    expect(() => store.saveDirty([
      { ...created.character, x: 8, updatedAt: Date.now() },
      { ...created.character, playerId: 'missing', x: 9, updatedAt: Date.now() },
    ])).toThrow('unknown character')
    expect(store.character(created.character.playerId)).toMatchObject({ x: 4, xp: 10, level: 2 })
    const columnStatement = store.database.prepare('PRAGMA table_info(characters)')
    const columns = columnStatement.all().map((row) => String((row as { name: unknown }).name))
    columnStatement.finalize()
    expect(columns).toEqual(['player_id', 'resume_hash', 'x', 'y', 'z', 'xp', 'level', 'updated_at'])
    const hashStatement = store.database.prepare('SELECT resume_hash FROM characters')
    const persisted = hashStatement.get() as { resume_hash: string }
    hashStatement.finalize()
    const expectedHash = persistence.hashResumeToken(created.resumeToken)
    if (expectedHash === null) throw new Error('generated token did not hash')
    expect(persisted.resume_hash).toBe(expectedHash)
    expect(persisted.resume_hash).not.toBe(created.resumeToken)
    store.close()
    expect(readFileSync(path).includes(Buffer.from(created.resumeToken, 'utf8'))).toBeFalse()
  })

  test('refuses an unknown schema version instead of replacing it', () => {
    const path = join(root, 'future.sqlite')
    const raw = new Database(path, { create: true })
    raw.exec('CREATE TABLE world_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT')
    raw.exec("INSERT INTO world_metadata (key, value) VALUES ('schema_version', '999')")
    raw.exec('CREATE TABLE characters (only_wrong TEXT)')
    raw.close()
    expect(() => new persistence.CharacterStore(path)).toThrow('schema version is not supported')
  })
})

describe('generated authoritative durable shard', () => {
  test('moves and progresses by intent, survives disconnect, and resumes exact state', () => {
    const path = join(root, 'shard.sqlite')
    const shard = shardModule.createShard(new persistence.CharacterStore(path))
    const joined = shard.join()
    if (!joined.ok || joined.resumeToken === undefined) throw new Error('new character was not created')
    const before = shard.state.players[joined.playerId]
    expect(before).toBeDefined()

    shard.enqueue(joined.playerId, { seq: 1, moveX: 1, moveY: 0, buttons: 1 })
    shard.advance(50)
    const authored = shard.state.players[joined.playerId]
    expect(authored!.x).toBeGreaterThan(before!.x)
    expect(authored).toMatchObject({ xp: 10, level: 2 })

    shard.leave(joined.playerId)
    expect(shard.state.players[joined.playerId]).toBeUndefined()
    const resumed = shard.join(joined.resumeToken)
    expect(resumed).toEqual({ ok: true, playerId: joined.playerId })
    expect(shard.state.players[joined.playerId]).toEqual(authored)
    expect(shard.join(joined.resumeToken)).toEqual({ ok: false, code: 'resume_in_use' })
    expect(shard.join('A'.repeat(43))).toEqual({ ok: false, code: 'resume_refused' })
    shard.close()
  })
})

describe('generated restart proof process hygiene', () => {
  test('owns every spawned server through bounded cleanup before deleting its database', () => {
    expect(restartProof).toContain("spawn(process.execPath, ['src/server/dev-server.mjs']")
    expect(restartProof).not.toContain("spawn(process.execPath, ['run', 'src/server/dev-server.mjs']")
    expect(restartProof.match(/child\.exitCode !== null \|\| child\.signalCode !== null/g)).toHaveLength(3)
    expect(restartProof).toContain('const finish = (result: ExitResult | null): void =>')
    expect(restartProof).toContain("child.off('exit', onExit)")
    expect(restartProof).toContain('try { await terminateChild(child) }')
    expect(restartProof).toContain('if (server !== null)')
    expect(restartProof.indexOf('await terminateChild(server.child)')).toBeLessThan(restartProof.indexOf('rmSync(root'))
    expect(restartProof).toContain('failure = preservePrimary(failure, cleanup)')
  })
})
