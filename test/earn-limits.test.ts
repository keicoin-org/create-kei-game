/**
 * The ceiling on minting in the generated game, held to being a ceiling.
 *
 * The thing this replaces called itself a cap and was not one, in a way no test
 * could have caught by running the game normally: it honoured 25 clicks a second
 * *of elapsed time since the wallet last asked*, banked forever. One request
 * after an idle hour was worth 90 025 clicks, and a keypair costs nothing, so a
 * fresh address collected the opening allowance again every time. Playing the
 * game never goes near either.
 *
 * So the limiter is tested as what it is — a token bucket — with the clock passed
 * in rather than read. That is the only way to state the property that matters
 * ("an idle wallet does not bank allowance") as an assertion rather than as a
 * comment, and it makes an hour of idling cost nothing to test.
 *
 * `admit` is imported from the *generated* project rather than from `templates/`,
 * because what ships is what comes out of the scaffolder.
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { MockNode, keyPairFromSeed, randomSeed, type KeiNode } from 'kei-transaction'

import { projectFrom } from '../src/naming.js'
import { scaffold } from '../src/scaffold.js'
import { writeFiles } from '../src/write.js'

interface EarnAdmission {
  clicks: number
  ceiling: 'none' | 'wallet' | 'process'
}

interface EarnLimiter {
  admit(address: string, clicks: number, now: number): EarnAdmission
  readonly remembered: number
}

interface EarnLimits {
  clicksPerSecond: number
  burstClicks: number
  unitsPerSecond: number
  burstUnits: number
  wallets: number
}

interface GeneratedGame {
  address: string
  earn(address: string, clicks: number, idempotencyKey?: string): Promise<unknown>
  close(): void
}

const directory = join(import.meta.dir, '..', '.generated', 'earn-limits')

let EARN_LIMITS: EarnLimits
let createEarnLimiter: (limits?: EarnLimits) => EarnLimiter
let startGame: (options: { seed: string; node: KeiNode; network: 'mock'; orders: string }) => Promise<GeneratedGame>

beforeAll(async () => {
  await rm(directory, { recursive: true, force: true })
  const project = projectFrom({ name: 'Star Clicker', currency: 'Gold Pieces' })
  await writeFiles(directory, await scaffold(project, { sdkVersion: '^0.3.0' }))

  const generated = (await import(pathToFileURL(join(directory, 'server', 'game.ts')).href)) as {
    EARN_LIMITS: EarnLimits
    createEarnLimiter: (limits?: EarnLimits) => EarnLimiter
    startGame: typeof startGame
  }
  EARN_LIMITS = generated.EARN_LIMITS
  createEarnLimiter = generated.createEarnLimiter
  startGame = generated.startGame
})

/**
 * Addresses that are real enough for `isAddress`, off one seed at successive
 * indices — which is the attack rather than a shortcut around it. Defeating a
 * per-wallet cap does not take a wallet each; it takes one seed and a loop, and
 * it needs no node, no funding and no network.
 */
async function addresses(count: number): Promise<string[]> {
  const seed = randomSeed()
  const made: string[] = []
  for (let index = 0; index < count; index++) made.push((await keyPairFromSeed(seed, index)).address)
  return made
}

