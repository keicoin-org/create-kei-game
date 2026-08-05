/**
 * The orders file against a chain that outlives the process.
 *
 * `restart.test.ts` restarts the game with its records intact, which is the case
 * that works. This one is about the case where they are gone, because that is
 * the case `bun run dev` used to create on purpose: it deleted the write-ahead
 * log on every start, and the migration section of the template's README told a
 * developer to swap the node and change nothing else.
 *
 * The two together are the whole defect. On the mock the deletion is free — the
 * chain went with the process, so last run's answers are about payments that no
 * longer exist. Against a chain that persists it is not free and it is not
 * recoverable by waiting: the issuer's blocks still count every lantern minted,
 * this file's count restarts at zero, and `attributable()` refuses every wallet
 * it had records for on that purchase and on every purchase they ever make
 * afterwards. The chain's count only grows.
 *
 * A `MockNode` held across two boots is exactly a chain that outlives the
 * process, so it stages this without a testnet. What makes it a *test* of the
 * bug rather than of `attributable` is that the second payment is a **new** one.
 * A repost of the first would be refused for a good reason. A wallet that pays
 * again, having never been answered wrongly, being refused for ever is the
 * damage.
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

const directory = join(import.meta.dir, '..', '.generated', 'dev-orders')

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

/**
 * One game that can be stopped and started: one seed, one node, one path.
 *
 * The seed is fixed because that is what `GAME_SEED` is for and what the README
 * recommends in the same breath as the migration — a fresh issuer every boot
 * hides all of this, which is exactly why it survived development.
 */
async function deployment(name: string): Promise<{
  orders: string
  node: MockNode
  boot(options?: { adopt?: boolean }): Promise<GeneratedGame>
}> {
  const seed = randomSeed()
  const orders = join(directory, '.kei', `${name}.ndjson`)
  const node = await MockNode.create()
  return {
    orders,
    node,
    boot: (options = {}) =>
      startGame({ seed, node, network: 'mock', orders, adoptChainAsBaseline: options.adopt }),
  }
}

async function player(node: KeiNode): Promise<Kei> {
  const kei = await Kei.start({ node, network: 'mock', seed: randomSeed() })
  await kei.faucet(1)
  return kei
}

/** Pay the issuer the price of a lantern and hand back the hash the player holds. */
async function pay(kei: Kei, game: GeneratedGame): Promise<string> {
  const catalogue = game.catalogue()
  const receipt = await kei.pay({ to: catalogue.issuer, amount: catalogue.lantern.price })
  return receipt.hash
}

const lines = (path: string): Array<{ k: string; adopted?: Array<[string, number]> }> =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { k: string })

// --------------------------------------------------------------- the regression

describe('a chain that outlives the process', () => {
  test(
    'a wallet that bought once is refused for ever after its records are deleted',
    async () => {
      const game = await deployment('lost')
      const first = await game.boot()
      const kei = await player(game.node)

      try {
        expect(await first.buyLantern(kei.address, await pay(kei, first))).toMatchObject({ outcome: 'delivered' })
        first.close()

        // What `bun run dev` used to do on every start, against a chain that is
        // still here. Nothing else about the deployment changes.
        await rm(game.orders, { force: true })

        const second = await game.boot()
        try {
          // A payment this game has never seen, from a wallet whose answer is on
          // the chain and not on file. It is owed a refund — it already holds a
          // lantern — and it cannot be given one, because a wallet with a missing
          // record could be owed either answer and there is no way to tell which.
          const refused = second.buyLantern(kei.address, await pay(kei, second))
          await expect(refused).rejects.toThrow(/no longer has the record of which/)
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
        const second = await game.boot({ adopt: true })
        try {
          expect(await second.buyLantern(kei.address, await pay(kei, second))).toMatchObject({ outcome: 'refunded' })
        } finally {
          second.close()
        }

        // Written down rather than remembered, so the flag is for one boot.
        const adopted = lines(game.orders).filter((entry) => entry.k === 'baseline')
        expect(adopted).toHaveLength(1)
        expect(adopted[0]?.adopted).toEqual([[kei.address, 1]])

        const third = await game.boot()
        try {
          expect(await third.buyLantern(kei.address, await pay(kei, third))).toMatchObject({ outcome: 'refunded' })
        } finally {
          third.close()
        }

        // And a boot that adopts with nothing left to adopt writes no second
        // line — otherwise a flag left in by accident would grow the file for
        // ever and forgive losses nobody had looked at.
        const fourth = await game.boot({ adopt: true })
        fourth.close()
        expect(lines(game.orders).filter((entry) => entry.k === 'baseline')).toHaveLength(1)
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

        // Nothing is deleted. The flag has to be a no-op here: there is no
        // shortfall, so forgiving anything would be forgiving an answer that is
        // on file — and that would let its payment be answered twice.
        const second = await game.boot({ adopt: true })
        try {
          expect(lines(game.orders).filter((entry) => entry.k === 'baseline')).toHaveLength(0)
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

// ------------------------------------------------------------ what dev emits

describe('what bun run dev does to the file', () => {
  const server = (): string => readFileSync(join(directory, 'server', 'main.ts'), 'utf8')

  test('the delete is gated rather than unconditional', () => {
    const source = server()

    // The line itself, not a claim about it. An unconditional `await rm(orders`
    // at the start of a line is the defect, and it is what a later edit would
    // most plausibly reintroduce.
    expect(source).not.toMatch(/^await rm\(orders/m)
    expect(source).toMatch(/if \(EPHEMERAL_CHAIN\) await rm\(orders, \{ force: true \}\)/)

    // Derived from the node rather than set by hand, which is what makes the
    // migration — deleting `MockNode.create()` — turn it off without anybody
    // remembering to.
    expect(source).toMatch(/const EPHEMERAL_CHAIN = node instanceof MockNode/)
  })

  test('the testnet migration section names the orders file and stops promising nothing changes', () => {
    const readme = readFileSync(join(directory, 'README.md'), 'utf8')
    const migration = readme.slice(readme.indexOf('## When there is a testnet'))
    expect(migration).not.toBe('')

    // The sentence this section used to end on, directly under a list of things
    // that do change. It is what a developer reads once and never re-reads.
    expect(migration).not.toContain('Nothing else changes')

    expect(migration).toContain('orders')
    expect(migration).toContain('adoptChainAsBaseline')
    expect(migration).toContain('EPHEMERAL_CHAIN')
  })
})
