/**
 * What gets asked, in what order, and — more often — that nothing gets asked.
 *
 * The asker is an argument, so all of this runs with no terminal attached and
 * records the questions instead of printing them. The thing it is most useful
 * for proving is a negative: no question here is about a template, a
 * repository, or any other starting point.
 */

import { describe, expect, test } from 'bun:test'

import { parseArgs } from '../src/cli.js'
import { HarnessError } from '../src/errors.js'
import {
  API_KEY_ENV_QUESTION,
  ART_QUESTION,
  BASE_URL_QUESTION,
  DIMENSION_QUESTION,
  ECONOMY_QUESTION,
  GAMEPLAY_QUESTION,
  MODEL_QUESTION,
  NAME_QUESTION,
  NETWORK_QUESTION,
  PROTOCOL_QUESTION,
  PROVIDER_QUESTION,
  WORLD_QUESTION,
  createAsker,
  harnessNeedsAsker,
  intentFromOptions,
  intentNeedsAsker,
  onboardHarness,
  onboardIntent,
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

const INTENT_QUESTIONS = [
  NAME_QUESTION,
  DIMENSION_QUESTION,
  GAMEPLAY_QUESTION,
  WORLD_QUESTION,
  ART_QUESTION,
  NETWORK_QUESTION,
  ECONOMY_QUESTION,
]

async function runIntent(argv: readonly string[], answers: readonly string[]) {
  const asker = new ScriptedAsker(answers)
  const intent = await onboardIntent(parseArgs(argv), asker)
  return { intent, asked: asker.asked, fallbacks: asker.fallbacks }
}

describe('the order of the questions', () => {
  test('name, dimension, then the five goals, and nothing else', async () => {
    const result = await runIntent(
      [],
      ['My MMO', '3d', 'Classes and questing', 'One shard', 'Low poly', '200 a shard', 'One currency'],
    )

    expect(result.asked).toEqual(INTENT_QUESTIONS)
    expect(result.intent).toEqual({
      intentVersion: 1,
      name: 'My MMO',
      dimension: '3d',
      gameplay: 'Classes and questing',
      world: 'One shard',
      art: 'Low poly',
      network: '200 a shard',
      economy: 'One currency',
    })
  })

  test('nothing is asked about a template, a repository, or a starting point', async () => {
    const result = await runIntent([], ['g', '', 'Questing', '', '', '', ''])
    for (const question of result.asked) {
      const lower = question.toLowerCase()
      expect(lower).not.toContain('template')
      expect(lower).not.toContain('repository')
      expect(lower).not.toContain('start from')
      expect(lower).not.toContain('currency?')
    }
  })

  test('the dimension is chosen by number as well as by name', async () => {
    const goals = ['Questing', '', '', '', '']
    expect((await runIntent([], ['g', '1', ...goals])).intent.dimension).toBe('2d')
    expect((await runIntent([], ['g', '2', ...goals])).intent.dimension).toBe('3d')
    expect((await runIntent([], ['g', '3', ...goals])).intent.dimension).toBe('auto')
    expect((await runIntent([], ['g', '2d', ...goals])).intent.dimension).toBe('2d')
  })

  test('an empty line takes the offered default, and the optional goals stay empty', async () => {
    const result = await runIntent([], ['', '', 'Questing', '', '', '', ''])
    expect(result.intent.name).toBe('kei-mmo')
    expect(result.intent.dimension).toBe('auto')
    expect(result.intent.world).toBe('')
    expect(result.fallbacks).toEqual([
      'kei-mmo', 'auto', undefined, undefined, undefined, undefined, undefined,
    ])
  })

  test('a dimension that is not one of the three is refused, not guessed at', async () => {
    await expect(runIntent([], ['g', 'holographic'])).rejects.toThrow(HarnessError)
    await expect(runIntent([], ['g', 'holographic'])).rejects.toThrow(/not one of the three/)
  })

  test('gameplay is the one goal with no default to fall back to', async () => {
    await expect(runIntent([], ['g', 'auto', ''])).rejects.toThrow(/no sensible default/)
  })
})

describe('what the flags already answered is not asked again', () => {
  test('a name on the command line skips the name question', async () => {
    const result = await runIntent(['my-mmo'], ['3d', 'Questing', '', '', '', ''])
    expect(result.asked[0]).toBe(DIMENSION_QUESTION)
    expect(result.intent.name).toBe('my-mmo')
  })

  test('a complete command line asks nothing at all', async () => {
    const asker = new ScriptedAsker([])
    const options = parseArgs([
      'my-mmo', '--3d', '--gameplay', 'Questing', '--world', 'w', '--art', 'a',
      '--network', 'n', '--economy', 'e',
    ])
    expect(intentNeedsAsker(options)).toBeFalse()
    const intent = await onboardIntent(options, asker)
    expect(asker.asked).toEqual([])
    expect(intent.name).toBe('my-mmo')
  })

  test('only name and gameplay decide whether the intent needs asking', () => {
    expect(intentNeedsAsker(parseArgs(['g']))).toBeTrue()
    expect(intentNeedsAsker(parseArgs(['g', '--gameplay', 'x']))).toBeFalse()
    expect(intentNeedsAsker(parseArgs(['--gameplay', 'x']))).toBeTrue()
    expect(intentNeedsAsker(parseArgs(['--yes']))).toBeFalse()
  })

  test('intentFromOptions asks nothing and fills the rest with the planner default', () => {
    const intent = intentFromOptions(parseArgs(['Named', '--gameplay', 'Questing']))
    expect(intent).toMatchObject({ name: 'Named', dimension: 'auto', world: '', economy: '' })
  })
})

describe('with nothing to type into', () => {
  test('createAsker fails with a sentence naming the way out, and does not hang', () => {
    const wasTTY = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    try {
      expect(() => createAsker()).toThrow(HarnessError)
      expect(() => createAsker()).toThrow(/--plan-only/)
      expect(() => createAsker()).toThrow(/nothing to type into/)
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: wasTTY, configurable: true })
    }
  })
})

