import { describe, expect, test } from 'bun:test'

import {
  INTENT_GOAL_FIELDS,
  IntentError,
  MAX_INTENT_GOAL_LENGTH,
  MAX_INTENT_NAME_LENGTH,
  MMO_INTENT_VERSION,
  dimensionNamed,
  intentSignalText,
  parseMmoIntent,
  unspecifiedGoals,
} from '../src/intent.js'

describe('the intent schema', () => {
  test('is versioned, and stamps the version it accepted', () => {
    expect(MMO_INTENT_VERSION).toBe(1)
    expect(parseMmoIntent({ name: 'g', gameplay: 'x' }).intentVersion).toBe(1)
    expect(parseMmoIntent({ intentVersion: 1, name: 'g', gameplay: 'x' }).intentVersion).toBe(1)
  })

  test('refuses a version it does not know rather than reading it anyway', () => {
    expect(() => parseMmoIntent({ intentVersion: 2, name: 'g', gameplay: 'x' })).toThrow(
      expect.objectContaining({ code: 'unsupported_intent_version' }),
    )
  })

  test('needs a name and gameplay, and nothing else', () => {
    const intent = parseMmoIntent({ name: 'My MMO', gameplay: 'Questing' })
    expect(intent).toEqual({
      intentVersion: 1,
      name: 'My MMO',
      dimension: 'auto',
      gameplay: 'Questing',
      world: '',
      art: '',
      network: '',
      economy: '',
    })
  })

  test.each([
    [{ gameplay: 'x' }, 'invalid_name'],
    [{ name: '   ', gameplay: 'x' }, 'invalid_name'],
    [{ name: 'g' }, 'missing_gameplay'],
    [{ name: 'g', gameplay: '   ' }, 'missing_gameplay'],
    [{ name: 'g', gameplay: 'x', world: 42 }, 'invalid_intent'],
    [{ name: 'g', gameplay: 'x', dimension: '4d' }, 'invalid_dimension'],
    [{ name: 'x'.repeat(MAX_INTENT_NAME_LENGTH + 1), gameplay: 'x' }, 'intent_too_long'],
    [{ name: 'g', gameplay: 'x'.repeat(MAX_INTENT_GOAL_LENGTH + 1) }, 'intent_too_long'],
  ])('rejects %p as %s', (input, code) => {
    expect(() => parseMmoIntent(input)).toThrow(IntentError)
    expect(() => parseMmoIntent(input)).toThrow(expect.objectContaining({ code }))
  })

  test('rejects anything that is not one object', () => {
    for (const value of [undefined, null, 'text', 7, ['name']]) {
      expect(() => parseMmoIntent(value)).toThrow(expect.objectContaining({ code: 'invalid_intent' }))
    }
  })

  test('collapses whitespace so a heredoc and a flag produce the same intent', () => {
    const heredoc = parseMmoIntent({ name: ' My  MMO ', gameplay: 'Questing\n\n\n\nand   crafting' })
    expect(heredoc.name).toBe('My MMO')
    expect(heredoc.gameplay).toBe('Questing\n\nand crafting')
  })

  test('accepts every dimension spelling and refuses the rest', () => {
    expect(dimensionNamed('2D')).toBe('2d')
    expect(dimensionNamed(' 3d ')).toBe('3d')
    expect(dimensionNamed(undefined)).toBe('auto')
    expect(dimensionNamed('')).toBe('auto')
    expect(() => dimensionNamed('isometric')).toThrow(expect.objectContaining({ code: 'invalid_dimension' }))
    expect(() => dimensionNamed(3)).toThrow(expect.objectContaining({ code: 'invalid_dimension' }))
  })

  test('reports which goals were left for the planner, in field order', () => {
    expect(unspecifiedGoals(parseMmoIntent({ name: 'g', gameplay: 'x' }))).toEqual([
      'world',
      'art',
      'network',
      'economy',
    ])
    expect(unspecifiedGoals(parseMmoIntent({ name: 'g', gameplay: 'x', art: 'pixel' }))).toEqual([
      'world',
      'network',
      'economy',
    ])
    expect(INTENT_GOAL_FIELDS[0]).toBe('gameplay')
  })

  test('the signal text spans every goal at once, lowercased', () => {
    const text = intentSignalText(
      parseMmoIntent({ name: 'Realm', gameplay: 'Questing', art: 'ISOMETRIC pixel art' }),
    )
    expect(text).toContain('isometric')
    expect(text).toContain('questing')
    expect(text).not.toContain('ISOMETRIC')
  })
})
