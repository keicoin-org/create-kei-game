import {
  QUALITY_TIERS,
  SEMANTIC_CUES,
  SEMANTIC_EVENTS,
  parseEffectRecipe,
  parseQualityProfile,
  qualityDegradesSafely,
  type EffectRecipe,
  type QualityProfile,
  type QualityTier,
  type SemanticCue,
  type SemanticEvent,
} from './effects.js'
import { safeRelativePath } from './content.js'

export const POLISH_RECIPE_VERSION = 1 as const
export const POLISH_SOURCE_MANIFEST_VERSION = 1 as const
export const POLISH_ASSET_MANIFEST_VERSION = 1 as const
export const POLISH_DURATION_MIN_MS = 25_000
export const POLISH_DURATION_MAX_MS = 35_000
export const POLISH_PENDING_CODE = 'polish_assets_pending' as const

export type PolishDimension = '2d' | '3d'
export type ActionKind = 'interact' | 'strike'
export type PolishAssetRole = 'character' | 'rig-or-atlas' | 'target' | 'environment' | 'audio' | 'effect'
export type PolishAssetKind = 'atlas' | 'image' | 'model' | 'animation' | 'audio'

export interface ActionRecipe {
  readonly id: string
  readonly kind: ActionKind
  readonly anticipationMs: number
  readonly contactMs: number
  readonly recoveryMs: number
  readonly cooldownMs: number
  readonly interrupt: 'before-contact' | 'never'
  readonly cancel: 'on-refusal' | 'before-contact'
  readonly events: readonly SemanticEvent[]
  readonly cueOverrides: {
    readonly anticipation: SemanticCue
    readonly contact: SemanticCue
  }
}

export interface PolishRecipeV1 {
  readonly version: typeof POLISH_RECIPE_VERSION
  readonly id: 'first-encounter'
  readonly dimension: PolishDimension
  readonly durationMs: number
  readonly styleProfileHash: string
  readonly sourceManifestHash: string
  readonly actor: { readonly characterAsset: string; readonly rigOrAtlas: string }
  readonly target: { readonly asset: string; readonly interactionRadiusM: number }
  readonly actions: readonly ActionRecipe[]
  readonly cues: Readonly<Record<SemanticCue, readonly string[]>>
  readonly effects: Readonly<Record<SemanticEvent, EffectRecipe>>
  readonly qualityProfiles: Readonly<Record<QualityTier, QualityProfile>>
  readonly capture: {
    readonly profile: 'medium'
    readonly durationMs: number
    readonly steps: readonly { readonly atMs: number; readonly action: string }[]
  }
}

export interface PolishAssetRequirement {
  readonly id: string
  readonly role: PolishAssetRole
  readonly kind: PolishAssetKind
}
export interface PolishAssetManifestV1 {
  readonly version: typeof POLISH_ASSET_MANIFEST_VERSION
  readonly recipeId: 'first-encounter'
  readonly assets: readonly PolishAssetRequirement[]
}

export interface PolishSourceRecord {
  readonly id: string
  readonly canonicalUrl: string
  readonly provider: 'kenney' | 'quaternius' | 'poly-haven' | 'local-user'
  readonly providerAssetVersion: string
  readonly acquisitionMode: 'download' | 'api' | 'local-user'
  readonly acquiredAt: string
  readonly sha256: string
  readonly licence: { readonly id: string; readonly referenceUrl: string; readonly filePath: string }
  readonly attribution: string
  readonly rawRedistribution: 'allowed' | 'processed-only' | 'forbidden'
  readonly processedOutputs: readonly { readonly path: string; readonly sha256: string }[]
}
export interface PolishSourceManifestV1 {
  readonly version: typeof POLISH_SOURCE_MANIFEST_VERSION
  readonly assets: readonly PolishSourceRecord[]
}

export interface PolishAdmissionProbe { readonly size: number; readonly sha256: string; readonly isSymlink?: boolean }
export interface PolishAdmissionProblem { readonly code: string; readonly id?: string; readonly message: string }
export interface PolishAdmissionReport { readonly ok: boolean; readonly code: 'polish_ready' | typeof POLISH_PENDING_CODE | 'polish_assets_invalid'; readonly problems: readonly PolishAdmissionProblem[] }

