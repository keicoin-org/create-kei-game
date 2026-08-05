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
  readonly createCharacter: () => { readonly character: Player & { readonly playerId: string; readonly updatedAt: number }; readonly resumeToken: string }
  readonly findByResumeToken: (token: string) => (Player & { readonly playerId: string; readonly updatedAt: number }) | null
  readonly character: (playerId: string) => (Player & { readonly playerId: string; readonly updatedAt: number }) | null
  readonly saveDirty: (characters: readonly (Player & { readonly playerId: string; readonly updatedAt: number })[]) => void
  readonly saveContact: (character: Player & { readonly playerId: string; readonly updatedAt: number }, blockUntil: number) => void
  readonly actionGuard: (playerId: string) => number | null
  readonly clearExpiredActionGuards: (now: number, protectedPlayerIds?: readonly string[]) => void
  readonly actionGuardCount: () => number
  readonly close: () => void
}

interface PersistenceModule {
  readonly CharacterStore: new (path: string) => CharacterStoreLike
  readonly hashResumeToken: (token: string) => string | null
}

interface ShardModule {
  readonly createShard: (store: CharacterStoreLike, now?: () => number) => {
    readonly state: {
      readonly tick: number
      readonly players: Readonly<Record<string, Player>>
      readonly encounter: {
        readonly sentinel: { readonly interactions: number; readonly strikes: number }
        readonly events: readonly Record<string, unknown>[]
      }
    }
    readonly authorityCounts: {
      readonly active: number
      readonly cooldowns: number
      readonly restartGuards: number
      readonly durableGuards: number
    }
    readonly join: (token?: string) =>
      | { readonly ok: true; readonly playerId: string; readonly resumeToken?: string }
      | { readonly ok: false; readonly code: string }
    readonly leave: (id: string) => void
    readonly advance: (ms: number) => void
    readonly enqueue: (
      id: string,
      input: { readonly seq: number; readonly moveX: number; readonly moveY: number; readonly buttons: number },
    ) => void
    readonly requestAction: (
      id: string,
      intent: { readonly actionVersion: 1; readonly kind: 'interact' | 'strike'; readonly targetId: 'training-sentinel' },
    ) => { readonly ok: true } | { readonly ok: false; readonly code: string }
    readonly character: (id: string) => Player | null
    readonly close: () => void
  }
}

let protocol: ProtocolModule
let persistence: PersistenceModule
let shardModule: ShardModule
let restartProof = ''
let reducer: {
  readonly createActionEventReducer: () => {
    readonly reduce: (world: unknown) => readonly unknown[]
    readonly lastEventId: () => number
  }
}

