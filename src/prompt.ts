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
