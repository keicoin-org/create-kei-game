import { describe, expect, test } from 'bun:test'

import { parseMmoIntent } from '../src/intent.js'
import { matchIntentSignals, matchesFor } from '../src/signals.js'

const terms = (
  gameplay: string,
  signals: readonly string[],
  name = 'Pixel Voice Space Guild',
) => matchesFor(
  matchIntentSignals(parseMmoIntent({ name, gameplay }), signals),
  signals,
).map(({ signal }) => signal)

describe('the intent signal matcher', () => {
  test('matches exact words and normalized multiword phrases', () => {
    const signals = [
      'voice',
      'space',
      'open world',
      'motion capture',
      'voice acting',
      'proof of concept',
      'auction house',
    ]
    expect(terms(
      'Voice, in space. An open   world with motion\tcapture, voice acting,\r\n' +
        'a proof of concept, and an auction house.',
      signals,
    )).toEqual(signals)
  })

  test('does not match embedded fragments, including Unicode-letter boundaries', () => {
    const signals = ['voice', 'space', 'pixel']
    expect(terms(
      'Invoices share a workspace. Pixelated art; avoid évoice, voice猫, and myspace.',
      signals,
    )).toEqual([])
  })

  test('keeps supported hyphen and space aliases explicit and deterministic', () => {
    const signals = ['top-down', 'top down', 'cel-shaded', 'cel shaded']
    expect(terms('A top-down map with cel shaded art.', signals)).toEqual([
      'top-down',
      'cel shaded',
    ])
    expect(terms('A top down map with cel-shaded art.', signals)).toEqual([
      'top down',
      'cel-shaded',
    ])
  })

  test('attributes a match to its first ordered description field, never the name', () => {
    const intent = parseMmoIntent({
      name: 'Voice Space',
      gameplay: 'Players trade.',
      art: 'Ambient music.',
      world: 'Music in every district.',
    })
    const record = matchIntentSignals(intent, ['voice', 'space', 'music'])
    expect(record.matches).toEqual([
      expect.objectContaining({ signal: 'music', field: 'world' }),
    ])
  })
})