type RecordValue = Record<string, unknown>
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SHA256 = /^[a-f0-9]{64}$/

function record(value: unknown): value is RecordValue { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function exact(value: RecordValue, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(); const wanted = [...keys].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}
function id(value: unknown): value is string { return typeof value === 'string' && ID.test(value) && value.length <= 80 }
function hash(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value) }
export function safePolishPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 240 && safeRelativePath(value) && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
}
function safeHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' && parsed.port === '' && parsed.hash === '' && parsed.search === ''
  } catch { return false }
}

function parseAction(value: unknown): ActionRecipe | null {
  if (!record(value) || !exact(value, ['id', 'kind', 'anticipationMs', 'contactMs', 'recoveryMs', 'cooldownMs', 'interrupt', 'cancel', 'events', 'cueOverrides'])) return null
  if (!id(value.id) || !['interact', 'strike'].includes(String(value.kind))) return null
  const times = [value.anticipationMs, value.contactMs, value.recoveryMs, value.cooldownMs]
  if (times.some((time) => !Number.isInteger(time) || (time as number) < 0 || (time as number) > 10_000)) return null
  if ((value.anticipationMs as number) < 50 || (value.contactMs as number) <= (value.anticipationMs as number) || (value.recoveryMs as number) <= (value.contactMs as number) || (value.cooldownMs as number) < (value.recoveryMs as number)) return null
  if (!['before-contact', 'never'].includes(String(value.interrupt)) || !['on-refusal', 'before-contact'].includes(String(value.cancel))) return null
  if (!Array.isArray(value.events) || value.events.some((event) => !SEMANTIC_EVENTS.includes(event as SemanticEvent))) return null
  if (new Set(value.events).size !== value.events.length) return null
  for (const required of ['anticipation', 'contact', 'recovery'] as const) if (!value.events.includes(required)) return null
  if (!record(value.cueOverrides) || !exact(value.cueOverrides, ['anticipation', 'contact'])) return null
  if (!SEMANTIC_CUES.includes(value.cueOverrides.anticipation as SemanticCue) || !SEMANTIC_CUES.includes(value.cueOverrides.contact as SemanticCue)) return null
  return Object.freeze({ ...value, events: Object.freeze([...value.events]), cueOverrides: Object.freeze({ ...value.cueOverrides }) }) as unknown as ActionRecipe
}

