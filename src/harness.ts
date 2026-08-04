/**
 * The one validated request both front ends produce.
 *
 * It carries an intent and the plan derived from it, and no key material of any
 * kind. The brief that reaches a provider is *generated here* from the plan
 * rather than accepted from a caller — there is no way to hand the model a
 * description of the game that the harness did not itself derive, which is what
 * keeps the plan and what gets built the same thing.
 */

import { posix, win32 } from 'node:path'

import { parseMmoIntent, type MmoIntent } from './intent.js'
import { projectFrom } from './naming.js'
import { planBrief, type ImplementationPlan } from './plan.js'
import { planMmo, selectionForPlan } from './planner.js'
import {
  requireApiKeyEnvironment,
  resolveProvider,
  type ProviderInput,
  type ResolvedProvider,
} from './providers.js'
import type { ProjectIdentity, SourceSelection } from './source.js'

export const MAX_MODEL_LENGTH = 256
export const MAX_BRIEF_LENGTH = 32_000
export const DEFAULT_SECRET_GUARD_MAX_DEPTH = 32
export const DEFAULT_SECRET_GUARD_MAX_NODES = 10_000

export type HarnessRequestErrorCode =
  | 'invalid_project'
  | 'invalid_base_directory'
  | 'invalid_destination'
  | 'invalid_force'
  | 'invalid_provider_config'
  | 'invalid_model'
  | 'invalid_launch'
  | 'secret_fields'
  | 'config_too_deep'
  | 'config_too_large'
  | 'cyclic_config'

export type HarnessRequestErrorDetails =
  | { readonly field: string }
  | { readonly fields: readonly string[] }

export class HarnessRequestError extends Error {
  override readonly name = 'HarnessRequestError'

  constructor(
    readonly code: HarnessRequestErrorCode,
    message: string,
    readonly details: HarnessRequestErrorDetails,
  ) {
    super(message)
  }
}

/** Untrusted, parsed request data. No credential value is part of this shape. */
export interface HarnessRequestInput {
  readonly intent?: unknown
  readonly baseDirectory?: unknown
  readonly destination?: unknown
  readonly force?: unknown
  readonly provider?: unknown
  readonly model?: unknown
  readonly launch?: unknown
}

/** The common, credential-free request used by both people and automation. */
export interface HarnessRequest {
  readonly project: ProjectIdentity
  readonly intent: MmoIntent
  readonly plan: ImplementationPlan
  /** Derived from the plan's reference decision, never chosen by a caller. */
  readonly selection: SourceSelection
  readonly baseDirectory: string
  readonly destination?: string
  readonly force: boolean
  readonly provider: ResolvedProvider
  readonly model: string
  /** The plan, rendered for one system instruction. Derived, never supplied. */
  readonly brief: string
  readonly launch: boolean
}

export interface SecretGuardLimits {
  readonly maxDepth?: number
  readonly maxNodes?: number
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(code: HarnessRequestErrorCode, field: string, message: string): never {
  throw new HarnessRequestError(code, message, { field })
}

function projectIdentity(name: string): ProjectIdentity {
  try {
    return projectFrom(name)
  } catch {
    return invalid('invalid_project', 'intent.name', 'Project name is not valid.')
  }
}

function nonblank(value: unknown, field: string, code: HarnessRequestErrorCode): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return invalid(code, field, `${field} must be a nonblank string.`)
  }
  return value.trim()
}

function normalizedProvider(value: unknown): ProviderInput {
  if (!isRecord(value) || typeof value.provider !== 'string') {
    return invalid('invalid_provider_config', 'provider', 'Provider configuration is not valid.')
  }
  for (const field of ['protocol', 'baseUrl', 'apiKeyEnv'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      return invalid(
        'invalid_provider_config',
        `provider.${field}`,
        'Provider configuration field is not valid.',
      )
    }
  }
  return {
    provider: value.provider,
    protocol: value.protocol as string | undefined,
    baseUrl: value.baseUrl as string | undefined,
    apiKeyEnv: value.apiKeyEnv as string | undefined,
  }
}

function boundedModel(value: unknown): string {
  const text = nonblank(value, 'model', 'invalid_model')
  if (text.length > MAX_MODEL_LENGTH) {
    return invalid('invalid_model', 'model', 'model is longer than the supported limit.')
  }
  return text
}

