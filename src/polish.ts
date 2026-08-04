import type { EffectRecipe, QualityProfile, QualityTier, SemanticCue, SemanticEvent } from './effects.js'

export const POLISH_RECIPE_VERSION = 1 as const
export const POLISH_SOURCE_MANIFEST_VERSION = 1 as const
export const POLISH_ASSET_MANIFEST_VERSION = 1 as const
export const POLISH_DURATION_MIN_MS = 25_000
export const POLISH_DURATION_MAX_MS = 35_000
export const POLISH_PENDING_CODE = 'polish_assets_pending' as const
export const POLISH_CREDITS_PATH = 'kei-mmo/content/THIRD_PARTY_ASSETS.md' as const

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
  readonly cueOverrides: { readonly anticipation: SemanticCue; readonly contact: SemanticCue }
}

export interface AuthorityEvent {
  readonly eventId: string
  readonly tick: number
  readonly actorId: string
  readonly targetId: string
  readonly kind: ActionKind
  readonly outcome: 'accepted' | 'refused' | 'cooldown' | 'recovered'
  readonly contact: boolean
}

export interface CaptureStep {
  readonly atMs: number
  readonly kind: 'connect-local' | 'connect-scripted-remote' | 'approach' | 'interact' | 'strike' | 'remote-observe' | 'refusal' | 'cooldown' | 'recovery' | 'reset'
  readonly actorId: string
  readonly targetId: string | null
  readonly actionId: string | null
  readonly expectedEventId: string | null
  readonly expectedOutcome: AuthorityEvent['outcome'] | null
  readonly expectedContact: boolean | null
  readonly observerIds: readonly string[]
  readonly visual: string
  readonly audio: string
  readonly hud: string
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
  readonly budgets: {
    readonly referenceDevice: string
    readonly maxVisualBytes: number
    readonly maxAudioBytes: number
    readonly maxAggregateBytes: number
    readonly maxBytesByRole: Readonly<Record<PolishAssetRole, number>>
  }
  readonly authority: { readonly tickRateHz: 20; readonly events: readonly AuthorityEvent[] }
  readonly capture: {
    readonly profile: 'medium'
    readonly durationMs: number
    readonly scriptedRemoteLabel: string
    readonly steps: readonly CaptureStep[]
  }
}

export interface PolishAssetRequirement {
  readonly id: string
  readonly role: PolishAssetRole
  readonly kind: PolishAssetKind
  readonly maxBytes: number
}
export interface PolishAssetManifestV1 {
  readonly version: typeof POLISH_ASSET_MANIFEST_VERSION
  readonly recipeId: 'first-encounter'
  readonly dimension: PolishDimension
  readonly assets: readonly PolishAssetRequirement[]
}

export interface PolishSourceRecord {
  readonly id: string
  readonly canonicalUrl: string
  readonly provider: 'kenney' | 'quaternius' | 'poly-haven'
  readonly providerAssetVersion: string
  readonly acquisitionMode: 'download' | 'api'
  readonly acquiredAt: string
  readonly sourceFile: { readonly path: string; readonly sha256: string; readonly bytes: number; readonly packaged: true }
  readonly licence: { readonly id: 'CC0-1.0'; readonly referenceUrl: string; readonly filePath: string; readonly sha256: string; readonly bytes: number }
  readonly attribution: string
  readonly rawRedistribution: 'allowed'
  readonly processedOutputs: readonly { readonly path: string; readonly sha256: string; readonly bytes: number }[]
}
export interface PolishSourceManifestV1 {
  readonly version: typeof POLISH_SOURCE_MANIFEST_VERSION
  readonly credits: { readonly path: typeof POLISH_CREDITS_PATH; readonly sha256: string; readonly bytes: number }
  readonly assets: readonly PolishSourceRecord[]
}

export interface PolishAdmissionProbe { readonly size: number; readonly sha256: string; readonly isSymlink?: boolean }
export interface PolishAdmissionProblem { readonly code: string; readonly id?: string; readonly message: string }
export interface PolishAdmissionReport { readonly ok: boolean; readonly code: 'polish_ready' | typeof POLISH_PENDING_CODE | 'polish_assets_invalid'; readonly problems: readonly PolishAdmissionProblem[] }

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SHA256 = /^[a-f0-9]{64}$/
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

