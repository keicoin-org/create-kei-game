/**
 * The questions, in the one order they are asked: what it is called, whether it
 * is flat or solid, and then the five goals — and only after those, the model
 * provider that will build it.
 *
 * None of them is about a template, a repository, or a starting point. That was
 * the first question this program used to ask, and it was the wrong one: it
 * made somebody choose between three projects they had not read, before they
 * had said a single thing about the game they wanted. The planner answers it
 * now, from the answers below, and writes down why.
 *
 * Four of the five goals can be left blank. A blank one is not a gap the
 * harness hides — the plan records what it assumed instead, in the same file.
 *
 * Deliberately not a dependency: a harness that pulls in a prompt library, a
 * colour library, and a spinner is three supply-chain risks for a program that
 * runs once. `readline` is in the runtime already.
 */

import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

import { DEFAULT_NAME, type CliOptions } from './cli.js'
import { fail } from './errors.js'
import {
  MMO_DIMENSIONS,
  MMO_INTENT_VERSION,
  parseMmoIntent,
  type MmoDimension,
  type MmoIntent,
} from './intent.js'
import {
  PROVIDERS,
  PROVIDER_PROTOCOLS,
  type ProviderDefinition,
  type ProviderInput,
} from './providers.js'

export interface Asker {
  /** The answer, trimmed. An empty line means the fallback, when there is one. */
  ask(question: string, fallback?: string): Promise<string>
  close(): void
}

export type AskerFactory = () => Asker

export function createAsker(): Asker {
  if (!stdin.isTTY) {
    fail(
      'There is nothing to type into here, so the questions cannot be asked and this will not guess at them. To see what it would plan, pass create-kei-mmo <project> --gameplay "..." --plan-only. To plan and scaffold without a provider, pass --yes. For a full run, also pass --provider, --model, and --api-key-env.',
    )
  }

  // Bun's ambient stdin iterator currently differs from @types/node's stream
  // iterator even though this is the same Node-compatible runtime object.
  const readline = createInterface({
    input: stdin as unknown as import('node:stream').Readable,
    output: stdout as unknown as import('node:stream').Writable,
  })
  return {
    async ask(question, fallback) {
      const asked = fallback === undefined ? `  ${question} ` : `  ${question} (${fallback}) `
      const answer = (await readline.question(asked)).trim()
      if (answer === '' && fallback !== undefined) return fallback
      return answer
    },
    close() {
      readline.close()
    },
  }
}

export const NAME_QUESTION = 'Project name?'
export const DIMENSION_QUESTION =
  'Flat or solid? 1) 2d  2) 3d  3) auto — auto reads it out of what you describe next'
export const GAMEPLAY_QUESTION =
  'What do players do? Classes, combat, quests, crafting, progression — the minute-to-minute.'
export const WORLD_QUESTION =
  'The world: size, regions, persistence, how much stays loaded. Blank leaves it to the planner.'
export const ART_QUESTION =
  'How it should look: style, palette, camera, lighting. Blank leaves it to the planner.'
export const NETWORK_QUESTION =
  'Sessions and authority: players per shard, latency budget, what the server owns. Blank leaves it to the planner.'
export const ECONOMY_QUESTION =
  'The Kei economy: currencies, items, trade, sinks. Blank leaves it to the planner.'

export const PROVIDER_QUESTION = `Which provider? ${PROVIDERS.map(({ id, label }) => `${id} (${label})`).join(', ')}`
export const MODEL_QUESTION = 'Which model? Give the exact model ID — there is no default.'
export const API_KEY_ENV_QUESTION =
  'Name of the environment variable to read at run time? The name only — nothing secret is typed here.'
export const BASE_URL_QUESTION = 'HTTPS base URL for this provider?'
export const PROTOCOL_QUESTION = `Which protocol? ${PROVIDER_PROTOCOLS.join(', ')}`

/** What `--yes` builds with when nobody said. Reported, never hidden. */
export const DEFAULT_YES_GAMEPLAY =
  'A persistent multiplayer world with characters, progression, and player-to-player trade.'

/** Whether the intent alone still has an answer left to ask for. */
export function intentNeedsAsker(options: CliOptions): boolean {
  if (options.yes) return false
  return options.name === undefined || options.gameplay === undefined
}

/** Whether a full run — intent plus provider — still has anything to ask for. */
export function harnessNeedsAsker(options: CliOptions): boolean {
  if (options.yes) return false
  if (intentNeedsAsker(options)) return true
  if (
    options.provider === undefined ||
    options.model === undefined ||
    options.apiKeyEnv === undefined
  ) return true

  const provider = providerNamed(options.provider)
  if (provider.baseUrl === undefined && options.baseUrl === undefined) return true
  if (provider.protocol === undefined && options.protocol === undefined) return true
  return false
}

function required(answer: string, wanted: string): string {
  if (answer.trim() === '') fail(`That needs ${wanted}, and there is no sensible default to fall back to.`)
  return answer
}

/**
 * The intent, from whatever the flags did not already say. A complete command
 * line asks nothing at all; the bare command asks seven things and then stops
 * asking, because everything after that is the planner's job.
 */
