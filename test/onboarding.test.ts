/**
 * What gets asked, in what order, and — more often — that nothing gets asked.
 *
 * The asker is an argument, so all of this runs with no terminal attached and
 * records the questions instead of printing them.
 */

import { describe, expect, test } from 'bun:test'

import { parseArgs, selectionFrom } from '../src/cli.js'
import { HarnessError } from '../src/errors.js'
import {
  API_KEY_ENV_QUESTION,
  BASE_URL_QUESTION,
  BRIEF_QUESTION,
  MODEL_QUESTION,
  NAME_QUESTION,
  PROTOCOL_QUESTION,
  PROVIDER_QUESTION,
  SOURCE_QUESTION,
  createAsker,
  onboard,
  onboardHarness,
  type Asker,
} from '../src/prompt.js'

class ScriptedAsker implements Asker {
  readonly asked: string[] = []
  readonly fallbacks: (string | undefined)[] = []
  closed = false
  private index = 0

  constructor(private readonly answers: readonly string[]) {}

  async ask(question: string, fallback?: string): Promise<string> {
    this.asked.push(question)
    this.fallbacks.push(fallback)
    const answer = this.answers[this.index++]
    if (answer === undefined) throw new Error(`Nothing scripted for question ${this.index}: ${question}`)
    return answer === '' && fallback !== undefined ? fallback : answer
  }

  close(): void {
    this.closed = true
  }
}

/** Exactly what the program does: parse, resolve the flags, then ask the rest. */
async function run(argv: readonly string[], answers: readonly string[]) {
  const options = parseArgs(argv)
  const asker = new ScriptedAsker(answers)
  const result = await onboard(options, selectionFrom(options), asker)
  return { ...result, asked: asker.asked, fallbacks: asker.fallbacks }
}

describe('the order of the questions', () => {
  test('name first, then source, and nothing else for a blank workspace', async () => {
    const result = await run([], ['My Game', 'blank'])

    expect(result.asked).toEqual([NAME_QUESTION, SOURCE_QUESTION])
    expect(result.name).toBe('My Game')
    expect(result.selection).toEqual({ kind: 'blank' })
  })

  test('the source question is second, never first', async () => {
    const result = await run([], ['My Game', 'template', 'button'])
    expect(result.asked[0]).toBe(NAME_QUESTION)
    expect(result.asked[1]).toBe(SOURCE_QUESTION)
  })

  test('only the detail the chosen source needs is asked, and only third', async () => {
    const template = await run([], ['g', 'template', 'world-of-wonder'])
    expect(template.asked).toEqual([NAME_QUESTION, SOURCE_QUESTION, 'Which one? button, world-of-wonder, carpet-markets'])
    expect(template.selection).toEqual({ kind: 'template', template: 'world-of-wonder' })

    const local = await run([], ['g', 'local', '../beside-it'])
    expect(local.asked).toEqual([NAME_QUESTION, SOURCE_QUESTION, 'Path to the project?'])
    expect(local.selection).toEqual({ kind: 'existing', path: '../beside-it' })

    const repository = await run([], ['g', 'repository', 'https://github.com/a/b'])
    expect(repository.asked).toEqual([NAME_QUESTION, SOURCE_QUESTION, 'Repository URL?'])
    expect(repository.selection).toEqual({ kind: 'repository', url: 'https://github.com/a/b' })
  })

  test('nothing is asked about a currency', async () => {
    const result = await run([], ['g', 'blank'])
    for (const question of result.asked) expect(question.toLowerCase()).not.toContain('currency')
  })

  test('the source is chosen by number as well as by name', async () => {
    expect((await run([], ['g', '1'])).selection).toEqual({ kind: 'blank' })
    expect((await run([], ['g', '2', 'button'])).selection).toEqual({ kind: 'template', template: 'button' })
    expect((await run([], ['g', '3', './x'])).selection).toEqual({ kind: 'existing', path: './x' })
    expect((await run([], ['g', '4', 'https://github.com/a/b'])).selection).toEqual({
      kind: 'repository',
      url: 'https://github.com/a/b',
    })
  })

  test('an empty line takes the offered default', async () => {
    const result = await run([], ['', ''])
    expect(result.name).toBe('kei-game')
    expect(result.selection).toEqual({ kind: 'blank' })
    expect(result.fallbacks).toEqual(['kei-game', 'blank'])
  })

  test('a source that is not one of the four is refused, not guessed at', async () => {
    await expect(run([], ['g', 'tarball'])).rejects.toThrow(HarnessError)
    await expect(run([], ['g', 'tarball'])).rejects.toThrow(/not one of the four/)
  })

  test('a detail with no default is refused when left empty', async () => {
    await expect(run([], ['g', 'local', ''])).rejects.toThrow(/no sensible default/)
    await expect(run([], ['g', 'repository', ''])).rejects.toThrow(/no sensible default/)
  })
})