/** A stable collision key for every platform we package for, including Windows. */
export function portablePolishPathKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US')
}

/** Portable project-relative path: no ADS, device aliases, normalization aliases, or trailing dot/space. */
export function safePolishPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240 || value !== value.normalize('NFC')) return false
  if (value.includes('\\') || value.startsWith('/') || /[\0-\x1f\x7f]/.test(value) || /^[A-Za-z]:/.test(value)) return false
  const segments = value.split('/')
  return segments.every((segment) => segment.length > 0 && segment.length <= 100 && segment !== '.' && segment !== '..' && !segment.includes(':') && !/[. ]$/.test(segment) && !WINDOWS_DEVICE.test(segment))
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function cloneFrozen<T>(value: T): T { return deepFreeze(JSON.parse(JSON.stringify(value)) as T) }

/**
 * The authoritative V1 recipe validator. It is intentionally self-contained:
 * scaffold-polish embeds this exact function body in the generated project.
 */
export function validatePolishRecipeDocument(value: unknown): string[] {
  const problems: string[] = []
  const record = (item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)
  const exact = (item: unknown, keys: readonly string[]) => record(item) && Object.keys(item).sort().join('|') === [...keys].sort().join('|')
  const id = (item: unknown): item is string => typeof item === 'string' && item.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item)
  const hash = (item: unknown): item is string => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item) && !/^0{64}$/.test(item)
  const integer = (item: unknown, min: number, max: number) => Number.isInteger(item) && (item as number) >= min && (item as number) <= max
  const nonempty = (item: unknown, max = 160) => typeof item === 'string' && item.trim() === item && item.length > 0 && item.length <= max && !/[\0-\x1f\x7f]/.test(item)
  const cueNames = ['ambience','footstep','interaction','swing','impact','refusal','success','cooldown','recovery']
  const eventNames = ['anticipation','contact','success','refusal','cooldown','recovery']
  const roles = ['character','rig-or-atlas','target','environment','audio','effect']
  const tiers = ['low','medium','high']
  if (!exact(value, ['version','id','dimension','durationMs','styleProfileHash','sourceManifestHash','actor','target','actions','cues','effects','qualityProfiles','budgets','authority','capture'])) return ['invalid_recipe_shape']
  const recipe = value as Record<string, any>
  if (recipe.version !== 1 || recipe.id !== 'first-encounter' || !['2d','3d'].includes(recipe.dimension)) problems.push('invalid_recipe_identity')
  if (!integer(recipe.durationMs, 25_000, 35_000) || !hash(recipe.styleProfileHash) || !hash(recipe.sourceManifestHash)) problems.push('invalid_recipe_bounds')
  if (!exact(recipe.actor, ['characterAsset','rigOrAtlas']) || !id(recipe.actor?.characterAsset) || !id(recipe.actor?.rigOrAtlas)) problems.push('invalid_actor')
  if (!exact(recipe.target, ['asset','interactionRadiusM']) || !id(recipe.target?.asset) || typeof recipe.target?.interactionRadiusM !== 'number' || !Number.isFinite(recipe.target.interactionRadiusM) || recipe.target.interactionRadiusM < 0.5 || recipe.target.interactionRadiusM > 10) problems.push('invalid_target')

  const actionIds = new Set<string>()
  if (!Array.isArray(recipe.actions) || recipe.actions.length < 2 || recipe.actions.length > 12) problems.push('invalid_actions')
  for (const action of Array.isArray(recipe.actions) ? recipe.actions : []) {
    if (!exact(action, ['id','kind','anticipationMs','contactMs','recoveryMs','cooldownMs','interrupt','cancel','events','cueOverrides']) || !id(action.id) || actionIds.has(action.id) || !['interact','strike'].includes(action.kind) || !integer(action.anticipationMs, 50, 10_000) || !integer(action.contactMs, 51, 10_000) || !integer(action.recoveryMs, 52, 10_000) || !integer(action.cooldownMs, 52, 10_000) || action.contactMs <= action.anticipationMs || action.recoveryMs <= action.contactMs || action.cooldownMs < action.recoveryMs || !['before-contact','never'].includes(action.interrupt) || !['on-refusal','before-contact'].includes(action.cancel) || !Array.isArray(action.events) || action.events.join('|') !== eventNames.join('|') || !exact(action.cueOverrides, ['anticipation','contact']) || !cueNames.includes(action.cueOverrides?.anticipation) || !cueNames.includes(action.cueOverrides?.contact)) problems.push('invalid_action')
    actionIds.add(action.id)
  }
  if (!['interact','strike'].every((kind) => recipe.actions?.some((action: any) => action.kind === kind))) problems.push('missing_action_kind')

  if (!exact(recipe.cues, cueNames)) problems.push('invalid_cues')
  for (const cue of cueNames) {
    const values = recipe.cues?.[cue]
    if (!Array.isArray(values) || values.length < 1 || values.length > 8 || values.some((entry: unknown) => !id(entry)) || new Set(values).size !== values.length) problems.push('invalid_cue_' + cue)
  }
  if (!exact(recipe.effects, eventNames)) problems.push('invalid_effects')
  for (const event of eventNames) {
    const effect = recipe.effects?.[event]
    if (!exact(effect, ['event','cue','visual','cameraImpulse','hud','reducedMotion']) || effect?.event !== event || !cueNames.includes(effect?.cue) || !['telegraph','contact','status'].includes(effect?.visual) || typeof effect?.cameraImpulse !== 'number' || effect.cameraImpulse < 0 || effect.cameraImpulse > 1 || !['action','success','refusal','cooldown','recovery'].includes(effect?.hud) || !exact(effect?.reducedMotion, ['visual','hud','cameraImpulse']) || !['telegraph','contact','status'].includes(effect?.reducedMotion?.visual) || !['action','success','refusal','cooldown','recovery'].includes(effect?.reducedMotion?.hud) || effect?.reducedMotion?.cameraImpulse !== 0) problems.push('invalid_effect_' + event)
  }

  if (!exact(recipe.qualityProfiles, tiers)) problems.push('invalid_quality_profiles')
  const quality: any[] = []
  for (const tier of tiers) {
    const profile = recipe.qualityProfiles?.[tier]
    quality.push(profile)
    if (!exact(profile, ['tier','maxParticles','maxVoices','postProcessing','shadows','cameraImpulseScale','targetFps','p95FrameMs','p99FrameMs','maxLongFrameMs']) || profile?.tier !== tier || !integer(profile?.maxParticles, 0, 512) || !integer(profile?.maxVoices, 1, 64) || !Array.isArray(profile?.postProcessing) || profile.postProcessing.some((entry: unknown) => !['fxaa','bloom','ssao'].includes(String(entry))) || new Set(profile?.postProcessing).size !== profile?.postProcessing?.length || typeof profile?.shadows !== 'boolean' || typeof profile?.cameraImpulseScale !== 'number' || profile.cameraImpulseScale < 0 || profile.cameraImpulseScale > 1 || ![30,60].includes(profile?.targetFps) || typeof profile?.p95FrameMs !== 'number' || typeof profile?.p99FrameMs !== 'number' || typeof profile?.maxLongFrameMs !== 'number' || profile.p95FrameMs <= 0 || profile.p95FrameMs > profile.p99FrameMs || profile.p99FrameMs > profile.maxLongFrameMs || profile.maxLongFrameMs > 100) problems.push('invalid_quality_' + tier)
  }
  for (let index = 1; index < quality.length; index += 1) {
    const lower = quality[index - 1]; const higher = quality[index]
    if (!lower || !higher || lower.maxParticles > higher.maxParticles || lower.maxVoices > higher.maxVoices || lower.cameraImpulseScale > higher.cameraImpulseScale || (lower.shadows && !higher.shadows) || lower.postProcessing.some((entry: string) => !higher.postProcessing.includes(entry)) || lower.targetFps > higher.targetFps || higher.p95FrameMs > lower.p95FrameMs || higher.p99FrameMs > lower.p99FrameMs || higher.maxLongFrameMs > lower.maxLongFrameMs) problems.push('non_monotonic_quality')
  }

  const budgets = recipe.budgets
  if (!exact(budgets, ['referenceDevice','maxVisualBytes','maxAudioBytes','maxAggregateBytes','maxBytesByRole']) || !nonempty(budgets?.referenceDevice, 120) || !integer(budgets?.maxVisualBytes, 1, recipe.dimension === '2d' ? 4_194_304 : 12_582_912) || !integer(budgets?.maxAudioBytes, 1, 3_145_728) || !integer(budgets?.maxAggregateBytes, 1, 25_165_824) || budgets.maxAggregateBytes < budgets.maxVisualBytes + budgets.maxAudioBytes || !exact(budgets?.maxBytesByRole, roles)) problems.push('invalid_budgets')
  for (const role of roles) if (!integer(budgets?.maxBytesByRole?.[role], 1, 12_582_912)) problems.push('invalid_role_budget_' + role)

  if (!exact(recipe.authority, ['tickRateHz','events']) || recipe.authority?.tickRateHz !== 20 || !Array.isArray(recipe.authority?.events) || recipe.authority.events.length < 5 || recipe.authority.events.length > 20) problems.push('invalid_authority')
  const eventById = new Map<string, any>(); let previousTick = -1
  for (const event of Array.isArray(recipe.authority?.events) ? recipe.authority.events : []) {
    if (!exact(event, ['eventId','tick','actorId','targetId','kind','outcome','contact']) || !id(event.eventId) || eventById.has(event.eventId) || !integer(event.tick, 0, 1_000_000) || event.tick <= previousTick || !id(event.actorId) || !id(event.targetId) || !['interact','strike'].includes(event.kind) || !['accepted','refused','cooldown','recovered'].includes(event.outcome) || typeof event.contact !== 'boolean' || (event.contact !== (event.outcome === 'accepted'))) problems.push('invalid_authority_event')
    previousTick = event.tick; eventById.set(event.eventId, event)
  }
  for (const outcome of ['accepted','refused','cooldown','recovered']) if (![...eventById.values()].some((event) => event.outcome === outcome)) problems.push('missing_authority_' + outcome)

  if (!exact(recipe.capture, ['profile','durationMs','scriptedRemoteLabel','steps']) || recipe.capture?.profile !== 'medium' || recipe.capture?.durationMs !== recipe.durationMs || !nonempty(recipe.capture?.scriptedRemoteLabel, 80) || !/scripted|automation/i.test(recipe.capture?.scriptedRemoteLabel) || !Array.isArray(recipe.capture?.steps)) problems.push('invalid_capture')
  const stepKinds: string[] = []; let previousMs = -1
  for (const step of Array.isArray(recipe.capture?.steps) ? recipe.capture.steps : []) {
    if (!exact(step, ['atMs','kind','actorId','targetId','actionId','expectedEventId','expectedOutcome','expectedContact','observerIds','visual','audio','hud']) || !integer(step.atMs, 0, recipe.durationMs - 1) || step.atMs <= previousMs || !['connect-local','connect-scripted-remote','approach','interact','strike','remote-observe','refusal','cooldown','recovery','reset'].includes(step.kind) || !id(step.actorId) || (step.targetId !== null && !id(step.targetId)) || (step.actionId !== null && (!id(step.actionId) || !actionIds.has(step.actionId))) || (step.expectedEventId !== null && !id(step.expectedEventId)) || (step.expectedOutcome !== null && !['accepted','refused','cooldown','recovered'].includes(step.expectedOutcome)) || (step.expectedContact !== null && typeof step.expectedContact !== 'boolean') || !Array.isArray(step.observerIds) || step.observerIds.some((entry: unknown) => !id(entry)) || new Set(step.observerIds).size !== step.observerIds.length || !nonempty(step.visual) || !nonempty(step.audio) || !nonempty(step.hud)) problems.push('invalid_capture_step')
    const authority = step.expectedEventId === null ? undefined : eventById.get(step.expectedEventId)
    if ((step.expectedEventId === null) !== (step.expectedOutcome === null) || (step.expectedEventId === null) !== (step.expectedContact === null) || (authority && (authority.outcome !== step.expectedOutcome || authority.contact !== step.expectedContact || authority.actorId !== step.actorId || authority.targetId !== step.targetId))) problems.push('capture_authority_mismatch')
    if (step.kind === 'remote-observe' && (!authority || !step.observerIds.includes('scripted-remote'))) problems.push('missing_remote_observation')
    previousMs = step.atMs; stepKinds.push(step.kind)
  }
  const requiredSteps = ['connect-local','connect-scripted-remote','approach','interact','strike','remote-observe','refusal','cooldown','recovery','reset']
  let cursor = -1
  for (const kind of requiredSteps) { cursor = stepKinds.indexOf(kind, cursor + 1); if (cursor < 0) problems.push('missing_capture_' + kind) }
  return [...new Set(problems)]
}

