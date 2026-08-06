/**
 * Who a payment buys for, when two posts about it overlap in time.
 *
 * A payment hash is not a secret. It is the `link` of a send on the issuer's
 * public chain, and `server/orders.ts` reads other people's hashes off that
 * chain itself — `catchUp()` walks `accountHistory(issuer)` for exactly these
 * blocks. So anybody watching the issuer's account history holds every hash
 * moments after it confirms, and any design that treats one as a bearer token
 * is handing out other people's purchases.
 *
 * The binding that makes this safe already exists and is the payment's own
 * signature: `deliver` refuses when `payment.from !== address`, and the item is
 * minted to that address, so the only wallet that can ever receive the lantern
 * is the wallet that signed the send. Nothing else here proves anything, and
 * nothing else needs to.
 *
 * What this file is about is the one path that used to skip that check. The
 * in-flight coalescing map exists so that two tabs of the same player posting at
 * the same moment are one delivery rather than two; keyed on the hash alone, it
 * also made a *stranger* posting at the same moment the same request.
 *
 * The race is not timing-dependent and is not simulated. `buyLantern` runs
 * synchronously as far as `inFlight.set` — `deliver`'s first statement is an
 * `await` — so calling it twice in a row without awaiting in between is exactly
 * the overlap the map is for, every time.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Kei, MockNode, randomSeed, type KeiNode } from 'kei-transaction'

import { projectFrom } from '../src/naming.js'
import { scaffold } from '../src/scaffold.js'
import { writeFiles } from '../src/write.js'

/**
 * What the generated `server/game.ts` returns. Spelled out here rather than
 * imported from `templates/shared/game.ts`, which still has its placeholders in
 * and cannot be evaluated until it has been written out.
 */
type LanternOutcome =
  | { outcome: 'delivered'; item: string }
  | { outcome: 'refunded'; amount: number; reason: string }

interface GeneratedGame {
  address: string
  catalogue(): { issuer: string; lantern: { asset: string; price: number } }
  buyLantern(address: string, hash: string): Promise<LanternOutcome>
  close(): void
}

const directory = join(import.meta.dir, '..', '.generated', 'lantern-binding')

let node: MockNode
let game: GeneratedGame
let asset: string
let price: number

beforeAll(async () => {
  await rm(directory, { recursive: true, force: true })
  const project = projectFrom({ name: 'Star Clicker', currency: 'Gold Pieces' })
  await writeFiles(directory, await scaffold(project, { sdkVersion: '^0.8.0' }))

  node = await MockNode.create()
  const { startGame } = (await import(pathToFileURL(join(directory, 'server', 'game.ts')).href)) as {
    startGame(options: { seed: string; node: KeiNode; network: 'mock'; orders: string }): Promise<GeneratedGame>
  }
  game = await startGame({
    seed: randomSeed(),
    node,
    network: 'mock',
    orders: join(directory, '.kei', 'orders.ndjson'),
  })
  const { lantern } = game.catalogue()
  asset = lantern.asset
  price = lantern.price
})

afterAll(async () => {
  game?.close()
  await rm(directory, { recursive: true, force: true })
})

/** A wallet with enough Kei to buy the lantern. */
async function wallet(): Promise<Kei> {
  const kei = await Kei.start({ node, network: 'mock', seed: randomSeed() })
  await kei.faucet(1)
  return kei
}

/**
 * How many lanterns a wallet is actually holding, read off the chain by the
 * wallet itself — `items.token()` is issuer-only, and the question here is what
 * the player can see in any wallet, not what the game believes it sent.
 */
async function lanterns(kei: Kei): Promise<number> {
  const summary = await kei.wallet.summary()
  return summary.items.find((item) => item.asset === asset)?.count ?? 0
}

/** The payment a buyer makes, and the hash a stranger can read off the chain. */
async function payFor(buyer: Kei): Promise<string> {
  const receipt = await buyer.pay({ to: game.address, amount: price })
  return receipt.hash
}