export async function onboardIntent(options: CliOptions, asker: Asker): Promise<MmoIntent> {
  // The optional goals are only asked for while there is already a
  // conversation. Once the two required answers are on the command line, this
  // stops talking — and the planner records what it assumed for the rest.
  if (!intentNeedsAsker(options)) return intentFromOptions(options)

  const name = options.name ?? (await asker.ask(NAME_QUESTION, DEFAULT_NAME))
  const dimension =
    options.dimension ?? dimensionNamed(await asker.ask(DIMENSION_QUESTION, 'auto'))
  const gameplay = required(
    options.gameplay ?? (await asker.ask(GAMEPLAY_QUESTION)),
    'a sentence about what players do',
  )

  return parseMmoIntent({
    intentVersion: MMO_INTENT_VERSION,
    name,
    dimension,
    gameplay,
    world: options.world ?? (await asker.ask(WORLD_QUESTION)),
    art: options.art ?? (await asker.ask(ART_QUESTION)),
    network: options.network ?? (await asker.ask(NETWORK_QUESTION)),
    economy: options.economy ?? (await asker.ask(ECONOMY_QUESTION)),
  })
}

/**
 * Whatever the flags said, with no questions asked and no provider involved.
 * `--yes` and `--plan-only` both come through here.
 */
export function intentFromOptions(
  options: CliOptions,
  fallbackGameplay?: string,
): MmoIntent {
  return parseMmoIntent({
    intentVersion: MMO_INTENT_VERSION,
    name: options.name ?? DEFAULT_NAME,
    dimension: options.dimension ?? 'auto',
    gameplay: options.gameplay ?? fallbackGameplay,
    world: options.world,
    art: options.art,
    network: options.network,
    economy: options.economy,
  })
}

/** Everything a run needs to become a request, with no key material in it. */
export interface InteractiveOnboarding {
  readonly intent: MmoIntent
  readonly provider: ProviderInput
  readonly model: string
  readonly launch: true
}

/**
 * The rest of the questions, for a run with somebody sitting in front of it.
 *
 * Nothing here touches a credential. The one question near one asks for the
 * *name* of an environment variable, which is a reference to something already
 * on the machine — `readline` echoes every character typed, so a value typed at
 * this prompt would land in a scrollback buffer and a shell history, and that is
 * reason enough for the value never to be asked for at all.
 */
export async function onboardHarness(
  options: CliOptions,
  asker: Asker,
): Promise<InteractiveOnboarding> {
  // `--yes` is a promise that nothing will be asked. It is refused rather than
  // quietly answered, because the alternative is a mode that promises to ask
  // nothing and then asks eleven things.
  if (options.yes) {
    fail('--yes plans and scaffolds without asking anything, so it cannot answer the provider questions. Drop --yes to be asked them, or use --agent to pass them as flags.')
  }

  const intent = await onboardIntent(options, asker)

  const provider = providerNamed(options.provider ?? (await asker.ask(PROVIDER_QUESTION)))
  const model = required(options.model ?? (await asker.ask(MODEL_QUESTION)), 'the exact model ID')
  const apiKeyEnv = required(
    options.apiKeyEnv ?? (await askEnvName(provider, asker)),
    'the name of an environment variable',
  )

  // Only what this provider cannot fill in for itself: Qwen publishes no single
  // endpoint, and a custom provider is by definition undescribed here.
  const needsBaseUrl = provider.baseUrl === undefined
  const baseUrl = options.baseUrl ?? (needsBaseUrl ? required(await asker.ask(BASE_URL_QUESTION), 'an https URL') : undefined)
  const protocol =
    options.protocol ?? (provider.protocol === undefined ? protocolNamed(await asker.ask(PROTOCOL_QUESTION)) : undefined)

  return {
    intent,
    provider: {
      provider: provider.id,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(protocol === undefined ? {} : { protocol }),
      apiKeyEnv,
    },
    model,
    launch: true,
  }
}

/**
 * A built-in already knows what its own variable is conventionally called, so
 * the offer is that name; a custom provider has nobody to borrow a name from.
 */
function askEnvName(provider: ProviderDefinition, asker: Asker): Promise<string> {
  return provider.apiKeyEnv === undefined
    ? asker.ask(API_KEY_ENV_QUESTION)
    : asker.ask(API_KEY_ENV_QUESTION, provider.apiKeyEnv)
}

/** The ID or the human label, because the question shows both. */
function providerNamed(answer: string): ProviderDefinition {
  const wanted = answer.trim().toLowerCase().replace(/\s+/g, ' ')

  const named = PROVIDERS.find(
    (provider) => provider.id === wanted || provider.label.toLowerCase() === wanted,
  )
  if (named) return named

  fail(`That is not a provider this supports. They are: ${PROVIDERS.map(({ id, label }) => `${id} — ${label}`).join(', ')}.`)
}

function protocolNamed(answer: string): string {
  const wanted = answer.trim().toLowerCase()

  const named = PROVIDER_PROTOCOLS.find((protocol) => protocol === wanted)
  if (named) return named

  fail(`That is not a protocol this speaks. They are: ${PROVIDER_PROTOCOLS.join(', ')}.`)
}

/** Takes the number off the list, or the word, because both get typed. */
function dimensionNamed(answer: string): MmoDimension {
  const wanted = answer.trim().toLowerCase()

  const numbered = MMO_DIMENSIONS[Number(wanted) - 1]
  if (/^[1-9]$/.test(wanted) && numbered) return numbered

  const named = MMO_DIMENSIONS.find((dimension) => dimension === wanted)
  if (named) return named

  fail(`"${answer}" is not one of the three. They are: 1) 2d, 2) 3d, 3) auto.`)
}
