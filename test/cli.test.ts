import { describe, expect, test } from 'bun:test'

import { DEFAULT_DIMENSION, helpText, parseArgs } from '../src/cli.js'
import { HarnessError } from '../src/errors.js'

describe('parseArgs', () => {
  test('takes the project name as the first positional', () => {
    expect(parseArgs(['salvage-run']).name).toBe('salvage-run')
  })

  test('reads every valued flag in both spellings', () => {
    const spaced = parseArgs([
      '--agent', '--dimension', '3d', '--gameplay', 'Questing', '--world', 'One shard',
      '--art', 'Low poly', '--network', '200 a shard', '--economy', 'One currency',
      '--into', './x', '--agent-config', 'agent.json', '--provider', 'custom', '--model', 'model-id',
      '--api-key-env', 'MODEL_KEY', '--base-url', 'https://models.example/v1', '--protocol', 'messages',
    ])
    const joined = parseArgs([
      '--agent', '--dimension=3d', '--gameplay=Questing', '--world=One shard',
      '--art=Low poly', '--network=200 a shard', '--economy=One currency',
      '--into=./x', '--agent-config=agent.json', '--provider=custom', '--model=model-id',
      '--api-key-env=MODEL_KEY', '--base-url=https://models.example/v1', '--protocol=messages',
    ])

    expect(spaced.dimension).toBe('3d')
    expect(spaced.gameplay).toBe('Questing')
    expect(spaced.economy).toBe('One currency')
    expect(joined).toEqual({ ...spaced })
  })

  test('reads the boolean flags', () => {
    const options = parseArgs(['--yes', '--force'])
    expect(options.yes).toBe(true)
    expect(options.force).toBe(true)
    expect(parseArgs(['-y']).yes).toBe(true)
    expect(parseArgs(['--agent', '--json', '--no-launch', '--plan-only'])).toMatchObject({
      agent: true,
      json: true,
      launch: false,
      planOnly: true,
    })
    expect(parseArgs(['--agent', '--agent-config', '-']).agentConfig).toBe('-')
  })

  test('--2d and --3d are the dimension flag, said shorter', () => {
    expect(parseArgs(['--2d']).dimension).toBe('2d')
    expect(parseArgs(['--3d']).dimension).toBe('3d')
    expect(parseArgs(['--3d', '--dimension', '3d']).dimension).toBe('3d')
    expect(() => parseArgs(['--2d', '--3d'])).toThrow(/given twice/)
    expect(() => parseArgs(['--dimension', 'holographic'])).toThrow(/is not a dimension/)
  })

  test('--brief is the compatibility spelling of --gameplay', () => {
    expect(parseArgs(['--brief', 'Questing']).gameplay).toBe('Questing')
    expect(() => parseArgs(['--gameplay', 'a', '--brief', 'b'])).toThrow(/two spellings of one field/)
  })

  test('the three starting-point flags are refused by name, not ignored', () => {
    for (const argv of [
      ['--source', 'blank'],
      ['--source=template'],
      ['--template', 'button'],
      ['--from', 'https://github.com/a/b'],
    ]) {
      expect(() => parseArgs(argv)).toThrow(HarnessError)
    }
    expect(() => parseArgs(['--source', 'blank'])).toThrow(/harness decides/)
    expect(() => parseArgs(['--template', 'button'])).toThrow(/chosen by the planner/)
    expect(() => parseArgs(['--from', './x'])).toThrow(/no source to point at/)
  })

  test('keeps --agent distinct from --yes and owns its options', () => {
    expect(() => parseArgs(['--agent', '--yes'])).toThrow(/different no-prompt modes/)
    expect(() => parseArgs(['--json'])).toThrow(/require --agent/)
    expect(parseArgs(['--provider', 'openai']).provider).toBe('openai')
    expect(() => parseArgs(['--agent-config', 'agent.json'])).toThrow(/require --agent/)
  })

  test('--plan-only needs neither --agent nor a provider', () => {
    expect(parseArgs(['--plan-only']).planOnly).toBe(true)
    expect(parseArgs(['--plan-only']).agent).toBe(false)
  })

  test('keeps help and version', () => {
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['-h']).help).toBe(true)
    expect(parseArgs(['--version']).version).toBe(true)
    expect(parseArgs(['-v']).version).toBe(true)
  })

  test('refuses a valued flag with nothing after it', () => {
    expect(() => parseArgs(['--gameplay'])).toThrow(/--gameplay needs a value/)
    expect(() => parseArgs(['--world', '--yes'])).toThrow(/--world needs a value/)
  })

  test('refuses the same valued flag twice', () => {
    expect(() => parseArgs(['--world', 'a', '--world', 'b'])).toThrow(/given twice/)
  })

  test('refuses two project names and an unknown option', () => {
    expect(() => parseArgs(['one', 'two'])).toThrow(/Two project names/)
    expect(() => parseArgs(['--colour'])).toThrow(/not an option/)
  })

  test('the default dimension is the one that infers itself', () => {
    expect(DEFAULT_DIMENSION).toBe('auto')
    expect(parseArgs([]).dimension).toBeUndefined()
  })
})

describe('helpText', () => {
  const help = helpText('9.9.9')

  test('names the version and every stable flag', () => {
    expect(help).toContain('create-kei-mmo 9.9.9')
    for (const flag of [
      '--dimension', '--2d', '--3d', '--gameplay', '--world', '--art', '--network', '--economy',
      '--brief', '--into', '--force', '--plan-only', '--yes', '--agent', '--agent-config',
      '--json', '--provider', '--model', '--api-key-env', '--base-url', '--protocol',
      '--no-launch', '--help', '--version',
    ]) {
      expect(help).toContain(flag)
    }
  })

  test('does not offer an npm name as the way to run this program', () => {
    // `npm create kei-game` installs the superseded 0.2.0 scaffolder published
    // from kei-transaction, and create-kei-mmo is not published at all. The
    // names may only appear in the disclaimer that says so.
    const usage = help.slice(help.indexOf('Usage'), help.indexOf('What you describe'))
    expect(usage).toContain('bun run src/index.ts --')
    expect(usage).not.toMatch(/^\s*npm create/m)
    expect(help).toContain('reaches this program')
  })

  test('offers no starting point to choose, and says who chooses instead', () => {
    expect(help).not.toContain('--source')
    expect(help).not.toContain('--template')
    expect(help).not.toContain('--from ')
    expect(help.toLowerCase()).not.toContain('star-clicker')
    expect(help.toLowerCase()).not.toContain('--currency')
    expect(help).toContain('reference project is cloned and which one')
  })

  test('says what it does not do yet rather than implying it does', () => {
    expect(help).toContain('turn runs per invocation')
    expect(help).toContain('long-running Kei terminal interface is later M9')
    expect(help).not.toContain('stops there')
    expect(help).not.toContain('reported as pending')
  })
})
