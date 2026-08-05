/**
 * The derivations, and the one rule that is not ours to invent.
 *
 * `symbolFor` copies the ticker rule out of `@keicoin/core` so that the harness
 * ships with no dependencies. A copy is a thing that drifts, so the copy is
 * checked against the original here — where the SDK is on hand anyway.
 */

import { describe, expect, test } from 'bun:test'
import { normalizeSymbol } from '@keicoin/core'

import { HarnessError } from '../src/errors.js'
import { projectFrom, slugFor, symbolFor } from '../src/naming.js'

describe('slugFor', () => {
  test('turns a title into a directory name', () => {
    expect(slugFor('Star Clicker')).toBe('star-clicker')
    expect(slugFor('  My Game!!  ')).toBe('my-game')
    expect(slugFor('already-kebab')).toBe('already-kebab')
    expect(slugFor('Crystal 2')).toBe('crystal-2')
  })

  test('refuses a name with nothing in it to use', () => {
    expect(() => slugFor('***')).toThrow(HarnessError)
    expect(() => slugFor('***')).toThrow(/no letters or digits/)
  })

  test('refuses a name npm would refuse', () => {
    expect(() => slugFor('a'.repeat(215))).toThrow(/longer than npm allows/)
  })
})

describe('symbolFor', () => {
  test('takes the first word, uppercased', () => {
    expect(symbolFor('Gems')).toBe('GEMS')
    expect(symbolFor('gold pieces')).toBe('GOLD')
    expect(symbolFor('Bits')).toBe('BITS')
    expect(symbolFor('Star Bucks')).toBe('STAR')
  })

  test('truncates rather than inventing an abbreviation', () => {
    expect(symbolFor('Doubloons')).toBe('DOUBL')
  })

  test('drops punctuation the chain would reject', () => {
    expect(symbolFor("Miner's Credit")).toBe('MINER')
    expect(symbolFor('Zed_9')).toBe('ZED9')
  })

  test('refuses what cannot become a ticker', () => {
    expect(() => symbolFor('***')).toThrow(HarnessError)
    expect(() => symbolFor('-nope')).toThrow(/will not accept/)
  })

  /** The rule belongs to the node. If this fails, the copy has drifted. */
  test('agrees with normalizeSymbol in @keicoin/core', () => {
    for (const currency of ['Gems', 'gold pieces', 'Bits', 'Doubloons', "Miner's Credit", 'Zed_9', 'Crystal 2']) {
      const symbol = symbolFor(currency)
      expect(normalizeSymbol(symbol)).toBe(symbol)
    }
  })

  test('every symbol it rejects, the node rejects too', () => {
    for (const currency of ['***', '-nope', '   ', '!']) {
      expect(() => symbolFor(currency)).toThrow(HarnessError)
    }
  })
})

describe('projectFrom', () => {
  test('completes the two answers', () => {
    expect(projectFrom({ name: 'Star Clicker', currency: 'Gems' })).toEqual({
      title: 'Star Clicker',
      slug: 'star-clicker',
      currency: 'Gems',
      symbol: 'GEMS',
    })
  })

  test('asks again rather than guessing', () => {
    expect(() => projectFrom({ name: '', currency: 'Gems' })).toThrow(/project needs a name/)
    expect(() => projectFrom({ name: 'Star Clicker', currency: '  ' })).toThrow(/currency needs a name/)
  })

  /** By code point, because a test file with an invisible character in it is the same trap. */
  test('refuses a character with no printed form, and names it', () => {
    const escape = String.fromCodePoint(0x1b)
    const rightToLeftOverride = String.fromCodePoint(0x202e)

    expect(() => projectFrom({ name: 'Star\nClicker', currency: 'Gems' })).toThrow(HarnessError)
    expect(() => projectFrom({ name: 'Star\nClicker', currency: 'Gems' })).toThrow(/project name contains U\+000A/)
    // An escape sequence rewrites the terminal the next-steps message is printed to.
    expect(() => projectFrom({ name: 'Star Clicker', currency: `Gems${escape}[31m` })).toThrow(
      /currency name contains U\+001B/,
    )
    // U+202E reverses everything after it, including in the source this writes.
    expect(() => projectFrom({ name: `Star${rightToLeftOverride}Clicker`, currency: 'Gems' })).toThrow(/U\+202E/)
  })

  test('refuses a paragraph pasted into the wrong prompt', () => {
    expect(() => projectFrom({ name: 'a'.repeat(101), currency: 'Gems' })).toThrow(/fits in a heading/)
  })

  /** Escaping is what makes these safe, so none of them is refused for looking dangerous. */
  test('keeps the punctuation an ordinary name has in it', () => {
    expect(projectFrom({ name: 'Star Clicker', currency: "Miner's Gold" }).currency).toBe("Miner's Gold")
    expect(projectFrom({ name: 'Star & Co.', currency: 'Gems' }).title).toBe('Star & Co.')
    expect(projectFrom({ name: '${Hazmat} Clicker', currency: 'Gems' }).title).toBe('${Hazmat} Clicker')
  })
})
