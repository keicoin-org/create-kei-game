/**
 * The one derivation left: a project name into the directory it becomes.
 */

import { describe, expect, test } from 'bun:test'

import { HarnessError } from '../src/errors.js'
import { projectFrom, slugFor } from '../src/naming.js'

describe('slugFor', () => {
  test('turns a title into a directory name', () => {
    expect(slugFor('Carpet Markets')).toBe('carpet-markets')
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

describe('projectFrom', () => {
  test('completes the one answer, and asks for no currency', () => {
    const project = projectFrom('World of Wonder')

    expect(project).toEqual({ title: 'World of Wonder', slug: 'world-of-wonder' })
    expect(Object.keys(project)).toEqual(['title', 'slug'])
  })

  test('asks again rather than guessing', () => {
    expect(() => projectFrom('   ')).toThrow(HarnessError)
    expect(() => projectFrom('')).toThrow(/project needs a name/)
  })
})
