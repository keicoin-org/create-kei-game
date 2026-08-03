/**
 * The command line, parsed.
 *
 * Two questions get asked — what the project is called, and where it comes
 * from — and both can be answered up front instead. That is not a convenience:
 * most of this is driven by scripts and agents, and neither can answer a
 * prompt. Anything typable at a prompt is a flag, and `--yes` takes the
 * defaults for the rest, so the whole thing runs unattended.
 *
 * Contradictions are refused here rather than resolved. `--source blank --from
 * ./x` has no reading that is obviously right, so it gets a sentence saying so
 * instead of a silent choice between the two.
 */

import { fail } from './errors.js'
import { KNOWN_TEMPLATES, templateNamed, type SourceSelection } from './source.js'

/** What `--source` takes. `local` is `existing` in the source core's words. */
export type SourceFlag = 'blank' | 'template' | 'local' | 'repository'

export const SOURCE_FLAGS: readonly SourceFlag[] = ['blank', 'template', 'local', 'repository']

export interface CliOptions {
  /** The project name, given as the first positional argument. */
  name?: string
  source?: SourceFlag
  /** One of the three known templates. Implies `--source template`. */
  template?: string
  /** The path for `local`, the URL for `repository`. */
  from?: string
  /** Where it lands. Defaults to the project slug under the working directory. */
  into?: string
  /** Take the defaults for whatever was not given, and ask nothing. */
  yes: boolean
  /** Write the blank workspace into a directory that already has files in it. */
  force: boolean
  /** Hard no-prompt mode for another program driving the harness. */
  agent: boolean
  agentConfig?: string
  json: boolean
  provider?: string
  model?: string
  apiKeyEnv?: string
  baseUrl?: string
  protocol?: string
  brief?: string
  /** Undefined means config/default; false is an explicit --no-launch. */
  launch?: boolean
  help: boolean
  version: boolean
}

/** Used under `--yes`, and when a prompt is answered with an empty line. */
export const DEFAULT_NAME = 'kei-game'
export const DEFAULT_SOURCE = 'blank' satisfies SourceFlag
export const DEFAULT_TEMPLATE = 'button'

const FLAGS = [
  '--source',
  '--template',
  '--from',
  '--into',
  '--force',
  '--agent',
  '--agent-config',
  '--json',
  '--provider',
  '--model',
  '--api-key-env',
  '--base-url',
  '--protocol',
  '--brief',
  '--no-launch',
  '--yes',
  '-y',
  '--help',
  '-h',
  '--version',
  '-v',
]

const VALUED = [
  '--source',
  '--template',
  '--from',
  '--into',
  '--agent-config',
  '--provider',
  '--model',
  '--api-key-env',
  '--base-url',
  '--protocol',
  '--brief',
] as const
type ValuedFlag = (typeof VALUED)[number]

const FIELD: Record<ValuedFlag, keyof CliOptions> = {
  '--source': 'source',
  '--template': 'template',
  '--from': 'from',
  '--into': 'into',
  '--agent-config': 'agentConfig',
  '--provider': 'provider',
  '--model': 'model',
  '--api-key-env': 'apiKeyEnv',
  '--base-url': 'baseUrl',
  '--protocol': 'protocol',
  '--brief': 'brief',
}

const EXAMPLE: Record<ValuedFlag, string> = {
  '--source': '--source repository',
  '--template': '--template button',
  '--from': '--from https://github.com/keicoin-org/button.git',
  '--into': '--into ./games/mine',
  '--agent-config': '--agent-config ./agent.json',
  '--provider': '--provider openai',
  '--model': '--model <model-id>',
  '--api-key-env': '--api-key-env OPENAI_API_KEY',
  '--base-url': '--base-url https://models.example/v1',
  '--protocol': '--protocol responses',
  '--brief': '--brief "Build a puzzle game"',
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    yes: false,
    force: false,
    agent: false,
    json: false,
    help: false,
    version: false,
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true
        continue
      case '--version':
      case '-v':
        options.version = true
        continue
      case '--yes':
      case '-y':
        options.yes = true
        continue
      case '--force':
        options.force = true
        continue
      case '--agent':
        options.agent = true
        continue
      case '--json':
        options.json = true
        continue
      case '--no-launch':
        options.launch = false
        continue
    }

    const valued = VALUED.find((flag) => arg === flag)
    if (valued) {
      const value = argv[++index]
      if (
        value === undefined ||
        (value.startsWith('-') && !(valued === '--agent-config' && value === '-'))
      ) {
        fail(`${valued} needs a value after it, for example: ${EXAMPLE[valued]}.`)
      }
      assign(options, valued, value)
      continue
    }

    // `--source=blank` is the other spelling of the same thing, and whoever
    // types it should not be told it is not a flag.
    const joined = VALUED.find((flag) => arg.startsWith(`${flag}=`))
    if (joined) {
      assign(options, joined, arg.slice(joined.length + 1))
      continue
    }

    if (arg.startsWith('-')) {
      fail(`"${arg}" is not an option this understands. It takes: ${FLAGS.join(', ')}.`)
    }
    if (options.name !== undefined) {
      fail(
        `Two project names were given ("${options.name}" and "${arg}"), and there can only be one. Quote it if the name has a space in it.`,
      )
    }
    options.name = arg
  }

  const usesAgentOption =
    options.agentConfig !== undefined ||
    options.json ||
    options.launch !== undefined
  if (usesAgentOption && !options.agent) {
    fail('Agent config, JSON, and launch options require --agent.')
  }
  if (options.agent && options.yes) {
    fail('--agent and --yes are different no-prompt modes and cannot be combined.')
  }

  return options
}