beforeAll(async () => {
  const plan = planFor({
    name: 'Network Unit',
    dimension: '2d',
    gameplay: 'Players meet in one shared authoritative construction room.',
  })
  const wanted = new Set([
    'src/shared/actions.ts', 'src/shared/simulation.ts', 'src/shared/protocol.ts',
    'src/client/action-events.ts',
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
  reducer = await import(pathToFileURL(join(root, 'src/client/action-events.ts')).href) as typeof reducer
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
    expect(protocol.decodeClientMessage('{"v":2,"type":"input","seq":2,"moveX":1,"moveY":0,"buttons":0}')).toEqual({
      ok: true, message: { v: 2, type: 'input', seq: 2, moveX: 1, moveY: 0, buttons: 0 },
    })
    expect(protocol.decodeClientMessage('{"v":2,"type":"action","seq":3,"actionVersion":1,"kind":"strike","targetId":"training-sentinel"}')).toEqual({
      ok: true, message: { v: 2, type: 'action', seq: 3, actionVersion: 1, kind: 'strike', targetId: 'training-sentinel' },
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
    expect(protocol.decodeClientMessage('{"v":2,"type":"input","seq":1,"moveX":0,"moveY":0,"buttons":1}')).toEqual({
      ok: false, code: 'invalid_message',
    })
    expect(protocol.decodeClientMessage('{"v":2,"type":"action","seq":1,"actionVersion":1,"kind":"strike","targetId":"other"}')).toEqual({
      ok: false, code: 'action_target_refused',
    })
    for (const key of [
      'position', 'x', 'xp', 'level', 'progression', 'inventory', 'balance', 'balances',
      'currency', 'items', 'item', 'mint', 'transfer', 'settlement', 'settlementResult',
      'seed', 'wallet', 'walletSeed', 'playerId', 'damage', 'outcome', 'actorId', 'eventId',
    ]) {
      expect(protocol.decodeClientMessage(JSON.stringify({
        v: 2, type: 'input', seq: 1, moveX: 0, moveY: 0, buttons: 0, [key]: 999,
      }))).toEqual({ ok: false, code: 'authority_violation' })
    }
  })

  test('accepts only exact server records including derived progression', () => {
    const valid = {
      v: 2, type: 'snapshot', ackSeq: 3,
      world: {
        tick: 4,
        players: { player: { x: 1, y: 0, z: 2, xp: 10, level: 2 } },
        encounter: {
          sentinel: { id: 'training-sentinel', x: 0, y: 0, z: 0, interactions: 1, strikes: 0 },
          events: [{
            actionVersion: 1, eventId: 1, tick: 3, actorId: 'player', targetId: 'training-sentinel',
            kind: 'interact', phase: 'contact', outcome: 'applied', contact: true,
          }],
        },
      },
    }
    expect(protocol.serverMessageOf(JSON.stringify(valid))).toEqual(valid)
    expect(protocol.serverMessageOf(JSON.stringify({ ...valid, world: { ...valid.world, invented: true } }))).toBeNull()
    expect(protocol.serverMessageOf(JSON.stringify({
      ...valid,
      world: {
        ...valid.world,
        encounter: {
          ...valid.world.encounter,
          events: [{ ...valid.world.encounter.events[0], tick: 5 }],
        },
      },
    }))).toBeNull()
    expect(protocol.serverMessageOf(JSON.stringify({
      ...valid,
      world: {
        ...valid.world,
        encounter: {
          ...valid.world.encounter,
          events: [
            valid.world.encounter.events[0],
            { ...valid.world.encounter.events[0], eventId: 2, tick: 2 },
          ],
        },
      },
    }))).toBeNull()
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

describe('generated semantic event reducer', () => {
  test('emits one presentation hook per event despite duplicate and out-of-order snapshots', () => {
    const action = reducer.createActionEventReducer()
    const player = { x: 0, y: 0, z: 0, xp: 0, level: 1 }
    const sentinel = { id: 'training-sentinel', x: 0, y: 0, z: 0, interactions: 0, strikes: 0 }
    const anticipation = {
      actionVersion: 1, eventId: 1, tick: 1, actorId: 'player', targetId: 'training-sentinel',
      kind: 'strike', phase: 'anticipation', outcome: 'accepted', contact: false,
    }
    const contact = {
      actionVersion: 1, eventId: 2, tick: 3, actorId: 'player', targetId: 'training-sentinel',
      kind: 'strike', phase: 'contact', outcome: 'applied', contact: true,
    }
    const first = { tick: 1, players: { player }, encounter: { sentinel, events: [anticipation] } }
    const later = { tick: 3, players: { player }, encounter: { sentinel, events: [anticipation, contact] } }
    expect(action.reduce(first)).toHaveLength(1)
    expect(action.reduce(first)).toEqual([])
    expect(action.reduce(later)).toHaveLength(1)
    expect(action.lastEventId()).toBe(2)
    expect(action.reduce(first)).toEqual([])
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
    store.saveContact({
      ...created.character, x: 4, xp: 20, level: 3, updatedAt: 1_000,
    }, 1_300)
    expect(store.character(created.character.playerId)).toMatchObject({ x: 4, xp: 20, level: 3 })
    expect(store.actionGuard(created.character.playerId)).toBe(1_300)
    expect(store.actionGuardCount()).toBe(1)
    store.clearExpiredActionGuards(1_299)
    expect(store.actionGuardCount()).toBe(1)
    store.clearExpiredActionGuards(1_300, [created.character.playerId])
    expect(store.actionGuardCount()).toBe(1)
    store.clearExpiredActionGuards(1_300)
    expect(store.actionGuardCount()).toBe(0)
    const columnStatement = store.database.prepare('PRAGMA table_info(characters)')
    const columns = columnStatement.all().map((row) => String((row as { name: unknown }).name))
    columnStatement.finalize()
    expect(columns).toEqual(['player_id', 'resume_hash', 'x', 'y', 'z', 'xp', 'level', 'updated_at'])
    const guardColumnStatement = store.database.prepare('PRAGMA table_info(action_guards)')
    const guardColumns = guardColumnStatement.all().map((row) => String((row as { name: unknown }).name))
    guardColumnStatement.finalize()
    expect(guardColumns).toEqual(['player_id', 'block_until'])
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
  test('moves, authors one contact per action, refuses phase/range/cooldown, and resumes exact progression', () => {
    const path = join(root, 'shard.sqlite')
    const shard = shardModule.createShard(new persistence.CharacterStore(path))
    const joined = shard.join()
    if (!joined.ok || joined.resumeToken === undefined) throw new Error('new character was not created')
    const before = shard.state.players[joined.playerId]
    expect(before).toBeDefined()

    shard.enqueue(joined.playerId, { seq: 1, moveX: 1, moveY: 0, buttons: 0 })
    shard.advance(50)
    expect(shard.state.players[joined.playerId]!.x).toBeGreaterThan(before!.x)
    expect(shard.state.players[joined.playerId]).toMatchObject({ xp: 0, level: 1 })

    const interact = { actionVersion: 1 as const, kind: 'interact' as const, targetId: 'training-sentinel' as const }
    expect(shard.requestAction(joined.playerId, interact)).toEqual({ ok: true })
    expect(shard.requestAction(joined.playerId, interact)).toEqual({ ok: false, code: 'action_busy' })
    shard.advance(100)
    expect(shard.state.players[joined.playerId]).toMatchObject({ xp: 10, level: 2 })
    expect(shard.state.encounter.sentinel).toMatchObject({ interactions: 1, strikes: 0 })
    expect(shard.requestAction(joined.playerId, interact)).toEqual({ ok: false, code: 'action_busy' })
    shard.advance(100)
    expect(shard.requestAction(joined.playerId, interact)).toEqual({ ok: false, code: 'action_cooldown' })
    shard.advance(250)

    const strike = { actionVersion: 1 as const, kind: 'strike' as const, targetId: 'training-sentinel' as const }
    expect(shard.requestAction(joined.playerId, strike)).toEqual({ ok: true })
    shard.advance(100)
    const authored = shard.state.players[joined.playerId]
    expect(authored).toMatchObject({ xp: 20, level: 3 })
    expect(shard.state.encounter.sentinel).toMatchObject({ interactions: 1, strikes: 1 })
    shard.advance(250)
    expect(shard.state.players[joined.playerId]).toEqual(authored)
    expect(shard.state.encounter.events.map((event) => [event.eventId, event.kind, event.phase, event.contact])).toEqual([
      [1, 'interact', 'anticipation', false],
      [2, 'interact', 'contact', true],
      [3, 'interact', 'recovery', false],
      [4, 'strike', 'anticipation', false],
      [5, 'strike', 'contact', true],
      [6, 'strike', 'recovery', false],
    ])

    const near = shard.join()
    const far = shard.join()
    if (!near.ok || !far.ok) throw new Error('range fixtures were not created')
    for (let seq = 1; seq <= 11; seq += 1) {
      shard.enqueue(far.playerId, { seq, moveX: 1, moveY: 0, buttons: 0 })
      shard.advance(50)
    }
    expect(shard.requestAction(far.playerId, interact)).toEqual({ ok: false, code: 'action_too_far' })
    expect(shard.state.players[far.playerId]).toMatchObject({ xp: 0, level: 1 })
    expect(shard.state.encounter.sentinel).toMatchObject({ interactions: 1, strikes: 1 })

    shard.leave(joined.playerId)
    expect(shard.state.players[joined.playerId]).toBeUndefined()
    const resumed = shard.join(joined.resumeToken)
    expect(resumed).toEqual({ ok: true, playerId: joined.playerId })
    expect(shard.state.players[joined.playerId]).toEqual(authored)
    expect(shard.join(joined.resumeToken)).toEqual({ ok: false, code: 'resume_in_use' })
    expect(shard.join('A'.repeat(43))).toEqual({ ok: false, code: 'resume_refused' })
    shard.close()
  })

  test('keeps action authority across same-tick disconnect/resume and prunes abandoned guards', () => {
    const path = join(root, 'disconnect-authority.sqlite')
    let wallNow = 0
    const shard = shardModule.createShard(new persistence.CharacterStore(path), () => wallNow)
    const interact = { actionVersion: 1 as const, kind: 'interact' as const, targetId: 'training-sentinel' as const }
    const joined = shard.join()
    if (!joined.ok || joined.resumeToken === undefined) throw new Error('new character was not created')

    expect(shard.requestAction(joined.playerId, interact)).toEqual({ ok: true })
    shard.leave(joined.playerId)
    expect(shard.join(joined.resumeToken)).toEqual({ ok: true, playerId: joined.playerId })
    expect(shard.requestAction(joined.playerId, interact)).toEqual({ ok: false, code: 'action_busy' })
    shard.advance(100)
    expect(shard.state.players[joined.playerId]).toMatchObject({ xp: 10, level: 2 })
    expect(shard.state.encounter.sentinel).toMatchObject({ interactions: 1, strikes: 0 })

    shard.leave(joined.playerId)
    expect(shard.join(joined.resumeToken)).toEqual({ ok: true, playerId: joined.playerId })
    expect(shard.requestAction(joined.playerId, interact)).toEqual({ ok: false, code: 'action_busy' })
    shard.advance(100)
    shard.leave(joined.playerId)
    expect(shard.join(joined.resumeToken)).toEqual({ ok: true, playerId: joined.playerId })
    expect(shard.requestAction(joined.playerId, interact)).toEqual({ ok: false, code: 'action_cooldown' })
    expect(shard.state.players[joined.playerId]).toMatchObject({ xp: 10, level: 2 })
    expect(shard.state.encounter.events.map((event) => event.phase)).toEqual([
      'anticipation', 'contact', 'recovery',
    ])

    shard.leave(joined.playerId)
    for (let index = 0; index < 40; index += 1) {
      const abandoned = shard.join()
      if (!abandoned.ok) throw new Error('abandoned fixture was not created')
      expect(shard.requestAction(abandoned.playerId, interact)).toEqual({ ok: true })
      shard.leave(abandoned.playerId)
    }
    expect(shard.authorityCounts).toEqual({ active: 40, cooldowns: 1, restartGuards: 1, durableGuards: 1 })
    shard.advance(200)
    expect(shard.authorityCounts).toEqual({ active: 0, cooldowns: 40, restartGuards: 1, durableGuards: 41 })
    wallNow = 300
    shard.advance(250)
    expect(shard.authorityCounts).toEqual({ active: 0, cooldowns: 0, restartGuards: 0, durableGuards: 0 })
    expect(shard.state.encounter.events).toHaveLength(32)
    expect(shard.character(joined.playerId)).toMatchObject({ xp: 10, level: 2 })
    shard.close()
  })

  test('cancels pre-contact work and conservatively guards a durable contact across restart', () => {
    const path = join(root, 'restart-action-authority.sqlite')
    let wallNow = 10_000
    const now = () => wallNow
    const strike = { actionVersion: 1 as const, kind: 'strike' as const, targetId: 'training-sentinel' as const }

    let shard = shardModule.createShard(new persistence.CharacterStore(path), now)
    const beforeContact = shard.join()
    if (!beforeContact.ok || beforeContact.resumeToken === undefined) throw new Error('new character was not created')
    expect(shard.requestAction(beforeContact.playerId, strike)).toEqual({ ok: true })
    shard.close()

    shard = shardModule.createShard(new persistence.CharacterStore(path), now)
    expect(shard.join(beforeContact.resumeToken)).toEqual({ ok: true, playerId: beforeContact.playerId })
    expect(shard.character(beforeContact.playerId)).toMatchObject({ xp: 0, level: 1 })
    expect(shard.requestAction(beforeContact.playerId, strike)).toEqual({ ok: true })
    shard.advance(100)
    expect(shard.character(beforeContact.playerId)).toMatchObject({ xp: 10, level: 2 })
    shard.close()

    shard = shardModule.createShard(new persistence.CharacterStore(path), now)
    expect(shard.join(beforeContact.resumeToken)).toEqual({ ok: true, playerId: beforeContact.playerId })
    expect(shard.authorityCounts.restartGuards).toBe(1)
    expect(shard.requestAction(beforeContact.playerId, strike)).toEqual({ ok: false, code: 'action_cooldown' })
    expect(shard.character(beforeContact.playerId)).toMatchObject({ xp: 10, level: 2 })
    wallNow += 299
    expect(shard.requestAction(beforeContact.playerId, strike)).toEqual({ ok: false, code: 'action_cooldown' })
    wallNow += 1
    shard.advance(50)
    expect(shard.authorityCounts.restartGuards).toBe(0)
    expect(shard.requestAction(beforeContact.playerId, strike)).toEqual({ ok: true })
    shard.advance(350)
    expect(shard.character(beforeContact.playerId)).toMatchObject({ xp: 20, level: 3 })
    expect(shard.state.encounter.sentinel).toMatchObject({ interactions: 0, strikes: 1 })
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
