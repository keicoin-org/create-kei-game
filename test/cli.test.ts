import { describe, expect, test } from 'bun:test'

import { DEFAULT_SOURCE, helpText, parseArgs, selectionFrom, type CliOptions } from '../src/cli.js'
import { HarnessError } from '../src/errors.js'

/** The whole command line, from argv to a selection, which is how it is used. */
function selectFor(argv: readonly string[]) {
  return selectionFrom(parseArgs(argv))
}

describe('parseArgs', () => {
  test('takes the project name as the first positional', () => {
    expect(parseArgs(['carpet-markets']).name).toBe('carpet-markets')
  })

  test('reads every valued flag in both spellings', () => {
    const spaced = parseArgs(['--source', 'repository', '--from', 'https://github.com/a/b', '--into', './x'])
    const joined = parseArgs(['--source=repository', '--from=https://github.com/a/b', '--into=./x'])

    expect(spaced.source).toBe('repository')
    expect(spaced.from).toBe('https://github.com/a/b')
    expect(spaced.into).toBe('./x')
    expect(joined).toEqual({ ...spaced })
  })

  test('reads the boolean flags', () => {
    const options = parseArgs(['--yes', '--force'])
    expect(options.yes).toBe(true)
    expect(options.force).toBe(true)
    expect(parseArgs(['-y']).yes).toBe(true)
  })

  test('keeps help and version', () => {
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['-h']).help).toBe(true)
    expect(parseArgs(['--version']).version).toBe(true)
    expect(parseArgs(['-v']).version).toBe(true)
  })

  test('refuses a source that is not one of the four', () => {
    expect(() => parseArgs(['--source', 'tarball'])).toThrow(HarnessError)
    expect(() => parseArgs(['--source', 'tarball'])).toThrow(/blank, template, local, repository/)
  })

  test('accepts the four sources, in any casing', () => {
    for (const source of ['blank', 'template', 'local', 'repository']) {
      expect(parseArgs(['--source', source.toUpperCase()]).source).toBe(source as CliOptions['source'])
    }
  })

  test('refuses a valued flag with nothing after it', () => {
    expect(() => parseArgs(['--from'])).toThrow(/--from needs a value/)
    expect(() => parseArgs(['--template', '--yes'])).toThrow(/--template needs a value/)
  })

  test('refuses the same valued flag twice', () => {
    expect(() => parseArgs(['--from', 'a', '--from', 'b'])).toThrow(/given twice/)
  })

  test('refuses two project names and an unknown option', () => {
    expect(() => parseArgs(['one', 'two'])).toThrow(/Two project names/)
    expect(() => parseArgs(['--colour'])).toThrow(/not an option/)
  })
})

describe('selectionFrom', () => {
  test('blank, spelled out', () => {
    expect(selectFor(['--source', 'blank'])).toEqual({ kind: 'blank' })
  })

  test('--template implies the template source and normalises the name', () => {
    expect(selectFor(['--template', 'button'])).toEqual({ kind: 'template', template: 'button' })
    expect(selectFor(['--template', 'World of Wonder'])).toEqual({ kind: 'template', template: 'world-of-wonder' })
    expect(selectFor(['--source', 'template', '--template', 'carpet-markets'])).toEqual({
      kind: 'template',
      template: 'carpet-markets',
    })
  })

  test('refuses a template that does not exist, before anything is asked', () => {
    expect(() => selectFor(['--template', 'not-a-game'])).toThrow(/no template called/)
  })

  test('local and repository take their answer from --from', () => {
    expect(selectFor(['--source', 'local', '--from', '../game'])).toEqual({ kind: 'existing', path: '../game' })
    expect(selectFor(['--source', 'repository', '--from', 'https://gitlab.com/a/b'])).toEqual({
      kind: 'repository',
      url: 'https://gitlab.com/a/b',
    })
  })

  test('--from alone infers repository from a URL and local from a path', () => {
    expect(selectFor(['--from', 'https://github.com/a/b.git'])).toEqual({
      kind: 'repository',
      url: 'https://github.com/a/b.git',
    })
    expect(selectFor(['--from', './next-door'])).toEqual({ kind: 'existing', path: './next-door' })
  })

  test('--template belongs to no other source', () => {
    for (const source of ['blank', 'local', 'repository']) {
      expect(() => selectFor(['--source', source, '--template', 'button'])).toThrow(HarnessError)
      expect(() => selectFor(['--source', source, '--template', 'button'])).toThrow(/--template/)
    }
  })

  test('--from belongs to neither blank nor template', () => {
    expect(() => selectFor(['--source', 'blank', '--from', './x'])).toThrow(/nothing for --from to point at/)
    expect(() => selectFor(['--source', 'template', '--from', './x'])).toThrow(/--source repository/)
  })

  test('--from and --template together are two answers to one question', () => {
    expect(() => selectFor(['--from', './x', '--template', 'button'])).toThrow(/two answers to the same question/)
  })

  test('a source that needs a detail refuses to run without it', () => {
    expect(() => selectFor(['--source', 'template'])).toThrow(/needs --template/)
    expect(() => selectFor(['--source', 'local'])).toThrow(/needs --from/)
    expect(() => selectFor(['--source', 'repository'])).toThrow(/needs --from/)
  })

  test('an incomplete source is still refused under --yes', () => {
    expect(() => selectFor(['--yes', '--source', 'repository'])).toThrow(/needs --from/)
  })

  test('no source at all is a question when interactive and blank under --yes', () => {
    expect(selectFor([])).toBeNull()
    expect(selectFor(['my-game'])).toBeNull()
    expect(selectFor(['--yes'])).toEqual({ kind: DEFAULT_SOURCE })
    expect(selectFor(['--yes'])).toEqual({ kind: 'blank' })
  })

  test('--into and --force say nothing about the source', () => {
    expect(selectFor(['--yes', '--into', './somewhere', '--force'])).toEqual({ kind: 'blank' })
  })
})

describe('helpText', () => {
  const help = helpText('9.9.9')

  test('names the version, the four sources, and every stable flag', () => {
    expect(help).toContain('create-kei-game 9.9.9')
    for (const source of ['blank', 'template', 'local', 'repository']) expect(help).toContain(source)
    for (const flag of ['--source', '--template', '--from', '--into', '--force', '--yes', '--help', '--version']) {
      expect(help).toContain(flag)
    }
  })

  test('names the three templates and nothing that was deleted', () => {
    expect(help).toContain('button')
    expect(help).toContain('world-of-wonder')
    expect(help).toContain('carpet-markets')
    expect(help.toLowerCase()).not.toContain('star-clicker')
    expect(help.toLowerCase()).not.toContain('starclicker')
    expect(help.toLowerCase()).not.toContain('--currency')
  })

  test('says what it does not do yet rather than implying it does', () => {
    expect(help).toContain('stops there')
    expect(help).toContain('AI provider')
    expect(help).toContain('M9')
  })
})
