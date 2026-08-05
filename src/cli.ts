/**
 * The command line, parsed.
 *
 * Two questions get asked (SPEC §11.3), and both can be answered up front
 * instead. That is not a convenience: SPEC §12 expects most integrations to be
 * driven by an agent, and an agent cannot answer a prompt. Anything that can be
 * typed at a prompt can be passed as a flag, and `--yes` accepts the defaults
 * for the rest, so the whole harness runs unattended.
 */

import { HarnessError, fail, type Failure } from './errors.js'
import { DEFAULT_TEMPLATE, TEMPLATES } from './templates.js'

export interface CliOptions {
  /** The project name, given as the first positional argument. */
  name?: string
  currency?: string
  /** Which game to write. Defaults to `star-clicker`. */
  template?: string
  /** Machine-readable diagnostics for agent-friendly automation. */
  json: boolean
  /** Take the defaults for whatever was not given, and ask nothing. */
  yes: boolean
  /** Write into a directory that already has files in it. */
  force: boolean
  help: boolean
  version: boolean
}

/** Used only under `--yes`, or when a prompt is answered with an empty line. */
export const DEFAULT_NAME = 'kei-game'
export const DEFAULT_CURRENCY = 'Coins'

const FLAGS = ['--template', '--currency', '--json', '--yes', '-y', '--force', '--help', '-h', '--version', '-v']

/**
 * A command line this could not read, carrying what it had read when it gave up.
 *
 * `--json` is the machine contract (SPEC §12), so the caller that failed still
 * has to be answered in the format it asked for — and this parser is the only
 * thing that knows whether it asked. A run that sets `--json` and then mistypes
 * its third flag asked for JSON; `--currency --json`, where the token was taken
 * as a value and rejected as one, never asked for anything.
 *
 * `parsed` is therefore what was established *before* the failing token, and
 * nothing more. It is not a usable set of options — the run is over — it is the
 * answer to one question: how to say so.
 */
export class CliError extends HarnessError {
  constructor(
    message: string,
    failure: Failure,
    readonly parsed: CliOptions,
  ) {
    super(message, failure)
  }
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { json: false, yes: false, force: false, help: false, version: false }

  try {
    read(argv, options)
  } catch (error) {
    if (error instanceof HarnessError) throw new CliError(error.message, error.failure, { ...options })
    throw error
  }

  return options
}

function read(argv: readonly string[], options: CliOptions): void {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true
        break
      case '--version':
      case '-v':
        options.version = true
        break
      case '--yes':
      case '-y':
        options.yes = true
        break
      case '--force':
        options.force = true
        break
      case '--json':
        options.json = true
        break
      case '--currency': {
        const value = argv[++index]
        if (value === undefined || value.startsWith('-')) {
          fail('--currency needs a name after it, for example: --currency "Gems".', {
            code: 'flag_missing_value',
            stage: 'arguments',
            step: 'read-currency-flag',
            retryable: false,
            remediation: 'Put the currency name after --currency, or write it as --currency=Gems.',
          })
        }
        options.currency = value
        break
      }
      case '--template': {
        const value = argv[++index]
        if (value === undefined || value.startsWith('-')) {
          fail('--template needs a name after it, for example: --template world-of-wonder.', {
            code: 'flag_missing_value',
            stage: 'arguments',
            step: 'read-template-flag',
            retryable: false,
            remediation: 'Put the template name after --template, or write it as --template=world-of-wonder.',
          })
        }
        options.template = value
        break
      }
      default: {
        // `--currency=Gems` is the other spelling of the same thing, and a
        // developer who types it should not be told it is not a flag.
        if (arg.startsWith('--currency=')) {
          options.currency = arg.slice('--currency='.length)
          break
        }
        if (arg.startsWith('--template=')) {
          options.template = arg.slice('--template='.length)
          break
        }
        if (arg.startsWith('-')) {
          fail(`"${arg}" is not an option this understands. It takes: ${FLAGS.join(', ')}.`, {
            code: 'flag_unknown',
            stage: 'arguments',
            step: 'read-flag',
            retryable: false,
            remediation: 'Drop the option, or check its spelling against --help.',
          })
        }
        if (options.name !== undefined) {
          fail(
            `Two project names were given ("${options.name}" and "${arg}"), and there can only be one. Quote it if the name has a space in it.`,
            {
              code: 'name_repeated',
              stage: 'arguments',
              step: 'read-project-name',
              retryable: false,
              remediation: 'Pass one project name, quoted if it contains a space.',
            },
          )
        }
        options.name = arg
      }
    }
  }
}

export function helpText(version: string): string {
  const templates = TEMPLATES.map((template) => `    ${template.name.padEnd(16)}${template.summary}`).join('\n')

  return `
  create-kei-game ${version}

  Scaffolds a browser game with a real currency, a real item, and a wallet the
  player owns. It writes files and exits: nothing it generates depends on it.

  Usage

    npm create kei-game
    npm create kei-game <project> -- --currency <name>
    bun create kei-game <project> --template world-of-wonder

  Options

    --template <name>   Which game to start from. Default: ${DEFAULT_TEMPLATE}
    --currency <name>   What the in-game currency is called. Default: ${DEFAULT_CURRENCY}
    --yes, -y           Take the defaults and ask nothing. For CI and agents.
    --json              Print structured failure diagnostics for automation.
    --force             Write into a directory that already has files in it.
    --help, -h          This.
    --version, -v       Print the version and exit.

  Templates

${templates}

  ${DEFAULT_TEMPLATE} is written from inside this package. The others are whole
  example projects, downloaded from their own repositories when you ask for one,
  so that nobody pays for 30MB of 3D models to get a star and a button.

  It asks two things and derives the rest, including the ticker the chain knows
  your currency by. Everything it writes is yours to edit.

  https://keicoin.org
`
}
