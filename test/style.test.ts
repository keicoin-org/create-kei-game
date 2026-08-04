/**
 * The style profile: read from the brief, never assumed. The test that matters
 * most here is the negative one — no fantasy without fantasy words.
 */

import { describe, expect, test } from 'bun:test'

import { resolveStyle, STYLE_PROFILE_VERSION } from '../src/style.js'
import { intentFor } from './fixtures.js'

describe('the style profile', () => {
  test('reads science fiction out of a space-salvage brief', () => {
    const style = resolveStyle(intentFor({
      gameplay: 'Crews salvage derelict stations and haul cargo home.',
      world: 'One shard of drifting wrecks in orbit.',
    }))
    expect(style.styleVersion).toBe(STYLE_PROFILE_VERSION)
    expect(style.setting).toBe('science-fiction')
    expect(style.evidence.setting.length).toBeGreaterThan(0)
    expect(style.rationale.join(' ')).toContain('science-fiction')
  })

  test('reads the other settings the same way', () => {
    expect(resolveStyle(intentFor({ gameplay: 'Couriers race deliveries across a modern city downtown.' })).setting).toBe('contemporary')
    expect(resolveStyle(intentFor({ gameplay: 'Viking crews raid and trade along a medieval coast.' })).setting).toBe('historical')
    expect(resolveStyle(intentFor({ gameplay: 'A fantasy world of mages, dragons, and arcane guilds.' })).setting).toBe('fantasy')
  })

  test('an unspecified brief is unspecified — never fantasy, never anything', () => {
    const style = resolveStyle(intentFor({ gameplay: 'Players explore, fight, and craft together.' }))
    expect(style.setting).toBe('unspecified')
    expect(style.evidence.setting).toEqual([])
    expect(style.rationale.join(' ')).toContain('no genre')
  })

  test('fantasy needs fantasy words, and non-fantasy briefs never read as it', () => {
    for (const gameplay of [
      'Crews salvage derelict stations and haul cargo home.',
      'Couriers race deliveries across a modern city.',
      'Samurai duel across a feudal coastline.',
      'Players trade quietly in a persistent world.',
    ]) {
      expect(resolveStyle(intentFor({ gameplay })).setting).not.toBe('fantasy')
    }
  })

  test('the finish axis is independent of the setting axis', () => {
    const toonSpace = resolveStyle(intentFor({
      gameplay: 'Crews salvage derelict stations.',
      art: 'Cel-shaded, toon outlines, bold flat colours.',
    }))
    expect(toonSpace.setting).toBe('science-fiction')
    expect(toonSpace.finish).toBe('stylized')

    const groundedSpace = resolveStyle(intentFor({ gameplay: 'Crews salvage derelict stations.' }))
    expect(groundedSpace.finish).toBe('grounded')
    expect(groundedSpace.rationale.join(' ')).toContain('grounded')
  })

  test('more evidence wins, and a tie goes to whichever the brief said first', () => {
    const spaceHeavy = resolveStyle(intentFor({
      gameplay: 'A starship crew explores the galaxy in orbit, with one castle siege flashback.',
    }))
    expect(spaceHeavy.setting).toBe('science-fiction')

    const tie = resolveStyle(intentFor({ gameplay: 'Viking raiders wake on a derelict.' }))
    expect(tie.setting).toBe('historical')
  })

  test('is deterministic: the same intent yields the same profile, byte for byte', () => {
    const intent = intentFor({ gameplay: 'Cyberpunk couriers in a neon orbital city.' })
    expect(JSON.stringify(resolveStyle(intent))).toBe(JSON.stringify(resolveStyle(intent)))
  })
})
