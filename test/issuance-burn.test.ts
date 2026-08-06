/**
 * What `startGame` asks the faucet for before it issues the currency and the
 * lantern.
 *
 * SPEC §5.6.5 prices the nth asset an account issues at n Kei, escalating —
 * not the flat 1,000 Kei per asset this template used to hardcode. Getting
 * the number right on a fresh boot is only half of it: `token.issue()` and
 * `items.create()` are idempotent, so a server that restarts after already
 * issuing both assets has nothing left to burn, and must not ask for the same
 * float again. On a real network, where there is no faucet to quietly absorb
 * the overshoot, asking anyway is a restart that fails to fund itself for no
 * reason.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { KEI_DECIMALS, MockNode, issuanceBurn, randomSeed, type KeiNode } from 'kei-transaction'

import { projectFrom } from '../src/naming.js'
import { scaffold } from '../src/scaffold.js'
import { writeFiles } from '../src/write.js'

interface GeneratedGame {
  address: string
  close(): void
}

const directory = join(import.meta.dir, '..', '.generated', 'issuance-burn')

let startGame: (options: { seed: string; node: KeiNode; network: 'mock'; orders: string }) => Promise<GeneratedGame>

beforeAll(async () => {
  await rm(directory, { recursive: true, force: true })
  const project = projectFrom({ name: 'Star Clicker', currency: 'Gold Pieces' })
  await writeFiles(directory, await scaffold(project, { sdkVersion: '^0.8.0' }))
  ;({ startGame } = (await import(pathToFileURL(join(directory, 'server', 'game.ts')).href)) as {
    startGame: typeof startGame
  })
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

/** This account's own Kei balance, read off the chain rather than asked of it. */
async function balanceOf(node: MockNode, address: string): Promise<number> {
  const info = await node.accountInfo(address)
  return info ? Number(BigInt(info.balance)) / 10 ** KEI_DECIMALS : 0
}

/** SPEC §5.6.5: the nth asset issued from a fresh account burns n Kei. */
const twoFreshIssuances = Number(issuanceBurn(0) + issuanceBurn(1)) / 10 ** KEI_DECIMALS

describe('what the issuer is funded for', () => {
  test('a fresh boot asks for the escalating schedule, not a flat 1,000 per asset', async () => {
    const seed = randomSeed()
    const orders = join(directory, '.kei', 'fresh.ndjson')
    const node = await MockNode.create()

    const game = await startGame({ seed, node, network: 'mock', orders })
    const balance = await balanceOf(node, game.address)
    game.close()

    // Both assets are issued and their burn is spent, so what is left is the
    // float above the schedule — 100, same as before this fix, just no longer
    // stacked on top of a burn 700x too large.
    expect(balance).toBeCloseTo(100, 6)
    expect(balance).not.toBeCloseTo(2 * 1_000 + 100 - twoFreshIssuances, 6)
  })

  test('a restart that finds both assets already issued asks the faucet for nothing more', async () => {
    const seed = randomSeed()
    const orders = join(directory, '.kei', 'restart.ndjson')
    const node = await MockNode.create()

    const first = await startGame({ seed, node, network: 'mock', orders })
    const address = first.address
    first.close()
    const afterFirstBoot = await balanceOf(node, address)

    // Same seed, same node: `accountInfo(address).issuedCount` now reads back
    // as 2, so `startGame` has nothing left to price and should not touch the
    // faucet at all. If it asked anyway — the old hardcoded total, blind to
    // `issuedCount` — this balance would jump by another ~100 Kei here.
    const second = await startGame({ seed, node, network: 'mock', orders })
    const afterRestart = await balanceOf(node, address)
    second.close()

    expect(afterRestart).toBeCloseTo(afterFirstBoot, 6)
  })
})
