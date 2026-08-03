import { selectionFrom, type CliOptions, type SourceFlag } from './cli.js'
import {
  assertSafeConfigFields,
  createHarnessRequest,
  type HarnessRequest,
} from './harness.js'

export const MAX_AGENT_CONFIG_BYTES = 64 * 1024

const AGENT_FIELDS = [
  'name',
  'source',
  'template',
  'from',
  'into',
  'force',
  'provider',
  'model',
  'apiKeyEnv',
  'baseUrl',
  'protocol',
  'brief',
  'launch',
] as const

const STRING_FIELDS = [
  'name',
  'source',
  'template',
  'from',
  'into',
  'provider',
  'model',
  'apiKeyEnv',
  'baseUrl',
  'protocol',
  'brief',
] as const

const SOURCE_FLAGS: readonly SourceFlag[] = ['blank', 'template', 'local', 'repository']

type AgentField = (typeof AGENT_FIELDS)[number]
type StringAgentField = (typeof STRING_FIELDS)[number]

export type AgentErrorCode = 'config_too_large' | 'invalid_config' | 'missing_inputs'

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
  readonly name?: unknown
  readonly source?: unknown
  readonly template?: unknown
  readonly from?: unknown
  readonly into?: unknown
  readonly force?: unknown
  readonly provider?: unknown
  readonly model?: unknown
  readonly apiKeyEnv?: unknown
  readonly baseUrl?: unknown
  readonly protocol?: unknown
  readonly brief?: unknown
  readonly launch?: unknown
}

/** Typed command-line answers. Undefined means the config file may answer it. */
export interface AgentOverrides {
  readonly name?: string
  readonly source?: SourceFlag
  readonly template?: string
  readonly from?: string
  readonly into?: string
  readonly force?: boolean
  readonly provider?: string
  readonly model?: string
  readonly apiKeyEnv?: string
  readonly baseUrl?: string
  readonly protocol?: string
  readonly brief?: string
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

  const unknown = Object.keys(value)
    .filter((field) => !AGENT_FIELDS.includes(field as AgentField))
    .sort()
  if (unknown[0]) invalid(unknown[0], 'Agent config contains an unknown field.')

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

function configBoolean(
  config: AgentAnswers,
  field: 'force' | 'launch',
): boolean | undefined {
  const value = config[field]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') return invalid(field)
  return value
}

function chosenString(
  config: AgentAnswers,
  overrides: AgentOverrides,
  field: StringAgentField,
): string | undefined {
  const override = overrides[field]
  if (override !== undefined && typeof override !== 'string') return invalid(field)
  return override ?? configString(config, field)
}

function requiredMissing(value: string | undefined): boolean {
  return value === undefined || value.trim() === ''
}

export function createAgentRequest(
  config: AgentAnswers,
  overrides: AgentOverrides,
  baseDirectory: string,
  environment: Readonly<Record<string, string | undefined>>,
): HarnessRequest {
  validateObject(config)

  const name = chosenString(config, overrides, 'name')
  const sourceValue = chosenString(config, overrides, 'source')
  const template = chosenString(config, overrides, 'template')
  const from = chosenString(config, overrides, 'from')
  const into = chosenString(config, overrides, 'into')
  const provider = chosenString(config, overrides, 'provider')
  const model = chosenString(config, overrides, 'model')
  const apiKeyEnv = chosenString(config, overrides, 'apiKeyEnv')
  const baseUrl = chosenString(config, overrides, 'baseUrl')
  const protocol = chosenString(config, overrides, 'protocol')
  const brief = chosenString(config, overrides, 'brief')

  let source: SourceFlag | undefined
  if (!requiredMissing(sourceValue)) {
    const normalized = sourceValue!.trim().toLowerCase()
    source = SOURCE_FLAGS.find((known) => known === normalized)
    if (!source) invalid('source', 'Agent source is not supported.')
  }

  const missing: string[] = []
  if (requiredMissing(name)) missing.push('name')
  if (requiredMissing(sourceValue)) missing.push('source')
  if (source === 'template' && requiredMissing(template)) missing.push('template')
  if ((source === 'local' || source === 'repository') && requiredMissing(from)) missing.push('from')
  if (requiredMissing(provider)) missing.push('provider')
  if (requiredMissing(model)) missing.push('model')
  if (requiredMissing(apiKeyEnv)) missing.push('apiKeyEnv')
  if (requiredMissing(brief)) missing.push('brief')
  if (missing.length > 0) {
    throw new AgentError('missing_inputs', 'Agent mode is missing required inputs.', {
      missing: Object.freeze(missing),
    })
  }

  const forceOverride = overrides.force
  const launchOverride = overrides.launch
  if (forceOverride !== undefined && typeof forceOverride !== 'boolean') invalid('force')
  if (launchOverride !== undefined && typeof launchOverride !== 'boolean') invalid('launch')
  const force = forceOverride ?? configBoolean(config, 'force') ?? false
  const launch = launchOverride ?? configBoolean(config, 'launch') ?? true

  const options: CliOptions = {
    name: name!,
    source,
    // A source flag replaces the config's source choice as one unit. Details
    // that belong to the old config source cannot contradict the new choice,
    // but an explicitly contradictory detail flag is still passed through and refused.
    template:
      overrides.source === undefined || source === 'template'
        ? template
        : overrides.template,
    from:
      overrides.source === undefined || source === 'local' || source === 'repository'
        ? from
        : overrides.from,
    into,
    force,
    yes: false,
    agent: false,
    json: false,
    help: false,
    version: false,
  }
  let selection
  try {
    selection = selectionFrom(options)
  } catch {
    return invalid('source', 'Agent source settings contradict each other.')
  }
  if (!selection) invalid('source', 'Agent source is required.')

  return createHarnessRequest(
    {
      project: name,
      selection,
      baseDirectory,
      destination: into,
      force,
      provider: { provider, apiKeyEnv, baseUrl, protocol },
      model,
      brief,
      launch,
    },
    environment,
  )
}