/** Exact V1 asset requirement validator, also embedded in the generated checker. */
export function validatePolishAssetManifestDocument(value: unknown): string[] {
  const record = (item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)
  const exact = (item: unknown, keys: readonly string[]) => record(item) && Object.keys(item).sort().join('|') === [...keys].sort().join('|')
  const id = (item: unknown): item is string => typeof item === 'string' && item.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item)
  if (!exact(value, ['version','recipeId','dimension','assets'])) return ['invalid_manifest_shape']
  const manifest = value as Record<string, any>; const problems: string[] = []; const ids = new Set<string>()
  if (manifest.version !== 1 || manifest.recipeId !== 'first-encounter' || !['2d','3d'].includes(manifest.dimension) || !Array.isArray(manifest.assets) || manifest.assets.length < 1 || manifest.assets.length > 100) problems.push('invalid_manifest')
  for (const asset of Array.isArray(manifest.assets) ? manifest.assets : []) {
    if (!exact(asset, ['id','role','kind','maxBytes']) || !id(asset.id) || ids.has(asset.id) || !['character','rig-or-atlas','target','environment','audio','effect'].includes(asset.role) || !['atlas','image','model','animation','audio'].includes(asset.kind) || !Number.isInteger(asset.maxBytes) || asset.maxBytes < 1 || asset.maxBytes > 12_582_912 || (asset.role === 'audio') !== (asset.kind === 'audio') || (manifest.dimension === '2d' && ['character','rig-or-atlas','target','environment'].includes(asset.role) && !['atlas','image'].includes(asset.kind)) || (manifest.dimension === '3d' && ['character','target','environment'].includes(asset.role) && asset.kind !== 'model') || (manifest.dimension === '3d' && asset.role === 'rig-or-atlas' && asset.kind !== 'animation')) problems.push('invalid_requirement')
    ids.add(asset.id)
  }
  return [...new Set(problems)]
}