describe('what the flags already answered is not asked again', () => {
  test('a name on the command line skips the name question', async () => {
    const result = await run(['my-game'], ['blank'])
    expect(result.asked).toEqual([SOURCE_QUESTION])
    expect(result.name).toBe('my-game')
  })

  test('a complete command line asks nothing at all', async () => {
    const asker = new ScriptedAsker([])
    const options = parseArgs(['my-game', '--template', 'button'])
    const result = await onboard(options, selectionFrom(options), asker)

    expect(asker.asked).toEqual([])
    expect(result).toEqual({ name: 'my-game', selection: { kind: 'template', template: 'button' } })
  })

  test('--yes asks nothing, for any source', async () => {
    for (const argv of [['--yes'], ['--yes', 'named'], ['--yes', '--source', 'local', '--from', './x']]) {
      const asker = new ScriptedAsker([])
      const options = parseArgs(argv)
      await onboard(options, selectionFrom(options), asker)
      expect(asker.asked).toEqual([])
    }
  })
})

describe('with nothing to type into', () => {
  test('createAsker fails with a sentence naming the way out, and does not hang', () => {
    const wasTTY = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    try {
      expect(() => createAsker()).toThrow(HarnessError)
      expect(() => createAsker()).toThrow(/--yes/)
      expect(() => createAsker()).toThrow(/nothing to type into/)
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: wasTTY, configurable: true })
    }
  })
})

async function runHarness(argv: readonly string[], answers: readonly string[]) {
  const options = parseArgs(argv)
  const asker = new ScriptedAsker(answers)
  const result = await onboardHarness(options, selectionFrom(options), asker)
  return { ...result, asked: asker.asked, fallbacks: asker.fallbacks }
}