export function parsePolishRecipe(value: unknown): PolishRecipeV1 | null {
  if (!record(value) || !exact(value, ['version', 'id', 'dimension', 'durationMs', 'styleProfileHash', 'sourceManifestHash', 'actor', 'target', 'actions', 'cues', 'effects', 'qualityProfiles', 'capture'])) return null
  if (value.version !== POLISH_RECIPE_VERSION || value.id !== 'first-encounter' || !['2d', '3d'].includes(String(value.dimension))) return null
  if (!Number.isInteger(value.durationMs) || (value.durationMs as number) < POLISH_DURATION_MIN_MS || (value.durationMs as number) > POLISH_DURATION_MAX_MS) return null
  if (!hash(value.styleProfileHash) || !hash(value.sourceManifestHash)) return null
  if (!record(value.actor) || !exact(value.actor, ['characterAsset', 'rigOrAtlas']) || !id(value.actor.characterAsset) || !id(value.actor.rigOrAtlas)) return null
  if (!record(value.target) || !exact(value.target, ['asset', 'interactionRadiusM']) || !id(value.target.asset)) return null
  if (typeof value.target.interactionRadiusM !== 'number' || !Number.isFinite(value.target.interactionRadiusM) || value.target.interactionRadiusM < 0.5 || value.target.interactionRadiusM > 10) return null
  if (!Array.isArray(value.actions) || value.actions.length < 2 || value.actions.length > 12) return null
  const actions = value.actions.map(parseAction); if (actions.some((action) => action === null)) return null
  if (new Set(actions.map((action) => action!.id)).size !== actions.length) return null
  if (!record(value.cues) || !exact(value.cues, SEMANTIC_CUES)) return null
  const cues = {} as Record<SemanticCue, readonly string[]>
  for (const cue of SEMANTIC_CUES) {
    const entries = value.cues[cue]; if (!Array.isArray(entries) || entries.length === 0 || entries.length > 8 || entries.some((entry) => !id(entry))) return null
    if (new Set(entries).size !== entries.length) return null
    cues[cue] = Object.freeze([...entries]) as readonly string[]
  }
  if (!record(value.effects) || !exact(value.effects, SEMANTIC_EVENTS)) return null
  const effects = {} as Record<SemanticEvent, EffectRecipe>
  for (const event of SEMANTIC_EVENTS) { const parsed = parseEffectRecipe(value.effects[event], event); if (parsed === null) return null; effects[event] = parsed }
  if (!record(value.qualityProfiles) || !exact(value.qualityProfiles, QUALITY_TIERS)) return null
  const qualityProfiles = {} as Record<QualityTier, QualityProfile>
  for (const tier of QUALITY_TIERS) { const parsed = parseQualityProfile(value.qualityProfiles[tier], tier); if (parsed === null) return null; qualityProfiles[tier] = parsed }
  if (!qualityDegradesSafely(qualityProfiles)) return null
  if (!record(value.capture) || !exact(value.capture, ['profile', 'durationMs', 'steps']) || value.capture.profile !== 'medium' || value.capture.durationMs !== value.durationMs || !Array.isArray(value.capture.steps)) return null
  const actionIds = new Set(actions.map((action) => action!.id))
  const steps: Array<{ atMs: number; action: string }> = []
  let previous = -1
  for (const step of value.capture.steps) {
    if (!record(step) || !exact(step, ['atMs', 'action']) || !Number.isInteger(step.atMs) || (step.atMs as number) <= previous || (step.atMs as number) >= (value.durationMs as number) || !id(step.action) || !actionIds.has(step.action)) return null
    previous = step.atMs as number; steps.push(Object.freeze({ atMs: previous, action: step.action }))
  }
  if (steps.length === 0) return null
  return Object.freeze({
    version: 1, id: 'first-encounter', dimension: value.dimension as PolishDimension, durationMs: value.durationMs as number,
    styleProfileHash: value.styleProfileHash, sourceManifestHash: value.sourceManifestHash,
    actor: Object.freeze({ characterAsset: value.actor.characterAsset, rigOrAtlas: value.actor.rigOrAtlas }),
    target: Object.freeze({ asset: value.target.asset, interactionRadiusM: value.target.interactionRadiusM }),
    actions: Object.freeze(actions as ActionRecipe[]), cues: Object.freeze(cues), effects: Object.freeze(effects), qualityProfiles: Object.freeze(qualityProfiles),
    capture: Object.freeze({ profile: 'medium', durationMs: value.durationMs as number, steps: Object.freeze(steps) }),
  })
}

export function parsePolishAssetManifest(value: unknown): PolishAssetManifestV1 | null {
  if (!record(value) || !exact(value, ['version', 'recipeId', 'assets']) || value.version !== 1 || value.recipeId !== 'first-encounter' || !Array.isArray(value.assets) || value.assets.length === 0 || value.assets.length > 100) return null
  const assets: PolishAssetRequirement[] = []
  for (const raw of value.assets) {
    if (!record(raw) || !exact(raw, ['id', 'role', 'kind']) || !id(raw.id) || !['character', 'rig-or-atlas', 'target', 'environment', 'audio', 'effect'].includes(String(raw.role)) || !['atlas', 'image', 'model', 'animation', 'audio'].includes(String(raw.kind))) return null
    assets.push(Object.freeze({ id: raw.id, role: raw.role as PolishAssetRole, kind: raw.kind as PolishAssetKind }))
  }
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length) return null
  return Object.freeze({ version: 1, recipeId: 'first-encounter', assets: Object.freeze(assets) })
}