/** Exact V1 provenance validator, also embedded in the generated checker. */
export function validatePolishSourceManifestDocument(value: unknown): string[] {
  const record = (item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)
  const exact = (item: unknown, keys: readonly string[]) => record(item) && Object.keys(item).sort().join('|') === [...keys].sort().join('|')
  const id = (item: unknown): item is string => typeof item === 'string' && item.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item)
  const hash = (item: unknown): item is string => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item) && !/^0{64}$/.test(item)
  const portablePath = (item: unknown): item is string => {
    if (typeof item !== 'string' || item.length < 1 || item.length > 240 || item !== item.normalize('NFC') || item.includes('\\') || item.startsWith('/') || /[\0-\x1f\x7f]/.test(item) || /^[A-Za-z]:/.test(item)) return false
    return item.split('/').every((part) => part.length > 0 && part.length <= 100 && part !== '.' && part !== '..' && !part.includes(':') && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))
  }
  const pathKey = (item: string) => item.normalize('NFKC').toLocaleLowerCase('en-US')
  const url = (item: unknown) => { try { if (typeof item !== 'string' || item.length > 500) return null; const parsed = new URL(item); return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && !parsed.search && !parsed.hash ? parsed : null } catch { return null } }
  const utc = (item: unknown) => { try { return typeof item === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item) && new Date(item).toISOString() === item } catch { return false } }
  if (!exact(value, ['version','credits','assets'])) return ['invalid_sources_shape']
  const sources = value as Record<string, any>; const problems: string[] = []; const ids = new Set<string>(); const paths = new Set<string>(['kei-mmo/content/third_party_assets.md'])
  if (sources.version !== 1 || !exact(sources.credits, ['path','sha256','bytes']) || sources.credits?.path !== 'kei-mmo/content/THIRD_PARTY_ASSETS.md' || !hash(sources.credits?.sha256) || !Number.isInteger(sources.credits?.bytes) || sources.credits.bytes < 1 || sources.credits.bytes > 262_144 || !Array.isArray(sources.assets) || sources.assets.length > 100) problems.push('invalid_sources')
  for (const source of Array.isArray(sources.assets) ? sources.assets : []) {
    const canonical = url(source?.canonicalUrl); const licenceUrl = url(source?.licence?.referenceUrl)
    if (!exact(source, ['id','canonicalUrl','provider','providerAssetVersion','acquisitionMode','acquiredAt','sourceFile','licence','attribution','rawRedistribution','processedOutputs']) || !id(source.id) || ids.has(source.id) || !canonical || !['kenney','quaternius','poly-haven'].includes(source.provider) || typeof source.providerAssetVersion !== 'string' || source.providerAssetVersion.trim() !== source.providerAssetVersion || source.providerAssetVersion.length < 1 || source.providerAssetVersion.length > 120 || /^(?:latest|current)$/i.test(source.providerAssetVersion) || !['download','api'].includes(source.acquisitionMode) || !utc(source.acquiredAt) || !exact(source.sourceFile, ['path','sha256','bytes','packaged']) || !portablePath(source.sourceFile?.path) || !source.sourceFile.path.startsWith('kei-mmo/content/source-bytes/') || !hash(source.sourceFile?.sha256) || !Number.isInteger(source.sourceFile?.bytes) || source.sourceFile.bytes < 1 || source.sourceFile.bytes > 16_777_216 || source.sourceFile?.packaged !== true || !exact(source.licence, ['id','referenceUrl','filePath','sha256','bytes']) || source.licence?.id !== 'CC0-1.0' || !licenceUrl || !portablePath(source.licence?.filePath) || !source.licence.filePath.startsWith('kei-mmo/content/licenses/') || !hash(source.licence?.sha256) || !Number.isInteger(source.licence?.bytes) || source.licence.bytes < 1 || source.licence.bytes > 262_144 || typeof source.attribution !== 'string' || source.attribution.trim() !== source.attribution || source.attribution.length < 1 || source.attribution.length > 500 || source.rawRedistribution !== 'allowed' || !Array.isArray(source.processedOutputs) || source.processedOutputs.length < 1 || source.processedOutputs.length > 20) problems.push('invalid_source')
    if (canonical && ((source.provider === 'kenney' && (canonical.hostname !== 'kenney.nl' || source.acquisitionMode !== 'download')) || (source.provider === 'quaternius' && (canonical.hostname !== 'quaternius.com' || source.acquisitionMode !== 'download')) || (source.provider === 'poly-haven' && (canonical.hostname !== 'polyhaven.com' || source.acquisitionMode !== 'api')))) problems.push('provider_policy_mismatch')
    if (licenceUrl && !['creativecommons.org','kenney.nl','quaternius.com','polyhaven.com'].includes(licenceUrl.hostname)) problems.push('licence_host_mismatch')
    for (const file of [source.sourceFile, { path: source.licence?.filePath }, ...(Array.isArray(source.processedOutputs) ? source.processedOutputs : [])]) {
      if (!portablePath(file?.path)) continue
      const key = pathKey(file.path)
      if (paths.has(key)) problems.push('portable_path_collision')
      paths.add(key)
    }
    for (const output of Array.isArray(source.processedOutputs) ? source.processedOutputs : []) if (!exact(output, ['path','sha256','bytes']) || !portablePath(output.path) || !output.path.startsWith('assets/polish/') || !hash(output.sha256) || !Number.isInteger(output.bytes) || output.bytes < 1 || output.bytes > 12_582_912) problems.push('invalid_output')
    ids.add(source.id)
  }
  return [...new Set(problems)]
}

