/**
 * What the game mints when the connection is unreliable.
 *
 * The bug this is about cannot be caught by failing a request. Failing one
 * outright leaves nothing minted, so putting the clicks back is correct — which
 * is why the code read as correct. The case that mints twice is the one where the
 * request *succeeds* and the browser never finds out: the game has committed, the
 * browser sees a timeout, and if it treats that as "nothing was minted" it asks
 * to be paid for the same clicks all over again.
 *
 * So `fetch` here does not fail the request. It lets it reach the game, waits for
 * the game to answer, and then throws the answer away. That is a timeout as a
 * browser experiences one, and it is the only shape of failure that tells the two
 * designs apart.
 *
 * What is measured is what the **game committed**, not what the player's balance
 * says. Those are different numbers here on purpose: a bundle whose response was
 * swallowed is never claimed, so the coins in the wallet understate the mint, and
 * a test watching the balance would call an over-mint a shortfall. `minted()`
 * sums one entry per idempotency key, so a replay of a key counts once and a
 * second key for the same clicks counts twice — which is exactly the defect.
 *
 * No lantern is bought anywhere in this file, so a click is worth one unit and
 * the mint total is directly comparable to the click count.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { MockNode, mockRpcHandler, randomSeed, type KeiNode } from 'kei-transaction'

import { projectFrom } from '../src/naming.js'
import { scaffold } from '../src/scaffold.js'
import { writeFiles } from '../src/write.js'
import { type EarnOrder } from '../templates/shared/game.js'

interface GeneratedGame {
  address: string
  catalogue(): unknown
  earn(address: string, clicks: number, idempotencyKey?: string): Promise<{ amount: string }>
  close(): void
}

interface GeneratedEconomy {
  state: { online: boolean; coins: number; unsaved: number; saving: boolean; message: string | null }
  click(): void
  close(): void
}

const directory = join(import.meta.dir, '..', '.generated', 'earn-retry')

let game: GeneratedGame
let server: ReturnType<typeof Bun.serve>
let origin: string
let connect: () => Promise<GeneratedEconomy>

/** How many more `/game/earn` answers to swallow after the game has given them. */
let swallow = 0
/** Every `/game/earn` the game answered, one entry per key: key to units minted. */
let committed = new Map<string, bigint>()
/** Every order the game received, replays included. */
let received: EarnOrder[] = []

const realFetch = globalThis.fetch
const realLocation = (globalThis as { location?: unknown }).location
/** The shared stub. A test that installs its own must put this one back. */
let harnessFetch: typeof fetch

/** What the game has minted, counting each idempotency key once. */
const minted = (): bigint => [...committed.values()].reduce((sum, units) => sum + units, 0n)

beforeAll(async () => {
  await rm(directory, { recursive: true, force: true })
  const project = projectFrom({ name: 'Star Clicker', currency: 'Gold Pieces' })
  await writeFiles(directory, await scaffold(project, { sdkVersion: '^0.3.0' }))

  const node = await MockNode.create()
  const started = (await import(pathToFileURL(join(directory, 'server', 'game.ts')).href)) as {
    startGame(options: { seed: string; node: KeiNode; network: 'mock'; orders: string }): Promise<GeneratedGame>
  }
  game = await started.startGame({
    seed: randomSeed(),
    node,
    network: 'mock',
    orders: join(directory, '.kei', 'orders.ndjson'),
  })

  const rpc = mockRpcHandler({ node })
  const json = (body: unknown, status = 200): Response => Response.json(body, { status })

  server = Bun.serve({
    port: 0,
    routes: {
      '/rpc': { POST: rpc, OPTIONS: rpc },
      '/game/catalogue': () => json(game.catalogue()),
      '/game/earn': {
        async POST(request) {
          const order = (await request.json()) as EarnOrder
          received.push(order)
          try {
            const bundle = await game.earn(order.address, order.clicks, order.idempotencyKey)
            // One entry per key. A replay overwrites its own entry with the same
            // value; a new key adds one, which is what an over-mint looks like.
            committed.set(order.idempotencyKey ?? `no-key-${received.length}`, BigInt(bundle.amount))
            return json({ bundle })
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 400)
          }
        },
      },
    },
  })
  origin = server.url.origin
  ;(globalThis as { location?: unknown }).location = { origin }

  harnessFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = typeof input === 'string' ? input : String(input)
    const response = await realFetch(path.startsWith('/') ? `${origin}${path}` : input, init)

    if (path.includes('/game/earn') && swallow > 0) {
      swallow--
      // Drained first, so the game has certainly finished answering — and has
      // certainly committed — before the browser is told the request failed.
      await response.arrayBuffer()
      throw new TypeError('Failed to fetch')
    }
    return response
  }) as typeof fetch
  globalThis.fetch = harnessFetch

  connect = (
    (await import(pathToFileURL(join(directory, 'src', 'economy.ts')).href)) as {
      connect: () => Promise<GeneratedEconomy>
    }
  ).connect
})

afterEach(() => {
  swallow = 0
  committed = new Map()
  received = []
})