export function parsePolishSourceManifest(value: unknown): PolishSourceManifestV1 | null {
  if (!record(value) || !exact(value, ['version', 'assets']) || value.version !== 1 || !Array.isArray(value.assets) || value.assets.length > 100) return null
  const assets: PolishSourceRecord[] = []
  for (const raw of value.assets) {
    if (!record(raw) || !exact(raw, ['id', 'canonicalUrl', 'provider', 'providerAssetVersion', 'acquisitionMode', 'acquiredAt', 'sha256', 'licence', 'attribution', 'rawRedistribution', 'processedOutputs'])) return null
    if (!id(raw.id) || !safeHttpsUrl(raw.canonicalUrl) || !['kenney', 'quaternius', 'poly-haven', 'local-user'].includes(String(raw.provider))) return null
    if (typeof raw.providerAssetVersion !== 'string' || raw.providerAssetVersion.trim() === '' || raw.providerAssetVersion.length > 120) return null
    if (!['download', 'api', 'local-user'].includes(String(raw.acquisitionMode))) return null
    if (typeof raw.acquiredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.acquiredAt) || Number.isNaN(Date.parse(raw.acquiredAt))) return null
    if (!hash(raw.sha256) || !record(raw.licence) || !exact(raw.licence, ['id', 'referenceUrl', 'filePath'])) return null
    if (typeof raw.licence.id !== 'string' || raw.licence.id.trim() === '' || !safeHttpsUrl(raw.licence.referenceUrl) || !safePolishPath(raw.licence.filePath)) return null
    if (typeof raw.attribution !== 'string' || raw.attribution.trim() === '' || raw.attribution.length > 500) return null
    if (!['allowed', 'processed-only', 'forbidden'].includes(String(raw.rawRedistribution))) return null
    if (!Array.isArray(raw.processedOutputs) || raw.processedOutputs.length === 0 || raw.processedOutputs.length > 20) return null
    const outputs: Array<{ path: string; sha256: string }> = []
    for (const output of raw.processedOutputs) {
      if (!record(output) || !exact(output, ['path', 'sha256']) || !safePolishPath(output.path) || !hash(output.sha256)) return null
      outputs.push({ path: output.path, sha256: output.sha256 })
    }
    if (new Set(outputs.map(({ path }) => path.toLowerCase())).size !== outputs.length) return null
    assets.push(Object.freeze({ ...raw, licence: Object.freeze({ ...raw.licence }), processedOutputs: Object.freeze(outputs.map(Object.freeze)) }) as unknown as PolishSourceRecord)
  }
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length) return null
  const paths = assets.flatMap((asset) => asset.processedOutputs.map(({ path }) => path.toLowerCase()))
  if (new Set(paths).size !== paths.length) return null
  return Object.freeze({ version: 1, assets: Object.freeze(assets) })
}

export function admitPolishAssets(requirements: PolishAssetManifestV1, sources: PolishSourceManifestV1, probe: (path: string) => PolishAdmissionProbe | null): PolishAdmissionReport {
  const problems: PolishAdmissionProblem[] = []
  const byId = new Map(sources.assets.map((asset) => [asset.id, asset]))
  for (const required of requirements.assets) {
    const source = byId.get(required.id)
    if (!source) { problems.push({ code: 'missing_source', id: required.id, message: `required polish asset "${required.id}" has no admitted source record` }); continue }
    for (const output of source.processedOutputs) {
      const actual = probe(output.path)
      if (!actual) problems.push({ code: 'file_missing', id: required.id, message: `"${required.id}" is missing ${output.path}` })
      else if (actual.isSymlink) problems.push({ code: 'symlink_refused', id: required.id, message: `"${required.id}" resolves through a symbolic link` })
      else if (actual.size <= 0) problems.push({ code: 'empty_file', id: required.id, message: `"${required.id}" produced an empty ${output.path}` })
      else if (actual.sha256 !== output.sha256) problems.push({ code: 'hash_mismatch', id: required.id, message: `"${required.id}" does not match its declared processed-output SHA-256` })
    }
  }
  const pending = problems.some((problem) => problem.code === 'missing_source')
  return Object.freeze({ ok: problems.length === 0, code: problems.length === 0 ? 'polish_ready' : pending ? POLISH_PENDING_CODE : 'polish_assets_invalid', problems: Object.freeze(problems.map((problem) => Object.freeze(problem))) })
}
