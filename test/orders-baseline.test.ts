/**
 * A game that has lost its purchase log, and the one way back out.
 *
 * `dev-orders.test.ts` pins the shape of the line in `server/main.ts` that used
 * to cause this. This is the other half: what the loss actually does to a
 * deployment, and what `adoptChainAsBaseline` does about it — asserted by
 * running the generated game rather than by reading it.
 *
 * The mock hides all of this, which is why it survived development. Its chain
 * dies with the process, so deleting the log beside it is free. A `MockNode`
 * held across two boots is exactly the thing the mock is not — a chain that
 * outlives the process — and it stages the production path without a testnet.
 *
 * The payment each refusal is measured on is a **new** one, and that is the
 * point rather than an incidental. A repost of a payment made before the loss is
 * refused for a good reason and always will be. A wallet that pays again, having
 * never been answered wrongly, being refused for ever is the damage: the chain's
 * count of answers only grows and this file's restarts at zero, so nothing about
 * waiting fixes it.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
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

interface Boot {
  seed: string
  node: KeiNode
  network: 'mock'
  orders: string
  adoptChainAsBaseline?: boolean
}

const directory = join(import.meta.dir, '..', '.generated', 'orders-baseline')

let startGame: (options: Boot) => Promise<GeneratedGame>

beforeAll(async () => {
  await rm(directory, { recursive: true, force: true })
  const project = projectFrom({ name: 'Star Clicker', currency: 'Gold Pieces' })
  await writeFiles(directory, await scaffold(project, { sdkVersion: '^0.3.0' }))
  ;({ startGame } = (await import(pathToFileURL(join(directory, 'server', 'game.ts')).href)) as {
    startGame: (options: Boot) => Promise<GeneratedGame>
  })
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

interface Deployment {
  orders: string
  node: MockNode
  boot(options?: { adopt?: boolean }): Promise<GeneratedGame>
}

/**
 * One game that can be stopped and started: one seed, one node, one path.
 *
 * The seed is fixed because `GAME_SEED` is what the template recommends in the
 * same breath as the migration, and a fresh issuer every boot hides every one of
 * these failures — which is exactly why they reach production instead of being
 * caught in development.
 */
async function deployment(name: string): Promise<Deployment> {
  const seed = randomSeed()
  const orders = join(directory, '.kei', `${name}.ndjson`)
  const node = await MockNode.create()
  return {
    orders,
    node,
    boot: (options = {}) => startGame({ seed, node, network: 'mock', orders, adoptChainAsBaseline: options.adopt }),
  }
}

async function player(node: KeiNode): Promise<Kei> {
  const kei = await Kei.start({ node, network: 'mock', seed: randomSeed() })
  await kei.faucet(1)
  return kei
}

/** Pay the issuer the price of a lantern, and hand back the hash the player holds. */
async function pay(kei: Kei, game: GeneratedGame): Promise<string> {
  const catalogue = game.catalogue()
  const receipt = await kei.pay({ to: catalogue.issuer, amount: catalogue.lantern.price })
  return receipt.hash
}

const baselines = (path: string): Array<{ adopted: Array<[string, number]> }> =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { k: string; adopted: Array<[string, number]> })
    .filter((entry) => entry.k === 'baseline')

describe('a purchase log lost against a chain that outlived it', () => {
  test(
    'a wallet that bought once is refused on a payment it makes afterwards',
    async () => {
      const game = await deployment('lost')
      const first = await game.boot()
      const kei = await player(game.node)

      try {
        expect(await first.buyLantern(kei.address, await pay(kei, first))).toMatchObject({ outcome: 'delivered' })
        first.close()

        // What `bun run dev` did on every start before #64, against a chain that
        // is still here. Nothing else about the deployment changes.
        await rm(game.orders, { force: true })

        const second = await game.boot()
        try {
          // Never seen by this game, made after the loss, and refused: the wallet
          // has an answer on the chain that is not on file, so any of its hashes
          // could be the one the missing entry named.
          await expect(second.buyLantern(kei.address, await pay(kei, second))).rejects.toThrow(
            /no longer has the record of which/,
          )
        } finally {
          second.close()
        }
      } finally {
        kei.close()
      }
    },
    120_000,
  )

  test(
    'adopting the chain as a baseline serves that wallet again, once and on the disk',
    async () => {
      const game = await deployment('adopted')
      const first = await game.boot()
      const kei = await player(game.node)

      try {
        expect(await first.buyLantern(kei.address, await pay(kei, first))).toMatchObject({ outcome: 'delivered' })
        first.close()
        await rm(game.orders, { force: true })

        // The one boot that forgives what the chain shows and the file does not.
        // A refund rather than a delivery because the player still holds the
        // lantern they bought — the game is answering, which is the point.
        const second = await game.boot({ adopt: true })
        try {
          expect(await second.buyLantern(kei.address, await pay(kei, second))).toMatchObject({ outcome: 'refunded' })
        } finally {
          second.close()
        }

        // Written down rather than remembered, which is what makes the flag a
        // one-boot decision and not a mode.
        const adopted = baselines(game.orders)
        expect(adopted).toHaveLength(1)
        expect(adopted[0]?.adopted).toEqual([[kei.address, 1]])

        const third = await game.boot()
        try {
          expect(await third.buyLantern(kei.address, await pay(kei, third))).toMatchObject({ outcome: 'refunded' })
        } finally {
          third.close()
        }

        // And a boot that adopts with nothing left to adopt writes no second
        // line. A flag left in by accident has to be inert, or it would grow the
        // file for ever and forgive a *future* loss without anybody looking.
        const fourth = await game.boot({ adopt: true })
        fourth.close()
        expect(baselines(game.orders)).toHaveLength(1)
      } finally {
        kei.close()
      }
    },
    120_000,
  )

  test(
    'a game whose records are intact adopts nothing, flag or no flag',
    async () => {
      const game = await deployment('intact')
      const first = await game.boot()
      const kei = await player(game.node)

      try {
        expect(await first.buyLantern(kei.address, await pay(kei, first))).toMatchObject({ outcome: 'delivered' })
        first.close()

        // Nothing is deleted, so there is no shortfall. Forgiving anything here
        // would forgive an answer that is on file, and that answer's payment
        // could then be answered a second time — the flag has to be a no-op.
        const second = await game.boot({ adopt: true })
        try {
          expect(baselines(game.orders)).toHaveLength(0)
          expect(await second.buyLantern(kei.address, await pay(kei, second))).toMatchObject({ outcome: 'refunded' })
        } finally {
          second.close()
        }
      } finally {
        kei.close()
      }
    },
    120_000,
  )
})