describe('the per-wallet ceiling', () => {
  test('a burst cannot exceed the clicks one window is worth', async () => {
    const [wallet] = await addresses(1)
    const limiter = createEarnLimiter()

    // One request asking for far more than a window holds. The old arithmetic
    // answered `ceil(since/1000 × 25) + 25`; this answers the bucket's capacity.
    const first = limiter.admit(wallet as string, 100_000, 1_000_000)
    expect(first.clicks).toBe(EARN_LIMITS.burstClicks)
    expect(first.ceiling).not.toBe('none')

    // And it is empty afterwards, so the burst is a burst rather than a rate.
    expect(limiter.admit(wallet as string, 100_000, 1_000_000).clicks).toBe(0)
  })

  test('an idle hour banks one window, not an hour of windows', async () => {
    const [wallet] = await addresses(1)
    const limiter = createEarnLimiter()

    limiter.admit(wallet as string, EARN_LIMITS.burstClicks, 1_000_000)

    // The reproduction of #42, at the only scale where the two designs differ by
    // orders of magnitude. On the old code this request was worth
    // ceil(3600 × 25) + 25 = 90_025 clicks; a day's idling was worth 2_160_025.
    const afterAnHour = limiter.admit(wallet as string, 100_000, 1_000_000 + 3_600_000)
    expect(afterAnHour.clicks).toBe(EARN_LIMITS.burstClicks)
    expect(afterAnHour.clicks).toBeLessThan(90_025)

    const afterADay = limiter.admit(wallet as string, 100_000, 1_000_000 + 86_400_000)
    expect(afterADay.clicks).toBe(EARN_LIMITS.burstClicks)
  })

  test('it refills at the stated rate and no faster', async () => {
    const [wallet] = await addresses(1)
    const limiter = createEarnLimiter()

    limiter.admit(wallet as string, EARN_LIMITS.burstClicks, 0)

    // Both gaps are shorter than the bucket takes to fill, so these measure the
    // rate rather than the capacity clamp — which they would not if the gap were
    // long enough to top the bucket up, and that is the easy mistake here.
    expect(limiter.admit(wallet as string, 1_000, 1_000).clicks).toBe(EARN_LIMITS.clicksPerSecond)
    expect(limiter.admit(wallet as string, 1_000, 2_400).clicks).toBe(35)
  })

  test('refilling in small steps grants what one long wait grants', async () => {
    const [steady, waiting] = await addresses(2)
    const limiter = createEarnLimiter()

    limiter.admit(steady as string, EARN_LIMITS.burstClicks, 0)
    limiter.admit(waiting as string, EARN_LIMITS.burstClicks, 0)

    // 100ms is 2.5 clicks at 25/s, so every one of these refills divides with a
    // remainder. Dropping it would make a client that polls often earn less than
    // one that polls once, which is a limiter with a preference about clients.
    for (let step = 1; step <= 10; step++) limiter.admit(steady as string, 0, step * 100)

    // One second, and deliberately under the capacity, so what is being compared
    // is the accumulated remainder rather than two buckets that both filled up.
    const stepped = limiter.admit(steady as string, 1_000, 1_000)
    const waited = limiter.admit(waiting as string, 1_000, 1_000)
    expect(stepped.clicks).toBe(waited.clicks)
    expect(stepped.clicks).toBe(EARN_LIMITS.clicksPerSecond)
  })
})

describe('the per-process ceiling', () => {
  test('a fresh address does not reset it', async () => {
    // Sized so the process budget binds rather than the wallet buckets: fifty
    // wallets, each entitled to a full burst of its own, against a budget worth
    // fifty clicks in total.
    const limits: EarnLimits = {
      clicksPerSecond: 25,
      burstClicks: 100,
      unitsPerSecond: 1,
      burstUnits: 100,
      wallets: 4_096,
    }
    const limiter = createEarnLimiter(limits)
    const wallets = await addresses(50)

    let minted = 0
    for (const wallet of wallets) minted += limiter.admit(wallet, limits.burstClicks, 5_000).clicks

    // Every one of those had a full bucket and none had ever been seen before,
    // which is the whole attack. Against a per-wallet cap alone this mints
    // 50 × 100 = 5 000 clicks; the process budget pays for 50 of them.
    expect(minted).toBe(limits.burstUnits / 2)
    expect(minted).toBeLessThan(limits.burstClicks * wallets.length)

    // And the next new address is refused outright rather than merely slowed —
    // a fresh keypair buys nothing at all here.
    const [newcomer] = await addresses(1)
    expect(limiter.admit(newcomer as string, 100, 5_000)).toEqual({ clicks: 0, ceiling: 'process' })
  }, 60_000)

  test('it refuses with a sentence saying which ceiling was hit', async () => {
    const limits: EarnLimits = {
      clicksPerSecond: 25,
      burstClicks: 100,
      unitsPerSecond: 1,
      burstUnits: 1,
      wallets: 16,
    }
    const limiter = createEarnLimiter(limits)
    const [wallet, other] = await addresses(2)

    limiter.admit(wallet as string, 100, 10_000)
    // A wallet that has spent nothing, refused by the budget rather than by its
    // own bucket — so the message the player sees can say which it was.
    expect(limiter.admit(other as string, 100, 10_000)).toEqual({ clicks: 0, ceiling: 'process' })
  })

  test('clicks the budget would not pay for are not charged to the wallet', async () => {
    // `clicksPerSecond: 1` so the wallet refills by nothing over the handful of
    // milliseconds below, and every click paid out has to be one of the hundred
    // it started with. The budget refills instantly and holds 20 units, which at
    // the worst-case 2 units a click is 10 clicks a call.
    const limits: EarnLimits = {
      clicksPerSecond: 1,
      burstClicks: 100,
      unitsPerSecond: 1_000_000,
      burstUnits: 20,
      wallets: 16,
    }
    const limiter = createEarnLimiter(limits)
    const [wallet] = await addresses(1)

    const first = limiter.admit(wallet as string, 100, 0)
    expect(first).toEqual({ clicks: 10, ceiling: 'process' })

    // The 90 the budget would not pay for were never minted, so they were never
    // charged either: the wallet's hundred are all paid in the end, ten at a
    // time. Charging them would have thrown 90 of a player's clicks away to a
    // ceiling that has nothing to do with them.
    let paid = first.clicks
    for (let call = 1; call < 10; call++) paid += limiter.admit(wallet as string, 100, call).clicks
    expect(paid).toBe(100)

    // And now the wallet really is empty, which is the other half of the claim:
    // the clicks came back, they were not conjured.
    expect(limiter.admit(wallet as string, 100, 10)).toEqual({ clicks: 0, ceiling: 'wallet' })
  })
})

