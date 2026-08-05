/**
 * How much of the issuer's chain one purchase costs.
 *
 * `server/orders.ts` is right that it needs the chain: what it has written and
 * what has been paid to it are both facts about blocks, and this game holds no
 * second copy of either. What it must not do is re-derive them from the
 * beginning every time, because the chain only grows — every lantern, every
 * refund, and every fence block is on it — and a game that has sold a hundred
 * thousand of them would read a hundred thousand blocks to sell the next one,
 * with every other player's purchase waiting behind that read.
 *
 * So the file writes down how far it has read. These tests hold it to that:
 * the same purchase against a chain three times as long is the same amount of
 * reading, and a chain longer than one request is read in more of them rather
 * than refused.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Kei, MockNode, randomSeed, type Block, type KeiNode } from 'kei-transaction'

import { projectFrom } from '../src/naming.js'
import { scaffold } from '../src/scaffold.js'
import { writeFiles } from '../src/write.js'

type LanternOutcome =
  | { outcome: 'delivered'; item: string }
  | { outcome: 'refunded'; amount: number; reason: string }

interface Payment {
  hash: string
  from: string
  amount: number
}

type Settled =
  | { status: 'answered'; outcome: LanternOutcome }
  | { status: 'unattributable' }
  | { status: 'indeterminate' }

interface Orders {
  payment(hash: string, timeoutMs: number): Promise<Payment | undefined>
  settle(
    payment: Payment,
    choose: () => Promise<{ kind: 'deliver' | 'refund'; outcome: LanternOutcome; perform(): Promise<void> }>,
  ): Promise<Settled>
  close(): void
}

interface OpenOrders {
  (options: { kei: Kei; item: string; path: string; historyLimit?: number }): Promise<Orders>
}

const directory = join(import.meta.dir, '..', '.generated', 'history')

/** Small enough that a chain of a few hundred blocks does not fit in one request. */
const PAGE = 25
const PRICE = 0.01

let openOrders: OpenOrders

