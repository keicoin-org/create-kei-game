/**
 * The command line, parsed.
 *
 * Every question this asks is about the game. There is no flag for which
 * template to copy or which repository to clone, because those are decisions
 * the planner makes out of the intent and records its reasons for. What is left
 * on the command line is what somebody actually knows: what the thing is
 * called, whether it is flat or solid, what it should do, and who serves the
 * model.
 *
 * The three flags that used to ask about a starting point are still recognised
 * — and refused with a sentence saying where the decision went. A flag that
 * silently does nothing is worse than one that is gone.
 */

import { fail } from './errors.js'
import { MMO_DIMENSIONS, type MmoDimension } from './intent.js'

export interface CliOptions {
  /** The project name, given as the first positional argument. */
  name?: string
  dimension?: MmoDimension
  gameplay?: string
  world?: string
  art?: string
  network?: string
  economy?: string
  /** Where it lands. Defaults to the project slug under the working directory. */
  into?: string
  /** Plan and scaffold with no questions and no provider. */
  yes: boolean
  /** Write the scaffold into a directory that already has files in it. */
  force: boolean
  /** Hard no-prompt mode for another program driving the harness. */
  agent: boolean
  agentConfig?: string
  json: boolean
  /** Produce the plan and stop: no directory, no provider, no model call. */
  planOnly: boolean
  provider?: string
  model?: string
  apiKeyEnv?: string
  baseUrl?: string
  protocol?: string
  /** Undefined means config/default; false is an explicit --no-launch. */
  launch?: boolean
  help: boolean
  version: boolean
}

/** Used under `--yes`, and when the name prompt is answered with an empty line. */
export const DEFAULT_NAME = 'kei-mmo'
export const DEFAULT_DIMENSION = 'auto' satisfies MmoDimension

const FLAGS = [
  '--dimension',
  '--2d',
  '--3d',
  '--gameplay',
  '--world',
  '--art',
  '--network',
  '--economy',
  '--brief',
  '--into',
  '--force',
  '--agent',
  '--agent-config',
  '--json',
  '--plan-only',
  '--provider',
  '--model',
  '--api-key-env',
  '--base-url',
  '--protocol',
  '--no-launch',
  '--yes',
  '-y',
  '--help',
  '-h',
  '--version',
  '-v',
]

const VALUED = [
  '--dimension',
  '--gameplay',
  '--world',
  '--art',
  '--network',
  '--economy',
  '--brief',
  '--into',
  '--agent-config',
  '--provider',
  '--model',
  '--api-key-env',
  '--base-url',
  '--protocol',
] as const
type ValuedFlag = (typeof VALUED)[number]

/**
 * `--brief` is the one alias kept from the game harness this replaced. It was
 * the whole description of the thing being built, and gameplay is where that
 * sentence belongs now.
 */
const FIELD: Record<ValuedFlag, keyof CliOptions> = {
  '--dimension': 'dimension',
  '--gameplay': 'gameplay',
  '--world': 'world',
  '--art': 'art',
  '--network': 'network',
  '--economy': 'economy',
  '--brief': 'gameplay',
  '--into': 'into',
  '--agent-config': 'agentConfig',
  '--provider': 'provider',
  '--model': 'model',
  '--api-key-env': 'apiKeyEnv',
  '--base-url': 'baseUrl',
  '--protocol': 'protocol',
}

const EXAMPLE: Record<ValuedFlag, string> = {
  '--dimension': '--dimension 3d',
  '--gameplay': '--gameplay "Four classes, open-world questing, group dungeons"',
  '--world': '--world "One persistent shard, streamed regions, day and night"',
  '--art': '--art "Low-poly, warm palette, third-person camera"',
  '--network': '--network "200 players a shard, 20 Hz tick, server-authoritative"',
  '--economy': '--economy "One Kei currency, tradeable gear, auction house"',
  '--brief': '--brief "Four classes, open-world questing, group dungeons"',
  '--into': '--into ./games/mine',
  '--agent-config': '--agent-config ./agent.json',
  '--provider': '--provider openai',
  '--model': '--model <model-id>',
  '--api-key-env': '--api-key-env OPENAI_API_KEY',
  '--base-url': '--base-url https://models.example/v1',
  '--protocol': '--protocol responses',
}

/** Flags whose whole job was choosing a starting point. The planner has that job now. */
const RETIRED: Readonly<Record<string, string>> = Object.freeze({
  '--source':
    '--source is gone. The harness decides whether to start from a reference project or a scaffold, out of what you describe, and writes the reasoning into kei-mmo/plan.json. Describe the game instead: --gameplay, --world, --art, --network, --economy.',
  '--template':
    '--template is gone. Reference projects are chosen by the planner, not picked from a menu; run with --plan-only to see which one it picked and why.',
  '--from':
    '--from is gone. There is no source to point at any more — the planner decides where the project starts and records why in kei-mmo/plan.json.',
})

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    yes: false,
    force: false,
    agent: false,
    json: false,
    planOnly: false,
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
      case '--plan-only':
        options.planOnly = true
        continue
      case '--no-launch':
        options.launch = false
        continue
      case '--2d':
      case '--3d':
        assignDimension(options, arg.slice(2))
        continue
    }

    const retired = Object.keys(RETIRED).find((flag) => arg === flag || arg.startsWith(`${flag}=`))
    if (retired) {
      // This prose is fixed by the harness rather than derived from argv, so it
      // is the one parse diagnostic safe to preserve at the JSON boundary.
      fail(RETIRED[retired]!, 'retired_field', { field: retired.slice(2) })
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

    // `--dimension=3d` is the other spelling of the same thing, and whoever
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

  // --no-launch and --plan-only are not agent options: "validate everything,
  // then stop" is a thing a person wants too, and --plan-only is the only way
  // to see what the harness decided without it touching a directory.
  if ((options.agentConfig !== undefined || options.json) && !options.agent) {
    fail('Agent config and JSON options require --agent.')
  }
  if (options.agent && options.yes) {
    fail('--agent and --yes are different no-prompt modes and cannot be combined.')
  }

  return options
}