describe('what it remembers', () => {
  test('the wallet map stays inside its bound across 10 000 addresses', async () => {
    const limits: EarnLimits = {
      clicksPerSecond: 25,
      burstClicks: 100,
      unitsPerSecond: 1_000_000,
      burstUnits: 1_000_000,
      wallets: 512,
    }
    const limiter = createEarnLimiter(limits)

    // Synthetic strings rather than 10 000 keypairs: `admit` is being measured
    // for what it retains, and `earn` is where an address has to be an address.
    for (let index = 0; index < 10_000; index++) {
      limiter.admit(`wallet-${index}`, 1, 1_000_000 + index)
      expect(limiter.remembered).toBeLessThanOrEqual(limits.wallets)
    }
    expect(limiter.remembered).toBe(limits.wallets)
  })

  test('a wallet still asking is not evicted by wallets that have stopped', async () => {
    const limits: EarnLimits = {
      clicksPerSecond: 25,
      burstClicks: 100,
      unitsPerSecond: 1_000_000,
      burstUnits: 1_000_000,
      wallets: 8,
    }
    const limiter = createEarnLimiter(limits)
    const [regular] = await addresses(1)

    limiter.admit(regular as string, limits.burstClicks, 0)
    for (let index = 0; index < 100; index++) {
      limiter.admit(`stranger-${index}`, 1, 1_000)
      // Touched on every pass, so it is never the least recently used.
      limiter.admit(regular as string, 0, 1_000)
    }

    // Its bucket survived, so it is still spent: an evicted wallet would come
    // back with a full one.
    expect(limiter.admit(regular as string, limits.burstClicks, 1_000).clicks).toBeLessThan(limits.burstClicks)
  })

  test('a limit set to nonsense is refused rather than dividing by zero', () => {
    expect(() =>
      createEarnLimiter({ clicksPerSecond: 0, burstClicks: 100, unitsPerSecond: 10, burstUnits: 10, wallets: 8 }),
    ).toThrow('clicksPerSecond')
  })
})

describe('what earn() accepts', () => {
  let game: GeneratedGame
  let player: string

  beforeAll(async () => {
    const node = await MockNode.create()
    game = await startGame({
      seed: randomSeed(),
      node,
      network: 'mock',
      orders: join(directory, '.kei', 'orders.ndjson'),
    })
    player = (await keyPairFromSeed(randomSeed())).address
  })

  test('a burst is bounded by the window, not by how long the game has been up', async () => {
    // Through the real `earn` and onto the real chain, so the clamp is not only
    // a property of the limiter in isolation. The entitlement says what was
    // actually minted, in raw units — this player holds no lantern, so a click
    // is worth one unit and the amount *is* the honoured click count.
    const bundle = (await game.earn(player, 100_000, `burst-${crypto.randomUUID()}`)) as { amount: string }
    const honoured = BigInt(bundle.amount)

    // The number to beat is 90 025: what the arithmetic this replaces honoured
    // for one request from a wallet that had been idle an hour. Nothing about
    // how long this process has been running is allowed to raise this.
    expect(honoured).toBeLessThanOrEqual(BigInt(EARN_LIMITS.burstClicks))
    expect(honoured).toBeGreaterThan(0n)
  }, 60_000)

  test('an address the caller made up is refused, naming what was sent', async () => {
    await expect(game.earn('not-an-address', 5)).rejects.toThrow(/earn\(\) takes the Kei address/)
    await expect(game.earn('not-an-address', 5)).rejects.toThrow(/"not-an-address"/)
  })

  test('a click count that is not a whole positive number names the value given', async () => {
    for (const clicks of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      // `Infinity` is the one that mattered: `Math.floor(Infinity)` survived
      // `Math.min(clicks, allowed)` as `allowed`, so it minted the whole window.
      await expect(game.earn(player, clicks)).rejects.toThrow(
        `earn() takes a whole number of clicks, one or more — got ${String(clicks)}.`,
      )
    }
  })
})
