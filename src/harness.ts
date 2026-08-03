import { posix, win32 } from 'node:path'

import { projectFrom } from './naming.js'
import {
  requireApiKeyEnvironment,
  resolveProvider,
  type ProviderInput,
  type ResolvedProvider,
} from './providers.js'
import {
  KNOWN_TEMPLATES,
  parseRepositoryUrl,
  type ProjectIdentity,
  type SourceSelection,
} from './source.js'

export const MAX_MODEL_LENGTH = 256
export const MAX_BRIEF_LENGTH = 32_000
export const DEFAULT_SECRET_GUARD_MAX_DEPTH = 32
export const DEFAULT_SECRET_GUARD_MAX_NODES = 10_000

export type HarnessRequestErrorCode =
  | 'invalid_project'
  | 'invalid_source'
  | 'invalid_base_directory'
  | 'invalid_destination'
  | 'invalid_force'
  | 'invalid_provider_config'
  | 'invalid_model'
  | 'invalid_brief'
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
  readonly project?: unknown
  readonly selection?: unknown
  readonly baseDirectory?: unknown
  readonly destination?: unknown
  readonly force?: unknown
  readonly provider?: unknown
  readonly model?: unknown
  readonly brief?: unknown
  readonly launch?: unknown
}

/** The common, credential-free plan used by both people and automation. */
export interface HarnessRequest {
  readonly project: ProjectIdentity
  readonly selection: SourceSelection
  readonly baseDirectory: string
  readonly destination?: string
  readonly force: boolean
  readonly provider: ResolvedProvider
  readonly model: string
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

function normalizedProject(value: unknown): ProjectIdentity {
  if (typeof value === 'string') {
    try {
      return projectFrom(value)
    } catch {
      return invalid('invalid_project', 'project', 'Project name is not valid.')
    }
  }
  if (!isRecord(value) || typeof value.title !== 'string' || typeof value.slug !== 'string') {
    return invalid('invalid_project', 'project', 'Project must be a name or a project identity.')
  }
  try {
    const derived = projectFrom(value.title)
    if (derived.slug !== value.slug || value.title !== value.title.trim()) {
      return invalid('invalid_project', 'project', 'Project identity is not normalized.')
    }
    return derived
  } catch {
    return invalid('invalid_project', 'project', 'Project identity is not valid.')
  }
}

function nonblank(value: unknown, field: string, code: HarnessRequestErrorCode): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return invalid(code, field, `${field} must be a nonblank string.`)
  }
  return value.trim()
}

function normalizedSource(value: unknown): SourceSelection {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return invalid('invalid_source', 'selection', 'Source selection is not valid.')
  }
  switch (value.kind) {
    case 'blank':
      return { kind: 'blank' }
    case 'template': {
      const template = nonblank(value.template, 'selection.template', 'invalid_source')
      if (!KNOWN_TEMPLATES.some(({ id }) => id === template)) {
        return invalid('invalid_source', 'selection.template', 'Template is not supported.')
      }
      return { kind: 'template', template }
    }
    case 'existing':
      return {
        kind: 'existing',
        path: nonblank(value.path, 'selection.path', 'invalid_source'),
      }
    case 'repository': {
      const url = nonblank(value.url, 'selection.url', 'invalid_source')
      try {
        return { kind: 'repository', url: parseRepositoryUrl(url).url }
      } catch {
        return invalid('invalid_source', 'selection.url', 'Repository source is not valid.')
      }
    }
    default:
      return invalid('invalid_source', 'selection.kind', 'Source kind is not supported.')
  }
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

function boundedText(
  value: unknown,
  field: 'model' | 'brief',
  maximum: number,
  code: 'invalid_model' | 'invalid_brief',
): string {
  const text = nonblank(value, field, code)
  if (text.length > maximum) {
    return invalid(code, field, `${field} is longer than the supported limit.`)
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

  const project = normalizedProject(input.project)
  const selection = normalizedSource(input.selection)
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
    selection,
    baseDirectory,
    ...(destination === undefined ? {} : { destination }),
    force: input.force ?? false,
    provider,
    model: boundedText(input.model, 'model', MAX_MODEL_LENGTH, 'invalid_model'),
    brief: boundedText(input.brief, 'brief', MAX_BRIEF_LENGTH, 'invalid_brief'),
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