function refusal(settled: PromiseSettledResult<LanternOutcome>): string {
  if (settled.status === 'fulfilled') {
    throw new Error(`Expected a refusal and got ${JSON.stringify(settled.value)}.`)
  }
  return settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
}

describe('a payment buys for the wallet that signed it, even when two posts overlap', () => {
  test('a stranger who posts second is not handed the payer’s delivery', async () => {
    const payer = await wallet()
    const stranger = await wallet()
    const hash = await payFor(payer)

    // Both posts are made before either is awaited, so the second one lands
    // inside the window the first one opened. This is the theft: the stranger
    // has proved nothing about `hash` beyond having read it off a public chain.
    const theirs = game.buyLantern(payer.address, hash)
    const strangers = game.buyLantern(stranger.address, hash)
    const [mine, yours] = await Promise.allSettled([theirs, strangers])

    expect(mine).toEqual({ status: 'fulfilled', value: { outcome: 'delivered', item: asset } })
    expect(refusal(yours)).toMatch(/signed by a different wallet/)

    expect(await lanterns(payer)).toBe(1)
    expect(await lanterns(stranger)).toBe(0)
  })

  test('a stranger who posts first cannot hold the payer’s delivery hostage', async () => {
    const payer = await wallet()
    const stranger = await wallet()
    const hash = await payFor(payer)

    // The worse direction. The stranger polls the chain and posts the instant
    // the send confirms; the payer's own post then arrives second. The payer
    // must still be delivered to, and must not be told their own payment was
    // signed by somebody else.
    const strangers = game.buyLantern(stranger.address, hash)
    const theirs = game.buyLantern(payer.address, hash)
    const [yours, mine] = await Promise.allSettled([strangers, theirs])

    expect(refusal(yours)).toMatch(/signed by a different wallet/)
    expect(mine).toEqual({ status: 'fulfilled', value: { outcome: 'delivered', item: asset } })

    expect(await lanterns(payer)).toBe(1)
    expect(await lanterns(stranger)).toBe(0)
  })

  test('and repeating the race does not wear the payer down', async () => {
    const payer = await wallet()
    const stranger = await wallet()
    const hash = await payFor(payer)

    // A failure is deliberately not remembered, so the stranger can keep trying.
    // Losing once must not be losing at all.
    for (let attempt = 0; attempt < 3; attempt++) {
      const settled = await Promise.allSettled([game.buyLantern(stranger.address, hash)])
      expect(refusal(settled[0]!)).toMatch(/signed by a different wallet/)
    }

    expect(await game.buyLantern(payer.address, hash)).toEqual({ outcome: 'delivered', item: asset })
    expect(await lanterns(payer)).toBe(1)
    expect(await lanterns(stranger)).toBe(0)
  })

  test('two tabs of the same player are still one delivery', async () => {
    const payer = await wallet()
    const hash = await payFor(payer)

    // What the map is for, and what the fix must not cost. Both tabs are told
    // the same thing and the wallet holds one lantern, not two.
    const first = game.buyLantern(payer.address, hash)
    const second = game.buyLantern(payer.address, hash)
    const [one, two] = await Promise.all([first, second])

    expect(one).toEqual({ outcome: 'delivered', item: asset })
    expect(two).toEqual(one)
    expect(await lanterns(payer)).toBe(1)
  })

  test('an address that is not an address is refused before anything is looked up', async () => {
    const payer = await wallet()
    const hash = await payFor(payer)

    // `server/main.ts` hands `buyLantern` whatever JSON parsed, so this is not a
    // type error the compiler catches. It reached the map as a key before it
    // reached anything that could reject it.
    await expect(game.buyLantern({ toString: () => payer.address } as unknown as string, hash)).rejects.toThrow(
      /Kei address/,
    )
    expect(await lanterns(payer)).toBe(0)
  })
})