describe('full interactive harness onboarding', () => {
  test('asks the complete stable order and offers the built-in env reference', async () => {
    const result = await runHarness(
      [],
      ['My Game', 'blank', 'anthropic', 'explicit-model', '', 'Build an adventure.'],
    )
    expect(result.asked).toEqual([
      NAME_QUESTION,
      SOURCE_QUESTION,
      PROVIDER_QUESTION,
      MODEL_QUESTION,
      API_KEY_ENV_QUESTION,
      BRIEF_QUESTION,
    ])
    expect(result.fallbacks).toEqual([
      'kei-game', 'blank', undefined, undefined, 'ANTHROPIC_API_KEY', undefined,
    ])
    expect(result.provider).toEqual({
      provider: 'anthropic',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
    })
    expect(result.model).toBe('explicit-model')
    expect(result.brief).toBe('Build an adventure.')
    expect(result.launch).toBeTrue()
  })

  test('asks Qwen base URL only after model and env reference', async () => {
    const result = await runHarness(
      ['qwen-game', '--source', 'blank'],
      ['qwen', 'qwen-explicit', '', 'https://qwen.example/v1', 'Build it.'],
    )
    expect(result.asked).toEqual([
      PROVIDER_QUESTION,
      MODEL_QUESTION,
      API_KEY_ENV_QUESTION,
      BASE_URL_QUESTION,
      BRIEF_QUESTION,
    ])
    expect(result.provider).toEqual({
      provider: 'qwen',
      apiKeyEnv: 'DASHSCOPE_API_KEY',
      baseUrl: 'https://qwen.example/v1',
    })
  })

  test('asks custom base URL then protocol after the env reference', async () => {
    const result = await runHarness(
      ['custom-game', '--source', 'blank'],
      ['custom', 'model-id', 'CUSTOM_KEY', 'https://custom.example/v1', 'messages', 'Build it.'],
    )
    expect(result.asked).toEqual([
      PROVIDER_QUESTION,
      MODEL_QUESTION,
      API_KEY_ENV_QUESTION,
      BASE_URL_QUESTION,
      PROTOCOL_QUESTION,
      BRIEF_QUESTION,
    ])
    expect(result.provider).toEqual({
      provider: 'custom',
      apiKeyEnv: 'CUSTOM_KEY',
      baseUrl: 'https://custom.example/v1',
      protocol: 'messages',
    })
  })

  test('complete name/source still continues into provider questions', async () => {
    const result = await runHarness(
      ['ready', '--source', 'blank'],
      ['openai', 'model-id', '', 'Build it.'],
    )
    expect(result.asked).toEqual([
      PROVIDER_QUESTION, MODEL_QUESTION, API_KEY_ENV_QUESTION, BRIEF_QUESTION,
    ])
    expect(result.provider.apiKeyEnv).toBe('OPENAI_API_KEY')
  })

  test('flags skip answered provider questions without changing source order', async () => {
    const options = {
      ...parseArgs(['ready', '--source', 'blank']),
      provider: 'custom',
      model: 'model-id',
      apiKeyEnv: 'CUSTOM_KEY',
      baseUrl: 'https://custom.example/v1',
      protocol: 'responses',
      brief: 'Build it.',
    }
    const asker = new ScriptedAsker([])
    const result = await onboardHarness(options, selectionFrom(options), asker)
    expect(asker.asked).toEqual([])
    expect(result.provider.protocol).toBe('responses')
  })

  test.each([
    ['Anthropic', 'anthropic'],
    ['OpenAI', 'openai'],
    ['Z.ai', 'zai'],
    ['Qwen / DashScope', 'qwen'],
    ['DeepSeek', 'deepseek'],
    ['OpenRouter', 'openrouter'],
    ['Custom provider', 'custom'],
  ])('accepts provider label %s', async (label, id) => {
    const options = {
      ...parseArgs(['ready', '--source', 'blank']),
      provider: label,
      model: 'model-id',
      apiKeyEnv: 'MODEL_KEY',
      baseUrl: id === 'qwen' || id === 'custom' ? 'https://models.example/v1' : undefined,
      protocol: id === 'custom' ? 'chat_completions' : undefined,
      brief: 'Build it.',
    }
    const result = await onboardHarness(options, selectionFrom(options), new ScriptedAsker([]))
    expect(result.provider.provider).toBe(id)
  })

  test('blank required answers fail instead of becoming hidden defaults', async () => {
    await expect(
      runHarness(['ready', '--source', 'blank'], ['openai', '', 'OPENAI_API_KEY', 'Build it.']),
    ).rejects.toThrow(/exact model ID/)
  })

  test('questions never ask for a raw key, currency, or Grok', async () => {
    const result = await runHarness(
      ['ready', '--source', 'blank'],
      ['openai', 'model-id', '', 'Build it.'],
    )
    for (const question of result.asked) {
      const lower = question.toLowerCase()
      expect(lower).not.toContain('currency')
      expect(lower).not.toContain('grok')
      if (lower.includes('api key')) expect(lower).toContain('environment variable name')
    }
  })

  test('invalid provider and protocol answers are never reflected into errors', async () => {
    const pastedSecret = 'sk-accidentally-pasted-here'
    for (const answers of [
      [pastedSecret],
      ['custom', 'model-id', 'CUSTOM_KEY', 'https://custom.example/v1', pastedSecret],
    ]) {
      try {
        await runHarness(['ready', '--source', 'blank'], answers)
        throw new Error('expected invalid interactive answer')
      } catch (error) {
        expect(String(error)).not.toContain(pastedSecret)
        expect(JSON.stringify(error)).not.toContain(pastedSecret)
      }
    }
  })

  test('--yes never enters interactive provider onboarding', async () => {
    const options = parseArgs(['--yes'])
    const asker = new ScriptedAsker([])
    await expect(onboardHarness(options, selectionFrom(options), asker)).rejects.toThrow(
      /prepares the project without asking anything/,
    )
    expect(asker.asked).toEqual([])
  })
})