afterAll(async () => {
  globalThis.fetch = realFetch
  if (realLocation === undefined) delete (globalThis as { location?: unknown }).location
  else (globalThis as { location?: unknown }).location = realLocation

  game?.close()
  await server?.stop(true)
  await rm(directory, { recursive: true, force: true })
})

async function until(what: () => string, ready: () => boolean, ms = 60_000): Promise<void> {
  const deadline = Date.now() + ms
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what()}.`)
    await Bun.sleep(50)
  }
}

/**
 * Click, then keep clicking slowly for a while, then wait for quiet.
 *
 * The trickle is what the old code needs to show its defect: it never retries on
 * its own, so without a later flush to carry the restored copy out under a fresh
 * key the batch simply strands and nothing is minted twice. The new code retries
 * on a timer and the trickle makes no difference to it. Either way the count
 * returned is the number of clicks a player actually made.
 */
async function play(economy: GeneratedEconomy, burst: number, trickle: number): Promise<number> {
  let clicks = 0
  for (let click = 0; click < burst; click++) {
    economy.click()
    clicks++
  }
  for (let click = 0; click < trickle; click++) {
    await Bun.sleep(750)
    economy.click()
    clicks++
  }
  await until(
    () => `every click to be settled (unsaved ${economy.state.unsaved}, minted ${minted()}, made ${clicks})`,
    () => economy.state.unsaved === 0 && !economy.state.saving,
  )
  return clicks
}

describe('the game mints once per click, however the connection behaves', () => {
  test(
    'clicks whose answers were swallowed are minted once, not once per attempt',
    async () => {
      const economy = await connect()
      try {
        expect(economy.state.online).toBe(true)

        // The headline of #53. Before this fix the restored copy went out under a
        // fresh key while the original was still queued, so the same clicks were
        // paid for under both and one flaky connection minted several times over.
        swallow = 3
        const clicks = await play(economy, 20, 24)

        expect(minted()).toBe(BigInt(clicks))

        // And the mechanism, not just the total: the first batch was asked for
        // more than once, and every one of those asks quoted the same key.
        const replays = received.filter((order) => order.idempotencyKey === received[0]?.idempotencyKey)
        expect(replays.length).toBeGreaterThan(1)
        for (const replay of replays) expect(replay.clicks).toBe(20)
      } finally {
        economy.close()
      }
    },
    180_000,
  )

  test(
    'a batch the game refuses is minted once, under one key or the other',
    async () => {
      const economy = await connect()
      try {
        // A 4xx is the one answer that is evidence: the game refuses before it
        // commits anything, so these clicks are genuinely still owed. What must
        // not happen is that they are owed *and* still queued.
        let refusals = 1
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const path = typeof input === 'string' ? input : String(input)
          if (path.includes('/game/earn') && refusals > 0) {
            refusals--
            return Response.json({ error: 'That was refused on purpose.' }, { status: 400 })
          }
          return harnessFetch(input, init)
        }) as typeof fetch

        const clicks = await play(economy, 20, 8)
        expect(minted()).toBe(BigInt(clicks))
      } finally {
        globalThis.fetch = harnessFetch
        economy.close()
      }
    },
    180_000,
  )

  test(
    'clicks made while a batch is outstanding are not folded into it',
    async () => {
      const economy = await connect()
      try {
        swallow = 1
        for (let click = 0; click < 20; click++) economy.click()
        await until(() => 'the first batch to be sent', () => received.length > 0)

        // These have never been sent, so they must not travel under the
        // outstanding batch's key — and that batch must not be re-keyed to carry
        // them. Either mistake shows up as a key whose count is not 20.
        const clicks = 20 + (await play(economy, 20, 8))
        expect(minted()).toBe(BigInt(clicks))
        for (const order of received) expect(order.clicks).toBeLessThanOrEqual(clicks)

        // Every key the game saw carried a count it was created with, and no key
        // was ever asked to pay for a different number of clicks than another
        // attempt under the same key.
        const counts = new Map<string, Set<number>>()
        for (const order of received) {
          const key = order.idempotencyKey ?? 'none'
          counts.set(key, (counts.get(key) ?? new Set()).add(order.clicks))
        }
        for (const [, seen] of counts) expect(seen.size).toBe(1)
      } finally {
        economy.close()
      }
    },
    180_000,
  )

  test(
    'the number shown to the player counts sent and unsent clicks exactly once',
    async () => {
      const economy = await connect()
      try {
        // This one guards the fix rather than catching the bug — it passes on the
        // old code too, because there `state.unsaved` was the restored copy and
        // read correctly while the duplicate hid in the queued order. It is here
        // because splitting the count into two variables introduces the opposite
        // risk: a derived total that counts a sent batch twice, or forgets it.
        swallow = 99
        for (let click = 0; click < 20; click++) economy.click()
        await until(
          () => `the batch to go out and fail (unsaved ${economy.state.unsaved})`,
          () => received.length > 0 && !economy.state.saving,
        )

        expect(economy.state.unsaved).toBe(20)

        for (let click = 0; click < 5; click++) economy.click()
        expect(economy.state.unsaved).toBe(25)
      } finally {
        economy.close()
      }
    },
    180_000,
  )
})
