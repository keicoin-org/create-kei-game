/**
 * The machine contract: one JSON object, no prompts, no guessing.
 *
 * It describes the game and nothing else. The three fields that used to choose
 * a starting point — `source`, `template`, `from` — are refused by name with
 * their own error code, because an agent that keeps sending them needs to be
 * told the decision moved rather than to have them quietly ignored.
 *
 * `brief` survives as the one compatibility alias. It was the whole description
 * of the thing being built, and gameplay is where that sentence belongs now.
 */

import type { CliOptions } from './cli.js'
import {
  assertSafeConfigFields,
  createHarnessRequest,
  type HarnessRequest,
} from './harness.js'
import { MMO_INTENT_VERSION, parseMmoIntent, type MmoDimension, type MmoIntent } from './intent.js'

export const MAX_AGENT_CONFIG_BYTES = 64 * 1024

const AGENT_FIELDS = [
  'intentVersion',
  'name',
  'dimension',
  'gameplay',
  'world',
  'art',
  'network',
  'economy',
  'brief',
  'into',
  'force',
  'provider',
  'model',
  'apiKeyEnv',
  'baseUrl',
  'protocol',
  'launch',
] as const

const STRING_FIELDS = [
  'name',
  'dimension',
  'gameplay',
  'world',
  'art',
  'network',
  'economy',
  'brief',
  'into',
  'provider',
  'model',
  'apiKeyEnv',
  'baseUrl',
  'protocol',
] as const

/** Answers to a question this no longer asks. Named, so the refusal can explain. */
const RETIRED_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  source:
    'The harness decides whether to start from a reference project, out of the intent. Send gameplay, world, art, network, and economy instead.',
  template:
    'Reference projects are chosen by the planner. The choice and its reasoning come back in the plan.',
  from: 'There is no source to point at; the planner decides where the project starts.',
})

type AgentField = (typeof AGENT_FIELDS)[number]
type StringAgentField = (typeof STRING_FIELDS)[number]

export type AgentErrorCode = 'config_too_large' | 'invalid_config' | 'missing_inputs' | 'retired_field'

export interface AgentErrorDetails {
  readonly field?: string
  readonly missing?: readonly string[]
}

export class AgentError extends Error {
  override readonly name = 'AgentError'

  constructor(
    readonly code: AgentErrorCode,
    message: string,
    readonly details: AgentErrorDetails = {},
  ) {
    super(message)
  }
}

export interface AgentAnswers {
  readonly intentVersion?: unknown
  readonly name?: unknown
  readonly dimension?: unknown
  readonly gameplay?: unknown
  readonly world?: unknown
  readonly art?: unknown
  readonly network?: unknown
  readonly economy?: unknown
  /** Compatibility alias for `gameplay`. */
  readonly brief?: unknown
  readonly into?: unknown
  readonly force?: unknown
  readonly provider?: unknown
  readonly model?: unknown
  readonly apiKeyEnv?: unknown
  readonly baseUrl?: unknown
  readonly protocol?: unknown
  readonly launch?: unknown
}

/** Typed command-line answers. Undefined means the config file may answer it. */
export interface AgentOverrides {
  readonly name?: string
  readonly dimension?: MmoDimension
  readonly gameplay?: string
  readonly world?: string
  readonly art?: string
  readonly network?: string
  readonly economy?: string
  readonly into?: string
  readonly force?: boolean
  readonly provider?: string
  readonly model?: string
  readonly apiKeyEnv?: string
  readonly baseUrl?: string
  readonly protocol?: string
  readonly launch?: boolean
}

function invalid(field: string, message = 'Agent config field is not valid.'): never {
  throw new AgentError('invalid_config', message, { field })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateObject(value: unknown): AgentAnswers {
  assertSafeConfigFields(value)
  if (!isObject(value)) invalid('agentConfig', 'Agent config must be one JSON object.')

  const retired = Object.keys(value).filter((field) => field in RETIRED_FIELDS).sort()
  if (retired[0]) {
    throw new AgentError('retired_field', RETIRED_FIELDS[retired[0]]!, { field: retired[0] })
  }

  const unknown = Object.keys(value)
    .filter((field) => !AGENT_FIELDS.includes(field as AgentField))
    .sort()
  if (unknown[0]) invalid(unknown[0], 'Agent config contains an unknown field.')

  if (value.intentVersion !== undefined && value.intentVersion !== MMO_INTENT_VERSION) {
    invalid('intentVersion', 'Agent config intent version is not supported.')
  }
  for (const field of STRING_FIELDS) {
    if (value[field] !== undefined && typeof value[field] !== 'string') invalid(field)
  }
  for (const field of ['force', 'launch'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') invalid(field)
  }
  return value
}

export async function readAgentConfig(
  chunks: AsyncIterable<Uint8Array | string>,
): Promise<AgentAnswers> {
  const parts: Uint8Array[] = []
  const encoder = new TextEncoder()
  let total = 0

  for await (const chunk of chunks) {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
    total += bytes.byteLength
    if (total > MAX_AGENT_CONFIG_BYTES) {
      throw new AgentError('config_too_large', 'Agent config is larger than 64 KiB.', {
        field: 'agentConfig',
      })
    }
    parts.push(bytes)
  }

  const combined = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    combined.set(part, offset)
    offset += part.byteLength
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(combined)
  } catch {
    return invalid('agentConfig', 'Agent config must be valid UTF-8 JSON.')
  }
  if (text.trim() === '') invalid('agentConfig', 'Agent config must be one JSON object.')

  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return invalid('agentConfig', 'Agent config must be valid JSON.')
  }
  return validateObject(parsed)
}