export function parsePolishRecipe(value: unknown): PolishRecipeV1 | null {
  return validatePolishRecipeDocument(value).length === 0 ? cloneFrozen(value as PolishRecipeV1) : null
}

export function parsePolishAssetManifest(value: unknown): PolishAssetManifestV1 | null {
  return validatePolishAssetManifestDocument(value).length === 0 ? cloneFrozen(value as PolishAssetManifestV1) : null
}

export function parsePolishSourceManifest(value: unknown): PolishSourceManifestV1 | null {
  return validatePolishSourceManifestDocument(value).length === 0 ? cloneFrozen(value as PolishSourceManifestV1) : null
}

export function expectedCredits(sources: PolishSourceManifestV1): string {
  const lines = ['# Third-party assets', '', 'This inventory is generated from `kei-mmo/content/sources.json`.', '']
  for (const source of [...sources.assets].sort((left, right) => left.id.localeCompare(right.id))) {
    lines.push(`## ${source.id}`, '', `- Provider: ${source.provider}`, `- Source: ${source.canonicalUrl}`, `- Version: ${source.providerAssetVersion}`, `- Licence: ${source.licence.id} (${source.licence.referenceUrl})`, `- Attribution: ${source.attribution}`, '')
  }
  return `${lines.join('\n')}\n`
}

