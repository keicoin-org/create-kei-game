/**
 * The two questions, in the one order they are asked: what the project is
 * called, then where it starts from — and then, only if the answer needs one,
 * the single detail that answer implies.
 *
 * Deliberately not a dependency: a harness that pulls in a prompt library, a
 * colour library, and a spinner is three supply-chain risks for a program that
 * runs once. `readline` is in the runtime already.
 *
 * The asker is an argument everywhere below, which is what lets the tests read
 * back the exact questions in the exact order, and prove that `--yes` asks
 * none of them, without a terminal.
 */

import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

import { DEFAULT_NAME, DEFAULT_TEMPLATE, SOURCE_FLAGS, type CliOptions, type SourceFlag } from './cli.js'
import { fail } from './errors.js'
import {
  PROVIDERS,
  PROVIDER_PROTOCOLS,
  type ProviderDefinition,
  type ProviderInput,
} from './providers.js'
import { KNOWN_TEMPLATES, templateNamed, type SourceSelection } from './source.js'

export interface Asker {
  /** The answer, trimmed. An empty line means the fallback, when there is one. */
  ask(question: string, fallback?: string): Promise<string>
  close(): void
}

export type AskerFactory = () => Asker

export function createAsker(): Asker {
  if (!stdin.isTTY) {
    fail(
      'There is nothing to type into here, so the questions cannot be asked and this will not guess at them. Pass the answers instead: create-kei-game <project> --source blank, or --yes to take the defaults.',
    )
  }

  const readline = createInterface({ input: stdin, output: stdout })
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

const SOURCE_LABELS: Record<SourceFlag, string> = {
  blank: 'blank workspace',
  template: 'a game this publishes',
  local: 'a project already on this disk',
  repository: 'a GitHub or GitLab repository',
}

export const NAME_QUESTION = 'Project name?'
export const SOURCE_QUESTION = 'Start from? 1) blank  2) template  3) local project  4) repository'

/**
 * Everything the flags did not already say, and nothing else. `create-kei-game
 * my-game --template button` asks nothing at all; the bare command asks the
 * name, then the source, then the one detail that source needs.
 */
export async function onboard(
  options: CliOptions,
  selection: SourceSelection | null,
  asker: Asker,
): Promise<{ name: string; selection: SourceSelection }> {
  // `--yes` is a promise that nothing will be asked, and it is kept here rather
  // than only at the call site, so that no caller can break it by passing an
  // asker anyway.
  if (options.yes) return { name: options.name ?? DEFAULT_NAME, selection: selection ?? { kind: 'blank' } }

  const name = options.name ?? (await asker.ask(NAME_QUESTION, DEFAULT_NAME))
  return { name, selection: selection ?? (await askSource(asker)) }
}

async function askSource(asker: Asker): Promise<SourceSelection> {
  const kind = sourceNamed(await asker.ask(SOURCE_QUESTION, 'blank'))

  switch (kind) {
    case 'blank':
      return { kind: 'blank' }
    case 'template':
      return { kind: 'template', template: templateNamed(await asker.ask(templateQuestion(), DEFAULT_TEMPLATE)).id }
    case 'local':
      return { kind: 'existing', path: required(await asker.ask('Path to the project?'), 'a path to it') }
    case 'repository':
      return { kind: 'repository', url: required(await asker.ask('Repository URL?'), 'an https URL') }
  }
}

function templateQuestion(): string {
  return `Which one? ${KNOWN_TEMPLATES.map((template) => template.id).join(', ')}`
}

function required(answer: string, wanted: string): string {
  if (answer.trim() === '') fail(`That needs ${wanted}, and there is no sensible default to fall back to.`)
  return answer
}

/**
 * The rest of the questions, for a run with somebody sitting in front of it.
 *
 * The order is the order a person can answer in: what the project is, where it
 * starts from, who serves the model, which model, and only then the settings
 * that the chosen provider actually needs. Asking for a base URL before the
 * provider is known would be asking somebody to guess at their own answer.
 *
 * Nothing here touches a credential. The one question near one asks for the
 * *name* of an environment variable, which is a reference to something already
 * on the machine — `readline` echoes every character typed, so a value typed at
 * this prompt would land in a scrollback buffer and a shell history, and that is
 * reason enough for the value never to be asked for at all.
 */
export const PROVIDER_QUESTION = `Which provider? ${PROVIDERS.map(({ id, label }) => `${id} (${label})`).join(', ')}`
export const MODEL_QUESTION = 'Which model? Give the exact model ID — there is no default.'
export const API_KEY_ENV_QUESTION =
  'Name of the environment variable to read at run time? The name only — nothing secret is typed here.'
export const BASE_URL_QUESTION = 'HTTPS base URL for this provider?'
export const PROTOCOL_QUESTION = `Which protocol? ${PROVIDER_PROTOCOLS.join(', ')}`
export const BRIEF_QUESTION = 'What game should this build?'

/** Everything a run needs to become a request, with no key material in it. */
export interface InteractiveOnboarding {
  readonly name: string
  readonly selection: SourceSelection
  readonly provider: ProviderInput
  readonly model: string
  readonly brief: string
  readonly launch: true
}

export async function onboardHarness(
  options: CliOptions,
  selection: SourceSelection | null,
  asker: Asker,
): Promise<InteractiveOnboarding> {
  // `--yes` is prompt-free source preparation and stops before any of this. It
  // is refused rather than quietly answered, because the alternative is a mode
  // that promises to ask nothing and then asks seven things.
  if (options.yes) {
    fail('--yes prepares the project without asking anything, so it cannot answer the provider questions. Drop --yes to be asked them, or use --agent to pass them as flags.')
  }

  const name = options.name ?? (await asker.ask(NAME_QUESTION, DEFAULT_NAME))
  const source = selection ?? (await askSource(asker))

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

  const brief = required(options.brief ?? (await asker.ask(BRIEF_QUESTION)), 'a sentence about the game')

  return {
    name,
    selection: source,
    provider: {
      provider: provider.id,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(protocol === undefined ? {} : { protocol }),
      apiKeyEnv,
    },
    model,
    brief,
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

  fail(`"${answer}" is not a provider this supports. They are: ${PROVIDERS.map(({ id, label }) => `${id} — ${label}`).join(', ')}.`)
}

function protocolNamed(answer: string): string {
  const wanted = answer.trim().toLowerCase()

  const named = PROVIDER_PROTOCOLS.find((protocol) => protocol === wanted)
  if (named) return named

  fail(`"${answer}" is not a protocol this speaks. They are: ${PROVIDER_PROTOCOLS.join(', ')}.`)
}

/** Takes the number off the list, or the word, because both get typed. */
function sourceNamed(answer: string): SourceFlag {
  const wanted = answer.trim().toLowerCase()

  const numbered = SOURCE_FLAGS[Number(wanted) - 1]
  if (/^[1-9]$/.test(wanted) && numbered) return numbered

  const named = SOURCE_FLAGS.find((source) => source === wanted)
  if (named) return named

  const list = SOURCE_FLAGS.map((source, index) => `${index + 1}) ${source} — ${SOURCE_LABELS[source]}`).join(', ')
  fail(`"${answer}" is not one of the four. They are: ${list}.`)
}