beforeAll(async () => {
  await rm(directory, { recursive: true, force: true })
  const project = projectFrom({ name: 'Star Clicker', currency: 'Gold Pieces' })
  await writeFiles(directory, await scaffold(project, { sdkVersion: '^0.3.0' }))
  ;({ openOrders } = (await import(pathToFileURL(join(directory, 'server', 'orders.ts')).href)) as {
    openOrders: OpenOrders
  })
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

/** Every read of one account's chain, and how many blocks it came back with. */
function counting(node: KeiNode, of: () => string): { node: KeiNode; blocks(): number; calls(): number; reset(): void } {
  let blocks = 0
  let calls = 0
  const wrapped = Object.create(node) as KeiNode & { accountHistory: KeiNode['accountHistory'] }
  wrapped.accountHistory = async (address: string, query?: { limit?: number }) => {
    const history = await node.accountHistory(address, query)
    if (address === of()) {
      calls += 1
      blocks += history.length
    }
    return history
  }
  return {
    node: wrapped,
    blocks: () => blocks,
    calls: () => calls,
    reset: () => {
      blocks = 0
      calls = 0
    },
  }
}

/**
 * A node that keeps the block it is armed for and then stops answering at all —
 * the one failure that leaves an intent open, and so the one that makes the next
 * purchase settle it against the chain.
 */
function stalling(node: KeiNode, when: (block: Block) => boolean): { node: KeiNode; arm(): void; revive(): void } {
  let armed = false
  let stalled = false
  const unreachable = (): never => {
    throw new Error('the node did not answer')
  }
  const wrapped = Object.create(node) as KeiNode & {
    process: KeiNode['process']
    accountInfo: KeiNode['accountInfo']
    accountHistory: KeiNode['accountHistory']
  }
  wrapped.process = async (block: Block) => {
    if (stalled) unreachable()
    if (armed && when(block)) {
      armed = false
      stalled = true
      unreachable()
    }
    return node.process(block)
  }
  wrapped.accountInfo = async (address: string) => (stalled ? unreachable() : node.accountInfo(address))
  wrapped.accountHistory = async (address: string, query?: { limit?: number }) =>
    stalled ? unreachable() : node.accountHistory(address, query)
  return {
    node: wrapped,
    arm: () => {
      armed = true
    },
    revive: () => {
      stalled = false
    },
  }
}

interface Rig {
  kei: Kei
  node: MockNode
  item: string
  length(): Promise<number>
  read: ReturnType<typeof counting>
  fail: ReturnType<typeof stalling>
  open(name: string, historyLimit?: number): Promise<Orders>
  buy(orders: Orders, payer: Kei): Promise<Settled>
  pay(payer: Kei): Promise<string>
  answer(orders: Orders, hash: string): Promise<Settled>
}

/** An issuer with an item to sell and a chain of `blocks` blocks behind it. */
async function rig(name: string, blocks: number): Promise<Rig> {
  const node = await MockNode.create()
  // Which address to count reads of is not known until the seed has been read,
  // and the node that reads it is the one being wrapped here.
  const issuer = { address: '' }
  const fail = stalling(node, (block) => block.type === 'asset' && block.op.kind === 'mint')
  const read = counting(fail.node, () => issuer.address)
  const kei = await Kei.server({ seed: randomSeed(), node: read.node, network: 'mock' })
  issuer.address = kei.address

  await kei.faucet(2_000)
  const item = await kei.items.create({
    name: 'Lantern',
    description: 'A lantern.',
    supply: 10_000,
    transfer: 'open',
  })

  // Blocks that are not answers and not payments, so the chain is long without
  // anything on it that this file has to attribute. A representative change is
  // what `fence` writes, and it is read the same way.
  while ((await node.accountHistory(kei.address)).length < blocks) {
    await kei.client.submit((draft) => ({
      type: 'state',
      subtype: 'change',
      account: kei.address,
      previous: draft.previous,
      representative: draft.representative,
      balance: draft.balance.toString(),
      link: '0'.repeat(64),
    }))
  }

  const pay = async (payer: Kei): Promise<string> => (await payer.pay({ to: kei.address, amount: PRICE })).hash

  const answer = async (orders: Orders, hash: string): Promise<Settled> => {
    const payment = await orders.payment(hash, 20_000)
    if (!payment) throw new Error('The payment never reached the game.')
    return orders.settle(payment, async () => ({
      kind: 'deliver',
      outcome: { outcome: 'delivered', item: item.id },
      perform: async () => void (await kei.items.mint(item.id, payment.from)),
    }))
  }

  return {
    kei,
    node,
    item: item.id,
    read,
    fail,
    length: async () => (await node.accountHistory(kei.address)).length,
    open: (file, historyLimit = PAGE) =>
      openOrders({ kei, item: item.id, path: join(directory, '.kei', `${name}-${file}.ndjson`), historyLimit }),
    pay,
    answer,
    buy: async (orders, payer) => answer(orders, await pay(payer)),
  }
}

/** A player with money, on the same chain, holding their own key. */
async function player(node: KeiNode): Promise<Kei> {
  const kei = await Kei.start({ node, network: 'mock', seed: randomSeed() })
  await kei.faucet(1)
  return kei
}

const delivered = (item: string): Settled => ({ status: 'answered', outcome: { outcome: 'delivered', item } })

// Laid down once and shared: a chain takes a moment to write, and the tests
// below only ever read it and add to the end of it.
let short: Promise<Rig> | undefined
let long: Promise<Rig> | undefined
const shorter = (): Promise<Rig> => (short ??= rig('short', 120))
const longer = (): Promise<Rig> => (long ??= rig('long', 360))

afterAll(async () => {
  for (const built of [short, long]) (await built)?.kei.close()
})

describe('the chain is read forward, not from the beginning', () => {
  /** Sell one lantern, stop, and start again — measuring only what the second start reads. */
  async function restart(subject: Rig): Promise<{ blocks: number; calls: number }> {
    const buyer = await player(subject.node)
    const first = await subject.open('restart')
    try {
      expect(await subject.buy(first, buyer)).toEqual(delivered(subject.item))
    } finally {
      first.close()
      buyer.close()
    }

    subject.read.reset()
    const second = await subject.open('restart')
    second.close()
    return { blocks: subject.read.blocks(), calls: subject.read.calls() }
  }

  test(
    'starting again reads the blocks written since the last mark, however long the chain is',
    async () => {
      const over120 = await restart(await shorter())
      const over360 = await restart(await longer())

      // The chain is three times as long and the start reads the same amount of
      // it: what was written after the mark the last run left behind.
      expect(over360).toEqual(over120)
      expect(over120.blocks).toBeLessThanOrEqual(PAGE)
      expect(await (await longer()).length()).toBeGreaterThan(360)
    },
    120_000,
  )

  /** Leave an intent open, then measure the purchase that has to settle it. */
  async function settleOpen(subject: Rig): Promise<{ blocks: number; calls: number }> {
    const buyer = await player(subject.node)
    const orders = await subject.open('open-intent')
    try {
      // The mint is refused and the node then says nothing, so nothing can be
      // claimed about it and the intent stays open.
      subject.fail.arm()
      expect(await subject.buy(orders, buyer)).toEqual({ status: 'indeterminate' })
      subject.fail.revive()

      // The next attempt settles that intent against its own window before it
      // answers anything. This is the read the issue is about.
      subject.read.reset()
      expect(await subject.buy(orders, buyer)).toEqual(delivered(subject.item))
      return { blocks: subject.read.blocks(), calls: subject.read.calls() }
    } finally {
      orders.close()
      buyer.close()
    }
  }

  test(
    'settling an open intent reads the window that intent opened, not the chain behind it',
    async () => {
      const over120 = await settleOpen(await shorter())
      const over360 = await settleOpen(await longer())

      expect(over360.calls).toEqual(over120.calls)
      expect(over360.blocks).toEqual(over120.blocks)
      // A handful of requests, each bounded by the page — not two passes over
      // every block the issuer has ever written.
      expect(over120.blocks).toBeLessThanOrEqual(over120.calls * PAGE)
      expect(over120.calls).toBeLessThanOrEqual(4)
    },
    120_000,
  )
})

describe('a chain longer than one request', () => {
  test(
    'starts, and answers a payment made before it did',
    async () => {
      const subject = await rig('ceiling', 250)
      const buyer = await player(subject.node)
      try {
        // Paid with nothing listening, which is the case that makes the chain
        // worth reading at all: the arrival is announced to nobody.
        const hash = await subject.pay(buyer)
        while ((await subject.node.receivables(subject.kei.address)).length > 0) await Bun.sleep(25)

        // 250 blocks and a hundred to a request. The old ceiling refused here.
        const orders = await subject.open('first-boot', 100)
        try {
          expect(await subject.answer(orders, hash)).toEqual(delivered(subject.item))
        } finally {
          orders.close()
        }
      } finally {
        buyer.close()
        subject.kei.close()
      }
    },
    120_000,
  )
})