async function runHarness(argv: readonly string[], answers: readonly string[]) {
  const asker = new ScriptedAsker(answers)
  const result = await onboardHarness(parseArgs(argv), asker)
  return { ...result, asked: asker.asked, fallbacks: asker.fallbacks }
}

const GOALS_GIVEN = ['--gameplay', 'Questing', '--world', 'w', '--art', 'a', '--network', 'n', '--economy', 'e']

describe('full interactive harness onboarding', () => {
  test('asks the complete stable order and offers the built-in env reference', async () => {
    const result = await runHarness(
      [],
      ['My MMO', '3d', 'Questing', '', '', '', '', 'anthropic', 'explicit-model', ''],
    )
    expect(result.asked).toEqual([
      ...INTENT_QUESTIONS,
      PROVIDER_QUESTION,
      MODEL_QUESTION,
      API_KEY_ENV_QUESTION,
    ])
    expect(result.fallbacks.slice(-3)).toEqual([undefined, undefined, 'ANTHROPIC_API_KEY'])
    expect(result.provider).toEqual({ provider: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' })
    expect(result.model).toBe('explicit-model')
    expect(result.intent.gameplay).toBe('Questing')
    expect(result.launch).toBeTrue()
  })

  test('asks Qwen base URL only after model and env reference', async () => {
    const result = await runHarness(
      ['qwen-mmo', '--3d', ...GOALS_GIVEN],
      ['qwen', 'qwen-explicit', '', 'https://qwen.example/v1'],
    )
    expect(result.asked).toEqual([
      PROVIDER_QUESTION,
      MODEL_QUESTION,
      API_KEY_ENV_QUESTION,
      BASE_URL_QUESTION,
    ])
    expect(result.provider).toEqual({
      provider: 'qwen',
      apiKeyEnv: 'DASHSCOPE_API_KEY',
      baseUrl: 'https://qwen.example/v1',
    })
  })

  test('asks custom base URL then protocol after the env reference', async () => {
    const result = await runHarness(
      ['custom-mmo', '--3d', ...GOALS_GIVEN],
      ['custom', 'model-id', 'CUSTOM_KEY', 'https://custom.example/v1', 'messages'],
    )
    expect(result.asked).toEqual([
      PROVIDER_QUESTION,
      MODEL_QUESTION,
      API_KEY_ENV_QUESTION,
      BASE_URL_QUESTION,
      PROTOCOL_QUESTION,
    ])
    expect(result.provider).toEqual({
      provider: 'custom',
      apiKeyEnv: 'CUSTOM_KEY',
      baseUrl: 'https://custom.example/v1',
      protocol: 'messages',
    })
  })

  test('an answered intent still continues into the provider questions', async () => {
    const result = await runHarness(['ready', '--2d', ...GOALS_GIVEN], ['openai', 'model-id', ''])
    expect(result.asked).toEqual([PROVIDER_QUESTION, MODEL_QUESTION, API_KEY_ENV_QUESTION])
    expect(result.provider.apiKeyEnv).toBe('OPENAI_API_KEY')
  })

  test('flags skip answered provider questions without changing the intent order', async () => {
    const options = {
      ...parseArgs(['ready', '--3d', ...GOALS_GIVEN]),
      provider: 'custom',
      model: 'model-id',
      apiKeyEnv: 'CUSTOM_KEY',
      baseUrl: 'https://custom.example/v1',
      protocol: 'responses',
    }
    expect(harnessNeedsAsker(options)).toBeFalse()
    const asker = new ScriptedAsker([])
    const result = await onboardHarness(options, asker)
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
      ...parseArgs(['ready', '--3d', ...GOALS_GIVEN]),
      provider: label,
      model: 'model-id',
      apiKeyEnv: 'MODEL_KEY',
      baseUrl: id === 'qwen' || id === 'custom' ? 'https://models.example/v1' : undefined,
      protocol: id === 'custom' ? 'chat_completions' : undefined,
    }
    const result = await onboardHarness(options, new ScriptedAsker([]))
    expect(result.provider.provider).toBe(id)
  })

  test('blank required answers fail instead of becoming hidden defaults', async () => {
    await expect(
      runHarness(['ready', '--3d', ...GOALS_GIVEN], ['openai', '', 'OPENAI_API_KEY']),
    ).rejects.toThrow(/exact model ID/)
  })

  test('questions never ask for a raw key, a currency, or Grok', async () => {
    const result = await runHarness(['ready', '--3d', ...GOALS_GIVEN], ['openai', 'model-id', ''])
    for (const question of result.asked) {
      const lower = question.toLowerCase()
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
        await runHarness(['ready', '--3d', ...GOALS_GIVEN], answers)
        throw new Error('expected invalid interactive answer')
      } catch (error) {
        expect(String(error)).not.toContain(pastedSecret)
        expect(JSON.stringify(error)).not.toContain(pastedSecret)
      }
    }
  })

  test('--yes never enters interactive provider onboarding', async () => {
    const asker = new ScriptedAsker([])
    await expect(onboardHarness(parseArgs(['--yes']), asker)).rejects.toThrow(
      /plans and scaffolds without asking anything/,
    )
    expect(asker.asked).toEqual([])
  })
})
