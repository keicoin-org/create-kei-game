/** Project-owned Kei economy proof emitted into every generated MMO. */

import type { WorkspaceFile } from './source.js'

export const KEI_PACKAGE = 'kei-transaction'
export const KEI_RANGE = '0.6.0'
export const ECONOMY_DEFINITIONS_PATH = 'src/economy/definitions.ts'
export const ECONOMY_PROVISION_PATH = 'src/economy/provision.ts'
export const PLAYER_TRADE_PATH = 'src/economy/player-trade.ts'
export const ECONOMY_TEST_PATH = 'test/economy.test.ts'

export function economyProjectFiles(): readonly WorkspaceFile[] {
  return Object.freeze([
    { path: ECONOMY_DEFINITIONS_PATH, contents: definitionsSource() },
    { path: ECONOMY_PROVISION_PATH, contents: provisionSource() },
    { path: PLAYER_TRADE_PATH, contents: playerTradeSource() },
    { path: ECONOMY_TEST_PATH, contents: economyTestSource() },
  ])
}

function definitionsSource(): string {
  return `/**
 * Example world economy declarations. Amounts are integer raw units; no value
 * here has passed through a display float.
 */
export const GOLD = Object.freeze({
  name: 'Gold',
  symbol: 'GOLD',
  decimals: 0,
  maxSupply: '1000000',
  transfer: 'open',
  swap: 'one-way',
} as const)

export const FOUNDERS_SWORD = Object.freeze({
  name: "Founder's Sword",
  description: 'The first player-custodied item in this generated world.',
  transfer: 'open',
} as const)

export const BUYER_GOLD_RAW = '100'
export const SWORD_AMOUNT_RAW = '1'
export const SWORD_PRICE_GOLD_RAW = '25'
export const SWORD_PRICE_GOLD = 25
`
}

function provisionSource(): string {
  return `import type { IssuerToken, Item, Kei } from 'kei-transaction'

import { BUYER_GOLD_RAW, FOUNDERS_SWORD, GOLD } from './definitions.js'

export interface EconomyRecipients {
  readonly seller: string
  readonly buyer: string
}

export interface ProvisionedEconomy {
  readonly gold: IssuerToken
  readonly sword: Item
}

/**
 * Run this from a provisioning job with an injected issuer context. It is not
 * imported by the game server, owns no player key, and contains no seed value.
 */
export async function provisionEconomy(
  issuer: Kei,
  recipients: EconomyRecipients,
): Promise<ProvisionedEconomy> {
  if (issuer.role !== 'issuer') {
    throw new Error('provisionEconomy needs an issuer context created by Kei.server().')
  }
  if (recipients.seller === recipients.buyer) {
    throw new Error('The seller and buyer must be different player wallets.')
  }

  const gold = await issuer.token.issue(GOLD)
  const sword = await issuer.items.create(FOUNDERS_SWORD)

  // Assets go from the issuer directly to their player custodians. There is no
  // game-server wallet and no intermediate escrow account.
  await issuer.items.mint(sword.id, recipients.seller)
  await gold.mint(recipients.buyer, BUYER_GOLD_RAW)

  return Object.freeze({ gold, sword })
}
`
}

function playerTradeSource(): string {
  return `import type { AssetId, Kei, Offer, Settlement } from 'kei-transaction'

import { SWORD_AMOUNT_RAW, SWORD_PRICE_GOLD, SWORD_PRICE_GOLD_RAW } from './definitions.js'

export interface TradeAssets {
  readonly sword: AssetId
  readonly gold: AssetId
}

function player(context: Kei, operation: string): void {
  if (context.role !== 'player') {
    throw new Error(operation + ' must be signed by a player context.')
  }
}

/** Seller-authored, reserved, and passed directly to the named buyer. */
export async function offerSwordForGold(
  seller: Kei,
  buyer: string,
  assets: TradeAssets,
): Promise<Offer> {
  player(seller, 'offerSwordForGold')
  return seller.market.offer({
    give: { asset: assets.sword, amount: SWORD_AMOUNT_RAW },
    want: { asset: assets.gold, amount: SWORD_PRICE_GOLD_RAW },
    to: buyer,
  })
}

/** Buyer verifies every displayed term against chain state before signing. */
export async function acceptSwordForGold(
  buyer: Kei,
  offer: Offer,
  seller: string,
  assets: TradeAssets,
): Promise<Settlement> {
  player(buyer, 'acceptSwordForGold')
  return buyer.market.accept(offer, {
    expect: {
      hash: offer.hash,
      seller,
      give: { asset: assets.sword, amount: 1 },
      want: { asset: assets.gold, amount: SWORD_PRICE_GOLD },
      to: buyer.address,
    },
  })
}
`
}

