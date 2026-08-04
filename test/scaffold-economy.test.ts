/** Contract for the generated, player-custodied Kei slice. */

import { describe, expect, test } from 'bun:test'

import {
  ECONOMY_DEFINITIONS_PATH,
  ECONOMY_PROVISION_PATH,
  ECONOMY_TEST_PATH,
  KEI_PACKAGE,
  KEI_RANGE,
  PLAYER_TRADE_PATH,
} from '../src/scaffold-economy.js'
import { projectFiles } from '../src/scaffold.js'
import { planFor } from './fixtures.js'

function generated(dimension: '2d' | '3d'): Map<string, string> {
  const plan = planFor({
    name: `Economy ${dimension}`,
    dimension,
    gameplay: 'Players exchange a unique sword for exact integer GOLD.',
    economy: 'One open currency, player-owned items, and direct atomic trade.',
  })
  return new Map(projectFiles({ slug: `economy-${dimension}`, title: `Economy ${dimension}` }, plan)
    .map((file) => [file.path, file.contents]))
}

describe('generated Kei economy', () => {
  for (const dimension of ['2d', '3d'] as const) {
    test(`${dimension} installs the published package and owns the whole proof`, () => {
      const files = generated(dimension)
      const manifest = JSON.parse(files.get('package.json')!) as {
        readonly scripts: Record<string, string>
        readonly dependencies: Record<string, string>
      }

      expect(manifest.dependencies[KEI_PACKAGE]).toBe(KEI_RANGE)
      expect(manifest.scripts['economy:check']).toBe(`bun test ${ECONOMY_TEST_PATH}`)
      for (const path of [
        ECONOMY_DEFINITIONS_PATH,
        ECONOMY_PROVISION_PATH,
        PLAYER_TRADE_PATH,
        ECONOMY_TEST_PATH,
      ]) expect(files.has(path)).toBeTrue()

      const economy = [
        files.get(ECONOMY_DEFINITIONS_PATH),
        files.get(ECONOMY_PROVISION_PATH),
        files.get(PLAYER_TRADE_PATH),
        files.get(ECONOMY_TEST_PATH),
      ].join('\n')
      expect(economy).toContain("from 'kei-transaction'")
      expect(economy).toContain('Kei.mock()')
      expect(economy).toContain("swap: 'one-way'")
      expect(economy).toContain("expect(gold.swap).toBe('one-way')")
      expect(economy).toContain('market.offer')
      expect(economy).toContain('market.accept')
      expect(economy).toContain('holderBalance')
      expect(economy).not.toMatch(/(?:from|require\()\s*['"]create-kei-mmo/)
    })
  }

  test('the game server has no Kei, key, balance, inventory, or settlement import path', () => {
    const files = generated('2d')
    const server = [...files]
      .filter(([path]) => path.startsWith('src/server/'))
      .map(([, contents]) => contents)
      .join('\n')
    expect(server).not.toContain('kei-transaction')
    expect(server).not.toMatch(/KEI_(?:SEED|PRIVATE_KEY)|private[_-]?key/i)
    expect(server).not.toMatch(/from\s+['"][^'"]*economy\//)

    const persistence = files.get('src/server/persistence.ts')!
    expect(persistence).toContain(
      "['player_id', 'resume_hash', 'x', 'y', 'z', 'xp', 'level', 'updated_at']",
    )
    expect(persistence).not.toMatch(/\b(?:balance|currency|inventory|item|settlement|wallet_seed)\s+(?:TEXT|INTEGER|REAL|BLOB)\b/i)

    const protocol = files.get('src/shared/protocol.ts')!
    for (const key of ['balance', 'inventory', 'mint', 'transfer', 'settlement']) {
      expect(protocol).toContain(`'${key}'`)
    }
  })

  test('provisioning and trade retain the two player signing boundary', () => {
    const files = generated('2d')
    const provision = files.get(ECONOMY_PROVISION_PATH)!
    const trade = files.get(PLAYER_TRADE_PATH)!
    const proof = files.get(ECONOMY_TEST_PATH)!

    expect(provision).toContain("issuer.role !== 'issuer'")
    expect(provision).toContain('issuer.items.mint(sword.id, recipients.seller)')
    expect(provision).toContain('gold.mint(recipients.buyer, BUYER_GOLD_RAW)')
    expect(trade).toContain("context.role !== 'player'")
    expect(trade).toContain('to: buyer')
    expect(trade).toContain('hash: offer.hash')
    expect(proof).toContain('Public mock-only test material')
    expect(proof).toContain("state: 'accepted'")
    expect(proof).toContain("state).toBe('open')")
  })
})