export function admitPolishAssets(requirements: PolishAssetManifestV1, sources: PolishSourceManifestV1, probe: (path: string) => PolishAdmissionProbe | null): PolishAdmissionReport {
  const problems: PolishAdmissionProblem[] = []
  const byId = new Map(sources.assets.map((asset) => [asset.id, asset]))
  const roleBytes = new Map<PolishAssetRole, number>(); let aggregate = 0
  const inspect = (id: string, entry: { path: string; sha256: string; bytes: number }, maxBytes: number) => {
    const actual = probe(entry.path)
    if (!actual) problems.push({ code: 'file_missing', id, message: `missing ${entry.path}` })
    else if (actual.isSymlink) problems.push({ code: 'symlink_refused', id, message: `${entry.path} resolves through a link` })
    else if (actual.size !== entry.bytes || actual.size > maxBytes) problems.push({ code: 'byte_budget_mismatch', id, message: `${entry.path} violates its declared byte bound` })
    else if (actual.sha256 !== entry.sha256) problems.push({ code: 'hash_mismatch', id, message: `${entry.path} does not match its SHA-256` })
  }
  inspect('credits', sources.credits, 262_144)
  for (const required of requirements.assets) {
    const source = byId.get(required.id)
    if (!source) { problems.push({ code: 'missing_source', id: required.id, message: `required polish asset "${required.id}" has no source record` }); continue }
    inspect(required.id, source.sourceFile, 16_777_216)
    inspect(required.id, { path: source.licence.filePath, sha256: source.licence.sha256, bytes: source.licence.bytes }, 262_144)
    for (const output of source.processedOutputs) { inspect(required.id, output, required.maxBytes); aggregate += output.bytes; roleBytes.set(required.role, (roleBytes.get(required.role) ?? 0) + output.bytes) }
  }
  if (aggregate > 25_165_824) problems.push({ code: 'aggregate_budget_exceeded', message: 'processed assets exceed the absolute V1 aggregate budget' })
  const pending = problems.length > 0 && problems.every((problem) => problem.code === 'missing_source' || problem.id === 'credits')
  return Object.freeze({ ok: problems.length === 0, code: problems.length === 0 ? 'polish_ready' : pending ? POLISH_PENDING_CODE : 'polish_assets_invalid', problems: Object.freeze(problems.map((problem) => Object.freeze(problem))) })
}