function economyTestSource(): string {
  return `import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Kei, type MockNode } from 'kei-transaction'

import {
  BUYER_GOLD_RAW,
  SWORD_AMOUNT_RAW,
  SWORD_PRICE_GOLD,
  SWORD_PRICE_GOLD_RAW,
} from '../src/economy/definitions.js'
import { acceptSwordForGold, offerSwordForGold } from '../src/economy/player-trade.js'
import { provisionEconomy } from '../src/economy/provision.js'

// Public mock-only test material. These deterministic seeds must never be used
// on a public network or copied into production configuration.
const PUBLIC_MOCK_SEEDS = Object.freeze({
  issuer: 'C'.repeat(64),
  seller: 'A'.repeat(64),
  buyer: 'B'.repeat(64),
})

async function rawBalances(
  node: MockNode,
  assets: { readonly sword: string; readonly gold: string },
  accounts: { readonly issuer: string; readonly seller: string; readonly buyer: string },
): Promise<Record<string, string>> {
  return {
    swordIssuer: await node.holderBalance(assets.sword, accounts.issuer),
    swordSeller: await node.holderBalance(assets.sword, accounts.seller),
    swordBuyer: await node.holderBalance(assets.sword, accounts.buyer),
    goldIssuer: await node.holderBalance(assets.gold, accounts.issuer),
    goldSeller: await node.holderBalance(assets.gold, accounts.seller),
    goldBuyer: await node.holderBalance(assets.gold, accounts.buyer),
  }
}

function sourceTree(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return [sourceTree(path)]
      return /\\.(?:ts|mjs)$/.test(entry.name) ? [readFileSync(path, 'utf8')] : []
    })
    .join('\\n')
}

describe('player-custodied Kei economy', () => {
  test('issues, mints, refuses mismatched terms, and atomically settles on Kei.mock()', async () => {
    const node = await Kei.mock()
    const mockProvisioner = await Kei.server({
      node,
      seed: PUBLIC_MOCK_SEEDS.issuer,
      autoCancelExpired: false,
    })
    const seller = await Kei.start({
      node,
      seed: PUBLIC_MOCK_SEEDS.seller,
      autoCancelExpired: false,
    })
    const buyer = await Kei.start({
      node,
      seed: PUBLIC_MOCK_SEEDS.buyer,
      autoCancelExpired: false,
    })

    try {
      // Issuance burns Kei, so only this mock-only provisioner receives faucet
      // funds. Neither player nor the game server needs a faucet or issuer key.
      await mockProvisioner.faucet('50000')
      const { gold, sword } = await provisionEconomy(mockProvisioner, {
        seller: seller.address,
        buyer: buyer.address,
      })
      await Promise.all([seller.sync(), buyer.sync()])

      expect(gold.transferPolicy).toBe('open')
      expect(gold.swap).toBe('one-way')
      expect(sword.transferPolicy).toBe('open')
      expect(await seller.items.owner(sword.id)).toBe(seller.address)
      expect(await rawBalances(node, { sword: sword.id, gold: gold.id }, {
        issuer: mockProvisioner.address,
        seller: seller.address,
        buyer: buyer.address,
      })).toEqual({
        swordIssuer: '0',
        swordSeller: SWORD_AMOUNT_RAW,
        swordBuyer: '0',
        goldIssuer: '0',
        goldSeller: '0',
        goldBuyer: BUYER_GOLD_RAW,
      })

      const assets = { sword: sword.id, gold: gold.id }
      const offer = await offerSwordForGold(seller, buyer.address, assets)
      const chainOffer = await node.swapOffer(offer.hash)
      expect(chainOffer).toMatchObject({
        hash: offer.hash,
        from: seller.address,
        asset: sword.id,
        amount: SWORD_AMOUNT_RAW,
        wantAsset: gold.id,
        wantAmount: SWORD_PRICE_GOLD_RAW,
        counterparty: buyer.address,
        state: 'open',
      })
      expect(await seller.items.owner(sword.id)).toBeNull()

      const locked = await rawBalances(node, assets, {
        issuer: mockProvisioner.address,
        seller: seller.address,
        buyer: buyer.address,
      })
      await expect(buyer.market.accept(offer, {
        expect: {
          hash: offer.hash,
          seller: seller.address,
          give: { asset: sword.id, amount: 1 },
          want: { asset: gold.id, amount: SWORD_PRICE_GOLD + 1 },
          to: buyer.address,
        },
      })).rejects.toThrow(/not the trade that was shown to you/i)
      expect(await rawBalances(node, assets, {
        issuer: mockProvisioner.address,
        seller: seller.address,
        buyer: buyer.address,
      })).toEqual(locked)
      expect((await node.swapOffer(offer.hash))?.state).toBe('open')

      const settlement = await acceptSwordForGold(buyer, offer, seller.address, assets)
      expect(settlement).toMatchObject({
        offer: offer.hash,
        from: seller.address,
        received: { asset: sword.id, amount: 1 },
        paid: { asset: gold.id, amount: SWORD_PRICE_GOLD },
      })
      expect(await rawBalances(node, assets, {
        issuer: mockProvisioner.address,
        seller: seller.address,
        buyer: buyer.address,
      })).toEqual({
        swordIssuer: '0',
        swordSeller: '0',
        swordBuyer: SWORD_AMOUNT_RAW,
        goldIssuer: '0',
        goldSeller: SWORD_PRICE_GOLD_RAW,
        goldBuyer: '75',
      })
      expect(await buyer.items.owner(sword.id)).toBe(buyer.address)
      expect(await node.swapOffer(offer.hash)).toMatchObject({
        state: 'accepted',
        settledBy: settlement.hash,
        acceptedBy: buyer.address,
      })
    } finally {
      buyer.close()
      seller.close()
      mockProvisioner.close()
    }
  })

  test('the authoritative game server has no Kei custody or economic message path', () => {
    const serverRoot = join(process.cwd(), 'src', 'server')
    const serverSource = sourceTree(serverRoot)
    expect(serverSource).not.toMatch(/(?:from|require\\()\\s*['\"]kei-transaction/)
    expect(serverSource).not.toMatch(/KEI_(?:SEED|PRIVATE_KEY)|private[_-]?key/i)

    const protocol = readFileSync(join(process.cwd(), 'src', 'shared', 'protocol.ts'), 'utf8')
    for (const forbidden of ['balance', 'inventory', 'mint', 'transfer', 'settlement']) {
      expect(protocol).toContain("'" + forbidden + "'")
    }
  })
})
`
}
