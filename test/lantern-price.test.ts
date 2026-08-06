/**
 * A payment for the wrong amount, on either side of the price.
 *
 * The happy path — pay exactly, get the lantern — is `purchase.test.ts`'s. This
 * is the two ways a payment can miss: sent short, or sent over. Short was
 * already refused before this file existed; over used to be quietly kept, with
 * the lantern delivered anyway and the difference left in the issuer's balance,
 * attributed to nothing. Both wrong amounts now come back the same way an
 * unmatched payment already did — untouched, in full, with a reason — because
 * the alternative to giving it back is a refusal that leaves the buyer's Kei
 * stranded at the issuer forever, which is the exact failure `orders.ts` exists
 * to prevent.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Kei, MockNode, randomSeed, type KeiNode } from 'kei-transaction'

import { projectFrom } from '../src/naming.js'
import { scaffold } from '../src/scaffold.js'
import { writeFiles } from '../src/write.js'

type LanternOutcome =
  | { outcome: 'delivered'; item: string }
  | { outcome: 'refunded'; amount: number; reason: string }

interface GeneratedGame {
  address: string
  catalogue(): { issuer: string; lantern: { asset: string; price: number } }
  buyLantern(address: string, hash: string): Promise<LanternOutcome>
  close(): void
}

const directory = join(import.meta.dir, '..', '.generated', 'lantern-price')

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

async function wallet(units: number): Promise<Kei> {
  const kei = await Kei.start({ node, network: 'mock', seed: randomSeed() })
  await kei.faucet(units)
  return kei
}

async function lanterns(kei: Kei): Promise<number> {
  const summary = await kei.wallet.summary()
  return summary.items.find((item) => item.asset === asset)?.count ?? 0
}

async function keiBalance(kei: Kei): Promise<number> {
  const summary = await kei.wallet.summary()
  return summary.kei
}

describe('a payment for the wrong amount', () => {
  test('too little is refused, and nothing is delivered', async () => {
    const buyer = await wallet(1)
    const short = price / 2
    const receipt = await buyer.pay({ to: game.address, amount: short })

    await expect(game.buyLantern(buyer.address, receipt.hash)).rejects.toThrow(
      new RegExp(`costs ${price.toString().replace('.', '\\.')}`),
    )
    expect(await lanterns(buyer)).toBe(0)
  })

  test('too much is refunded in full, and nothing is delivered', async () => {
    const buyer = await wallet(1)
    const over = price * 2
    const before = await keiBalance(buyer)
    const receipt = await buyer.pay({ to: game.address, amount: over })

    const outcome = await game.buyLantern(buyer.address, receipt.hash)

    expect(outcome).toEqual({
      outcome: 'refunded',
      amount: over,
      reason: expect.stringContaining(`costs ${price} Kei exactly`) as unknown as string,
    })
    expect(await lanterns(buyer)).toBe(0)
    // Paid `over`, got `over` back: only network cost separates the balance
    // before and after, not the price of a lantern that was never delivered.
    expect(await keiBalance(buyer)).toBeCloseTo(before, 6)
  })

  test('reposting the same overpaid hash returns the same recorded refund', async () => {
    const buyer = await wallet(1)
    const over = price * 3
    const receipt = await buyer.pay({ to: game.address, amount: over })

    const first = await game.buyLantern(buyer.address, receipt.hash)
    const second = await game.buyLantern(buyer.address, receipt.hash)

    expect(second).toEqual(first)
    expect(await lanterns(buyer)).toBe(0)
  })
})