function assignDimension(options: CliOptions, value: string): void {
  const wanted = value.trim().toLowerCase()
  const known = MMO_DIMENSIONS.find((dimension) => dimension === wanted)
  if (!known) fail(`"${value}" is not a dimension. It takes: ${MMO_DIMENSIONS.join(', ')}.`)
  if (options.dimension !== undefined && options.dimension !== known) {
    fail(`The dimension was given twice ("${options.dimension}" and "${known}"), and there can only be one.`)
  }
  options.dimension = known
}

function assign(options: CliOptions, flag: ValuedFlag, value: string): void {
  const field = FIELD[flag]
  if (field === 'dimension') {
    assignDimension(options, value)
    return
  }
  if (field === 'gameplay' && options.gameplay !== undefined) {
    fail('--gameplay and --brief are two spellings of one field. Give one of them.')
  }
  if (options[field] !== undefined) {
    fail(`${flag} was given twice ("${options[field]}" and "${value}"), and there can only be one.`)
  }

  switch (field) {
    case 'gameplay': options.gameplay = value; return
    case 'world': options.world = value; return
    case 'art': options.art = value; return
    case 'network': options.network = value; return
    case 'economy': options.economy = value; return
    case 'into': options.into = value; return
    case 'agentConfig': options.agentConfig = value; return
    case 'provider': options.provider = value; return
    case 'model': options.model = value; return
    case 'apiKeyEnv': options.apiKeyEnv = value; return
    case 'baseUrl': options.baseUrl = value; return
    case 'protocol': options.protocol = value; return
    default: fail(`${flag} cannot be assigned.`)
  }
}

export function helpText(version: string): string {
  return `
  create-kei-mmo ${version}

  Builds a 2D or 3D Kei MMORPG. You describe the game; this decides the engine,
  decides whether any reference project is worth starting from, writes down why
  it decided both, and hands a model a plan with the actual methods in it.

  Usage, from a checkout of this repository

    bun run src/index.ts --
    bun run src/index.ts -- <project> --3d --gameplay "..." --plan-only
    bun run src/index.ts -- <project> --agent --json --plan-only --dimension auto --gameplay "..."

  This harness is not published. The npm name create-kei-game still resolves to
  the superseded 0.2.0 scaffolder that shipped from kei-transaction, and there
  is no create-kei-mmo on npm, so no npm create invocation reaches this program.

  What you describe

    --dimension <d>     2d, 3d, or auto. Human default: ${DEFAULT_DIMENSION};
                        agent mode requires an explicit answer, including auto.
    --2d, --3d          The same thing, said shorter.
    --gameplay <text>   What players do: classes, combat, quests, crafting.
                        The one goal a plan cannot be derived without.
    --world <text>      Size, regions, persistence, how much stays loaded.
    --art <text>        Style, palette, camera, lighting.
    --network <text>    Players a shard, latency budget, what the server owns.
    --economy <text>    Currencies, items, trade, sinks, what settles on chain.
    --brief <text>      Compatibility alias for --gameplay.

  A blank optional goal is not a hole this papers over: the plan records what it
  assumed instead, in the same file.

  Everything else is decided here: renderer, client and server shape, whether a
  reference project is cloned and which one, the capability packets that apply,
  the constraints, the acceptance criteria, and the build order. Run --plan-only
  to read all of that before anything touches a directory.

  Options

    --into <directory>  Where it lands. Default: the project name, here.
    --force             Write the scaffold into a directory that has files in
                        it. Overwrites files of the same name, deletes nothing,
                        and does not apply to a clone.
    --plan-only         Print the plan and stop. Touches no directory, needs no
                        provider, and calls no model.
    --yes, -y           Plan and scaffold with no questions and no provider.
    --agent             Hard no-prompt agent mode. Requires explicit inputs.
    --agent-config <p>  JSON config path, or - for bounded stdin (64 KiB).
    --json              Print exactly one JSON result or error in agent mode.
    --provider <id>     anthropic, openai, zai, qwen, deepseek, openrouter,
                        or custom.
    --model <id>        Explicit model ID. There is no model default.
    --api-key-env <n>   Name of an inherited environment variable, never a key.
    --base-url <url>    HTTPS endpoint override; required by qwen and custom.
    --protocol <name>   messages, responses, or chat_completions.
    --no-launch         Plan and prepare everything, but do not run the model.
                        Works with or without --agent.
    --help, -h          This.
    --version, -v       Print the version and exit.

  Agent mode validates the intent and the provider settings without storing key
  material, plans, and then runs the same engine the future Kei terminal
  interface will. The credential is read from the named environment variable at
  call time and is never written to argv, config, the project, or any error. One
  turn runs per invocation; the long-running Kei terminal interface is later M9
  work.

  https://keicoin.org
`
}