function absoluteBaseDirectory(value: unknown): string {
  const directory = nonblank(value, 'baseDirectory', 'invalid_base_directory')
  if (!posix.isAbsolute(directory) && !win32.isAbsolute(directory)) {
    return invalid(
      'invalid_base_directory',
      'baseDirectory',
      'baseDirectory must be an absolute path.',
    )
  }
  return directory
}

export function createHarnessRequest(
  input: HarnessRequestInput,
  environment: Readonly<Record<string, string | undefined>>,
): HarnessRequest {
  assertSafeConfigFields(input)

  // The intent is validated, then planned, before anything is looked at on
  // disk. Every downstream decision — where it lands, what gets cloned, what
  // the model is told — comes out of the plan rather than out of a caller.
  const intent = parseMmoIntent(input.intent)
  const project = projectIdentity(intent.name)
  const plan = planMmo(intent)
  const selection = selectionForPlan(plan)
  const baseDirectory = absoluteBaseDirectory(input.baseDirectory)
  const destination =
    input.destination === undefined
      ? undefined
      : nonblank(input.destination, 'destination', 'invalid_destination')
  if (input.force !== undefined && typeof input.force !== 'boolean') {
    return invalid('invalid_force', 'force', 'force must be a boolean.')
  }
  if (typeof input.launch !== 'boolean') {
    return invalid('invalid_launch', 'launch', 'launch must be a boolean.')
  }

  const provider = resolveProvider(normalizedProvider(input.provider))
  requireApiKeyEnvironment(provider, environment)

  return Object.freeze({
    project,
    intent,
    plan,
    selection,
    baseDirectory,
    ...(destination === undefined ? {} : { destination }),
    force: input.force ?? false,
    provider,
    model: boundedModel(input.model),
    brief: planBrief(plan),
    launch: input.launch,
  })
}

function pathFor(parent: string, field: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field)
    ? `${parent}.${field}`
    : `${parent}[${JSON.stringify(field)}]`
}

function secretLooking(field: string): boolean {
  // This exact spelling is a reference to inherited state, never key material.
  if (field === 'apiKeyEnv') return false

  const words = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const dangerous = new Set(['key', 'token', 'secret', 'password', 'credential', 'credentials'])
  if (words.some((word) => dangerous.has(word))) return true

  const joined = words.join('')
  return [
    'apikey',
    'accesstoken',
    'authtoken',
    'secret',
    'password',
    'credential',
    'credentials',
  ].some((word) => joined === word || joined.endsWith(word))
}

export function assertSafeConfigFields(value: unknown, limits: SecretGuardLimits = {}): void {
  const maxDepth = limits.maxDepth ?? DEFAULT_SECRET_GUARD_MAX_DEPTH
  const maxNodes = limits.maxNodes ?? DEFAULT_SECRET_GUARD_MAX_NODES
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
    return invalid('config_too_deep', '$', 'Config traversal depth limit is not valid.')
  }
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) {
    return invalid('config_too_large', '$', 'Config traversal node limit is not valid.')
  }

  const secretPaths: string[] = []
  const active = new WeakSet<object>()
  let nodes = 0

  const visit = (current: unknown, path: string, depth: number): void => {
    nodes += 1
    if (nodes > maxNodes) {
      throw new HarnessRequestError('config_too_large', 'Config contains too many values.', {
        field: path,
      })
    }
    if (depth > maxDepth) {
      throw new HarnessRequestError('config_too_deep', 'Config is nested too deeply.', { field: path })
    }
    if (typeof current !== 'object' || current === null) return
    if (active.has(current)) {
      throw new HarnessRequestError('cyclic_config', 'Config contains a cycle.', { field: path })
    }

    active.add(current)
    try {
      for (const field of Object.keys(current)) {
        const childPath = Array.isArray(current) && /^\d+$/.test(field)
          ? `${path}[${field}]`
          : pathFor(path, field)
        if (secretLooking(field)) secretPaths.push(childPath)

        // Parsed JSON has data properties. Reading the descriptor avoids invoking a hostile getter.
        const descriptor = Object.getOwnPropertyDescriptor(current, field)
        if (descriptor && 'value' in descriptor) visit(descriptor.value, childPath, depth + 1)
      }
    } finally {
      active.delete(current)
    }
  }

  visit(value, '$', 0)
  if (secretPaths.length > 0) {
    throw new HarnessRequestError(
      'secret_fields',
      'Config must reference an API key environment variable, not contain credential fields.',
      { fields: Object.freeze(secretPaths) },
    )
  }
}