function assign(options: CliOptions, flag: ValuedFlag, value: string): void {
  const field = FIELD[flag]
  if (options[field] !== undefined) {
    fail(`${flag} was given twice ("${options[field]}" and "${value}"), and there can only be one.`)
  }

  if (field === 'source') {
    const wanted = value.trim().toLowerCase()
    const known = SOURCE_FLAGS.find((source) => source === wanted)
    if (!known) fail(`"${value}" is not a source. The sources are: ${SOURCE_FLAGS.join(', ')}.`)
    options.source = known
    return
  }
  switch (field) {
    case 'template': options.template = value; return
    case 'from': options.from = value; return
    case 'into': options.into = value; return
    case 'agentConfig': options.agentConfig = value; return
    case 'provider': options.provider = value; return
    case 'model': options.model = value; return
    case 'apiKeyEnv': options.apiKeyEnv = value; return
    case 'baseUrl': options.baseUrl = value; return
    case 'protocol': options.protocol = value; return
    case 'brief': options.brief = value; return
    default: fail(`${flag} cannot be assigned.`)
  }
}

/**
 * What the flags alone say the source is, or `null` when they do not say — the
 * one case that has to be asked. Every contradiction dies here, before a
 * directory is looked at and long before anything is written.
 */
export function selectionFrom(options: CliOptions): SourceSelection | null {
  if (options.template !== undefined && options.source !== undefined && options.source !== 'template') {
    fail(
      `--template names one of the games this publishes, which is --source template. It cannot be combined with --source ${options.source}, which takes ${options.source === 'blank' ? 'nothing else' : '--from'}.`,
    )
  }
  if (options.from !== undefined && options.template !== undefined) {
    fail(
      '--from and --template are two answers to the same question. Give one: --template for a game this publishes, --from for anywhere else.',
    )
  }

  const kind = options.source ?? inferred(options)
  if (kind === null) return options.yes ? { kind: DEFAULT_SOURCE } : null

  switch (kind) {
    case 'blank':
      if (options.from !== undefined) {
        fail('--source blank starts from nothing, so there is nothing for --from to point at. Drop one of the two.')
      }
      return { kind: 'blank' }

    case 'template': {
      if (options.from !== undefined) {
        fail(
          '--source template starts from a game this publishes, named with --template. To clone anything else, use --source repository --from <url>.',
        )
      }
      const named = options.template
      if (named === undefined) {
        fail(
          `--source template needs --template to say which one: ${KNOWN_TEMPLATES.map((template) => template.id).join(', ')}.`,
        )
      }
      // Refuses an unknown name now rather than after the project name is typed.
      return { kind: 'template', template: templateNamed(named).id }
    }

    case 'local': {
      const path = options.from
      if (path === undefined) fail('--source local needs --from <path> to say which project on this disk.')
      return { kind: 'existing', path }
    }

    case 'repository': {
      const url = options.from
      if (url === undefined) {
        fail('--source repository needs --from <url>, for example: --from https://github.com/keicoin-org/button.git.')
      }
      return { kind: 'repository', url }
    }
  }
}

/**
 * `--template x` and `--from y` each name a source on their own, and making
 * somebody write `--source template --template button` to say the same word
 * twice would be a worse command line.
 */
function inferred(options: CliOptions): SourceFlag | null {
  if (options.template !== undefined) return 'template'
  if (options.from === undefined) return null
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(options.from.trim()) ? 'repository' : 'local'
}

export function helpText(version: string): string {
  const templates = KNOWN_TEMPLATES.map((template) => `    ${template.id.padEnd(18)}${template.summary}`).join('\n')

  return `
  create-kei-game ${version}

  Prepares the project a Kei game will be built in, and stops there. It asks
  what the project is called and where it starts from, puts that on disk, and
  exits — it does not build the game for you yet.

  Usage

    npm create kei-game
    npm create kei-game <project> -- --template button
    npm create kei-game <project> -- --source repository --from <url>

  Where a project starts from

    blank         An empty workspace: four files, no dependencies, no opinions.
    template      One of the games below, cloned from its own repository.
    local         A project already on this disk. Used where it lies.
    repository    A GitHub or GitLab repository, cloned over https.

  Options

    --source <kind>     One of: ${SOURCE_FLAGS.join(', ')}. Default: ${DEFAULT_SOURCE}
    --template <name>   Which published game. Implies --source template.
    --from <path|url>   The path for local, the https URL for repository.
    --into <directory>  Where it lands. Default: the project name, here.
    --force             Write a blank workspace into a directory that has files
                        in it. Overwrites files of the same name, deletes
                        nothing, and does not apply to a clone.
    --yes, -y           Take source defaults and ask nothing. Not agent mode.
    --agent             Hard no-prompt agent mode. Requires explicit inputs.
    --agent-config <p>  JSON config path, or - for bounded stdin (64 KiB).
    --json              Print exactly one JSON result or error in agent mode.
    --provider <id>     anthropic, openai, zai, qwen, deepseek, openrouter,
                        or custom.
    --model <id>        Explicit model ID. There is no model default.
    --api-key-env <n>   Name of an inherited environment variable, never a key.
    --base-url <url>    HTTPS endpoint override; required by qwen and custom.
    --protocol <name>   messages, responses, or chat_completions.
    --brief <text>      What game to build.
    --no-launch         Prepare and validate, but record launch as disabled.
    --help, -h          This.
    --version, -v       Print the version and exit.

  Templates

${templates}

  Agent mode validates provider settings and a game brief without storing key
  material. The model/tool loop and Kei terminal interface are not implemented
  yet, so launch=true is reported as pending and the command still stops after
  preparing the project.

  https://keicoin.org
`
}