function configString(config: AgentAnswers, field: StringAgentField): string | undefined {
  const value = config[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') return invalid(field)
  return value
}

function chosenString(
  config: AgentAnswers,
  overrides: AgentOverrides,
  field: Exclude<StringAgentField, 'brief'>,
): string | undefined {
  const override = overrides[field as keyof AgentOverrides] as string | undefined
  if (override !== undefined && typeof override !== 'string') return invalid(field)
  return override ?? configString(config, field)
}

function configBoolean(config: AgentAnswers, field: 'force' | 'launch'): boolean | undefined {
  const value = config[field]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') return invalid(field)
  return value
}

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim() === ''
}

interface AgentValues {
  readonly name: string | undefined
  readonly gameplay: string | undefined
  readonly dimension: string | undefined
  readonly world: string | undefined
  readonly art: string | undefined
  readonly network: string | undefined
  readonly economy: string | undefined
  readonly into: string | undefined
  readonly provider: string | undefined
  readonly model: string | undefined
  readonly apiKeyEnv: string | undefined
  readonly baseUrl: string | undefined
  readonly protocol: string | undefined
}

function agentValues(config: AgentAnswers, overrides: AgentOverrides): AgentValues {
  const gameplay = chosenString(config, overrides, 'gameplay') ?? configString(config, 'brief')
  return {
    name: chosenString(config, overrides, 'name'),
    gameplay,
    dimension: chosenString(config, overrides, 'dimension'),
    world: chosenString(config, overrides, 'world'),
    art: chosenString(config, overrides, 'art'),
    network: chosenString(config, overrides, 'network'),
    economy: chosenString(config, overrides, 'economy'),
    into: chosenString(config, overrides, 'into'),
    provider: chosenString(config, overrides, 'provider'),
    model: chosenString(config, overrides, 'model'),
    apiKeyEnv: chosenString(config, overrides, 'apiKeyEnv'),
    baseUrl: chosenString(config, overrides, 'baseUrl'),
    protocol: chosenString(config, overrides, 'protocol'),
  }
}

function intentFrom(values: AgentValues): MmoIntent {
  return parseMmoIntent({
    intentVersion: MMO_INTENT_VERSION,
    name: values.name,
    dimension: values.dimension,
    gameplay: values.gameplay,
    world: values.world,
    art: values.art,
    network: values.network,
    economy: values.economy,
  })
}

/**
 * The intent alone, for a plan-only run. It needs no provider and no
 * credential, because planning reaches nothing: it is a pure function of what
 * was described.
 */
export function createAgentIntent(config: AgentAnswers, overrides: AgentOverrides): MmoIntent {
  validateObject(config)
  const values = agentValues(config, overrides)

  const missing: string[] = []
  if (blank(values.name)) missing.push('name')
  if (blank(values.gameplay)) missing.push('gameplay')
  if (blank(values.dimension)) missing.push('dimension')
  if (missing.length > 0) {
    throw new AgentError('missing_inputs', 'Agent mode is missing required inputs.', {
      missing: Object.freeze(missing),
    })
  }
  return intentFrom(values)
}

export function createAgentRequest(
  config: AgentAnswers,
  overrides: AgentOverrides,
  baseDirectory: string,
  environment: Readonly<Record<string, string | undefined>>,
): HarnessRequest {
  validateObject(config)
  const values = agentValues(config, overrides)

  // Everything that is missing, in one answer. An agent that has to discover
  // five required fields one round trip at a time is an agent that gives up.
  const missing: string[] = []
  if (blank(values.name)) missing.push('name')
  if (blank(values.gameplay)) missing.push('gameplay')
  if (blank(values.dimension)) missing.push('dimension')
  if (blank(values.provider)) missing.push('provider')
  if (blank(values.model)) missing.push('model')
  if (blank(values.apiKeyEnv)) missing.push('apiKeyEnv')
  if (missing.length > 0) {
    throw new AgentError('missing_inputs', 'Agent mode is missing required inputs.', {
      missing: Object.freeze(missing),
    })
  }

  const forceOverride = overrides.force
  const launchOverride = overrides.launch
  if (forceOverride !== undefined && typeof forceOverride !== 'boolean') invalid('force')
  if (launchOverride !== undefined && typeof launchOverride !== 'boolean') invalid('launch')

  return createHarnessRequest(
    {
      intent: intentFrom(values),
      baseDirectory,
      destination: values.into,
      force: forceOverride ?? configBoolean(config, 'force') ?? false,
      provider: {
        provider: values.provider,
        apiKeyEnv: values.apiKeyEnv,
        baseUrl: values.baseUrl,
        protocol: values.protocol,
      },
      model: values.model,
      launch: launchOverride ?? configBoolean(config, 'launch') ?? true,
    },
    environment,
  )
}

/** The flag answers, in the shape the merge above expects. */
export function overridesFrom(options: CliOptions): AgentOverrides {
  return {
    name: options.name,
    dimension: options.dimension,
    gameplay: options.gameplay,
    world: options.world,
    art: options.art,
    network: options.network,
    economy: options.economy,
    into: options.into,
    force: options.force ? true : undefined,
    provider: options.provider,
    model: options.model,
    apiKeyEnv: options.apiKeyEnv,
    baseUrl: options.baseUrl,
    protocol: options.protocol,
    launch: options.launch,
  }
}
