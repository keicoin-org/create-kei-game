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

  const actionIds = new Set<string>(); const actionById = new Map<string, any>()
  if (!Array.isArray(recipe.actions) || recipe.actions.length < 2 || recipe.actions.length > 12) problems.push('invalid_actions')
  for (const action of Array.isArray(recipe.actions) ? recipe.actions : []) {
    if (!exact(action, ['id','kind','anticipationMs','contactMs','recoveryMs','cooldownMs','interrupt','cancel','events','cueOverrides']) || !id(action.id) || actionIds.has(action.id) || !['interact','strike'].includes(action.kind) || !integer(action.anticipationMs, 50, 10_000) || !integer(action.contactMs, 51, 10_000) || !integer(action.recoveryMs, 52, 10_000) || !integer(action.cooldownMs, 52, 10_000) || action.contactMs <= action.anticipationMs || action.recoveryMs <= action.contactMs || action.cooldownMs < action.recoveryMs || !['before-contact','never'].includes(action.interrupt) || !['on-refusal','before-contact'].includes(action.cancel) || !Array.isArray(action.events) || action.events.join('|') !== eventNames.join('|') || !exact(action.cueOverrides, ['anticipation','contact']) || !cueNames.includes(action.cueOverrides?.anticipation) || !cueNames.includes(action.cueOverrides?.contact)) problems.push('invalid_action')
    actionIds.add(action.id); actionById.set(action.id, action)
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
    if (!exact(effect, ['event','cue','visual','cameraImpulse','hud','reducedMotion']) || effect?.event !== event || !cueNames.includes(effect?.cue) || !['telegraph','contact','status'].includes(effect?.visual) || typeof effect?.cameraImpulse !== 'number' || effect.cameraImpulse < 0 || effect.cameraImpulse > 1 || !['action','success','refusal','cooldown','recovery'].includes(effect?.hud) || !exact(effect?.reducedMotion, ['visual','hud','cameraImpulse']) || effect?.reducedMotion?.visual !== effect?.visual || effect?.reducedMotion?.hud !== effect?.hud || effect?.reducedMotion?.cameraImpulse !== 0) problems.push('invalid_effect_' + event)
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
  for (const kind of ['interact','strike']) if (![...eventById.values()].some((event) => event.kind === kind)) problems.push('missing_authority_kind_' + kind)

  if (!exact(recipe.capture, ['profile','durationMs','scriptedRemoteLabel','steps']) || recipe.capture?.profile !== 'medium' || recipe.capture?.durationMs !== recipe.durationMs || !nonempty(recipe.capture?.scriptedRemoteLabel, 80) || !/scripted|automation/i.test(recipe.capture?.scriptedRemoteLabel) || !Array.isArray(recipe.capture?.steps)) problems.push('invalid_capture')
  const feedback = (item: unknown): item is string => typeof item === 'string' && item.trim() === item && item.length >= 12 && item.length <= 160 && !/[\0-\x1f\x7f]/.test(item) && /^\S+(?: \S+)+$/.test(item)
  const stepSemantics: Record<string, RegExp> = { 'connect-local': /connect|identity/i, 'connect-scripted-remote': /scripted|automation/i, approach: /approach|distance|footstep/i, interact: /interact/i, strike: /strike|impact/i, 'remote-observe': /remote/i, refusal: /refus/i, cooldown: /cooldown/i, recovery: /recover|ready/i, reset: /reset|loop/i }
  const outcomeByStepKind: Record<string, string> = { interact: 'accepted', strike: 'accepted', 'remote-observe': 'accepted', refusal: 'refused', cooldown: 'cooldown', recovery: 'recovered' }
  const stepKinds: string[] = []; let previousMs = -1
  for (const step of Array.isArray(recipe.capture?.steps) ? recipe.capture.steps : []) {
    if (!exact(step, ['atMs','kind','actorId','targetId','actionId','expectedEventId','expectedOutcome','expectedContact','observerIds','visual','audio','hud']) || !integer(step.atMs, 0, recipe.durationMs - 1) || step.atMs <= previousMs || !['connect-local','connect-scripted-remote','approach','interact','strike','remote-observe','refusal','cooldown','recovery','reset'].includes(step.kind) || !id(step.actorId) || (step.targetId !== null && !id(step.targetId)) || (step.actionId !== null && (!id(step.actionId) || !actionIds.has(step.actionId))) || (step.expectedEventId !== null && !id(step.expectedEventId)) || (step.expectedOutcome !== null && !['accepted','refused','cooldown','recovered'].includes(step.expectedOutcome)) || (step.expectedContact !== null && typeof step.expectedContact !== 'boolean') || !Array.isArray(step.observerIds) || step.observerIds.some((entry: unknown) => !id(entry)) || new Set(step.observerIds).size !== step.observerIds.length || !feedback(step.visual) || !feedback(step.audio) || !feedback(step.hud)) problems.push('invalid_capture_step')
    if (step.visual === step.audio || step.visual === step.hud || step.audio === step.hud || (stepSemantics[step.kind] && !stepSemantics[step.kind]!.test([step.visual, step.audio, step.hud].join(' ')))) problems.push('weak_capture_feedback')
    const authority = step.expectedEventId === null ? undefined : eventById.get(step.expectedEventId)
    if (step.expectedEventId !== null && !authority) problems.push('unknown_capture_event')
    if ((step.expectedEventId === null) !== (step.expectedOutcome === null) || (step.expectedEventId === null) !== (step.expectedContact === null) || (authority && (authority.outcome !== step.expectedOutcome || authority.contact !== step.expectedContact || authority.actorId !== step.actorId || authority.targetId !== step.targetId))) problems.push('capture_authority_mismatch')
    const action = step.actionId === null ? undefined : actionById.get(step.actionId)
    if (step.kind in outcomeByStepKind && (!action || !authority || authority.kind !== action.kind || step.expectedOutcome !== outcomeByStepKind[step.kind] || (['interact','strike'].includes(step.kind) && action.kind !== step.kind))) problems.push('capture_binding_mismatch')
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
  const manifest = value as Record<string, any>; const problems: string[] = []; const ids = new Set<string>(); const roleCounts = new Map<string, number>()
  if (manifest.version !== 1 || manifest.recipeId !== 'first-encounter' || !['2d','3d'].includes(manifest.dimension) || !Array.isArray(manifest.assets) || manifest.assets.length < 1 || manifest.assets.length > 100) problems.push('invalid_manifest')
  for (const asset of Array.isArray(manifest.assets) ? manifest.assets : []) {
    if (!exact(asset, ['id','role','kind','maxBytes']) || !id(asset.id) || ids.has(asset.id) || !['character','rig-or-atlas','target','environment','audio','effect'].includes(asset.role) || !['atlas','image','model','animation','audio'].includes(asset.kind) || !Number.isInteger(asset.maxBytes) || asset.maxBytes < 1 || asset.maxBytes > 12_582_912 || (asset.role === 'audio') !== (asset.kind === 'audio') || (manifest.dimension === '2d' && ['character','rig-or-atlas','target','environment'].includes(asset.role) && !['atlas','image'].includes(asset.kind)) || (manifest.dimension === '3d' && ['character','target','environment'].includes(asset.role) && asset.kind !== 'model') || (manifest.dimension === '3d' && asset.role === 'rig-or-atlas' && asset.kind !== 'animation')) problems.push('invalid_requirement')
    ids.add(asset.id); if (typeof asset?.role === 'string') roleCounts.set(asset.role, (roleCounts.get(asset.role) ?? 0) + 1)
  }
  for (const role of ['character','rig-or-atlas','target']) if ((roleCounts.get(role) ?? 0) !== 1) problems.push(((roleCounts.get(role) ?? 0) > 1 ? 'duplicate_role_' : 'missing_role_') + role)
  for (const role of ['environment','effect','audio']) if (!(roleCounts.get(role) ?? 0)) problems.push('missing_role_' + role)
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
    if (canonical && ((source.provider === 'kenney' && (canonical.hostname !== 'kenney.nl' || !/^\/assets\/[a-z0-9][a-z0-9-]*$/.test(canonical.pathname) || source.acquisitionMode !== 'download')) || (source.provider === 'quaternius' && (canonical.hostname !== 'quaternius.com' || canonical.pathname.length < 2 || source.acquisitionMode !== 'download')) || (source.provider === 'poly-haven' && (canonical.hostname !== 'polyhaven.com' || !/^\/a\/[a-z0-9_-]+$/.test(canonical.pathname) || source.acquisitionMode !== 'api')))) problems.push('provider_policy_mismatch')
    if (licenceUrl && !['creativecommons.org','kenney.nl','quaternius.com','polyhaven.com'].includes(licenceUrl.hostname)) problems.push('licence_host_mismatch')
    if (typeof source.attribution === 'string' && (!/CC0/.test(source.attribution) || (source.provider === 'kenney' && !/kenney/i.test(source.attribution)) || (source.provider === 'quaternius' && !/quaternius/i.test(source.attribution)) || (source.provider === 'poly-haven' && !/poly[ -]?haven/i.test(source.attribution)))) problems.push('attribution_provider_mismatch')
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

/**
 * Binds recipe semantics to manifest roles, also embedded in the generated checker.
 * The recipe's actor, rig/atlas, target, and cue ids must carry the matching
 * semantic role in the admission manifest, and the manifest must still declare
 * environment and effect coverage.
 */
export function validatePolishRecipeManifestBinding(recipe: unknown, manifest: unknown): string[] {
  const record = (item: unknown): item is Record<string, any> => typeof item === 'object' && item !== null && !Array.isArray(item)
  if (!record(recipe) || !record(manifest) || !Array.isArray(manifest.assets)) return ['unbound_recipe_documents']
  const problems: string[] = []
  const roleById = new Map<string, string>()
  for (const asset of manifest.assets) if (record(asset) && typeof asset.id === 'string' && typeof asset.role === 'string') roleById.set(asset.id, asset.role)
  const bind = (assetId: unknown, role: string) => {
    if (typeof assetId !== 'string' || !roleById.has(assetId)) problems.push('undeclared_recipe_asset')
    else if (roleById.get(assetId) !== role) problems.push('role_binding_mismatch')
  }
  bind((recipe as any).actor?.characterAsset, 'character')
  bind((recipe as any).actor?.rigOrAtlas, 'rig-or-atlas')
  bind((recipe as any).target?.asset, 'target')
  for (const values of Object.values((recipe as any).cues ?? {})) for (const cue of Array.isArray(values) ? values : []) bind(cue, 'audio')
  for (const role of ['environment', 'effect']) if (![...roleById.values()].includes(role)) problems.push('missing_role_' + role)
  return [...new Set(problems)]
}

/**
 * Bounded structural admission for runtime media bytes, also embedded in the
 * generated checker. It walks PNG chunks with CRC-32, GLB chunk headers with
 * the JSON asset/mesh/animation skeleton, and Ogg pages with page CRCs and an
 * Opus/Vorbis identification header. It never decodes pixels, geometry, or
 * samples, and every loop is bounded by the already-budgeted byte length.
 */
export function validatePolishMediaBytes(kind: PolishAssetKind, bytes: Uint8Array): string[] {
  if (!(bytes instanceof Uint8Array) || bytes.length < 32 || bytes.length > 16_777_216) return ['media_bytes_unreadable']
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (offset: number, length: number) => { let out = ''; for (let index = 0; index < length; index += 1) out += String.fromCharCode(bytes[offset + index] ?? 0); return out }
  if (kind === 'atlas' || kind === 'image') {
    if (![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return ['media_png_malformed']
    const table = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c }
    const crc32 = (start: number, end: number) => { let c = 0xffffffff; for (let index = start; index < end; index += 1) c = (table[(c ^ (bytes[index] as number)) & 0xff] as number) ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
    let offset = 8; let sawHeader = false; let sawEnd = false; let dataBytes = 0; let chunks = 0
    while (offset + 12 <= bytes.length && chunks < 4_096 && !sawEnd) {
      const length = view.getUint32(offset)
      if (length > 0x7fffffff || offset + 12 + length > bytes.length) return ['media_png_malformed']
      const type = ascii(offset + 4, 4)
      if (!sawHeader) {
        if (type !== 'IHDR' || length !== 13) return ['media_png_malformed']
        const width = view.getUint32(offset + 8); const height = view.getUint32(offset + 12)
        if (width < 8 || width > 8_192 || height < 8 || height > 8_192 || ![1, 2, 4, 8, 16].includes(bytes[offset + 16] as number) || ![0, 2, 3, 4, 6].includes(bytes[offset + 17] as number) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || (bytes[offset + 20] !== 0 && bytes[offset + 20] !== 1)) return ['media_png_malformed']
        sawHeader = true
      }
      if (crc32(offset + 4, offset + 8 + length) !== view.getUint32(offset + 8 + length)) return ['media_png_malformed']
      if (type === 'IDAT') dataBytes += length
      if (type === 'IEND') sawEnd = length === 0
      offset += 12 + length; chunks += 1
    }
    return sawHeader && sawEnd && dataBytes >= 8 && offset === bytes.length ? [] : ['media_png_malformed']
  }
  if (kind === 'model' || kind === 'animation') {
    if (ascii(0, 4) !== 'glTF' || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) return ['media_glb_malformed']
    const jsonLength = view.getUint32(12, true)
    if (ascii(16, 4) !== 'JSON' || jsonLength < 2 || jsonLength % 4 !== 0 || 20 + jsonLength > bytes.length) return ['media_glb_malformed']
    let gltf: any = null
    try { gltf = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength))) } catch { return ['media_glb_malformed'] }
    if (typeof gltf !== 'object' || gltf === null || Array.isArray(gltf) || gltf.asset?.version !== '2.0') return ['media_glb_malformed']
    const binOffset = 20 + jsonLength
    if (binOffset < bytes.length) {
      if (binOffset + 8 > bytes.length) return ['media_glb_malformed']
      const binLength = view.getUint32(binOffset, true)
      if (ascii(binOffset + 4, 3) !== 'BIN' || bytes[binOffset + 7] !== 0 || binOffset + 8 + binLength !== bytes.length) return ['media_glb_malformed']
    }
    if (!Array.isArray(gltf.accessors) || gltf.accessors.length < 1 || !Array.isArray(gltf.buffers) || gltf.buffers.length < 1) return ['media_glb_malformed']
    if (kind === 'model' && (!Array.isArray(gltf.meshes) || gltf.meshes.length < 1 || !gltf.meshes.every((mesh: any) => Array.isArray(mesh?.primitives) && mesh.primitives.length > 0 && mesh.primitives.every((primitive: any) => Number.isInteger(primitive?.attributes?.POSITION))))) return ['media_glb_missing_mesh']
    if (kind === 'animation' && (!Array.isArray(gltf.animations) || gltf.animations.length < 1 || !gltf.animations.every((animation: any) => Array.isArray(animation?.channels) && animation.channels.length > 0 && Array.isArray(animation?.samplers) && animation.samplers.length > 0))) return ['media_glb_missing_animation']
    return []
  }
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) { let r = (n << 24) >>> 0; for (let k = 0; k < 8; k += 1) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0; table[n] = r }
  let offset = 0; let pages = 0; let singleStream = false; let terminated = false; let identified = false; let serial: number | null = null; let granuleLow = 0; let granuleHigh = 0
  while (offset < bytes.length && pages < 65_536) {
    if (offset + 27 > bytes.length || ascii(offset, 4) !== 'OggS' || bytes[offset + 4] !== 0) return ['media_ogg_malformed']
    const flags = bytes[offset + 5] as number
    const segments = bytes[offset + 26] as number
    if (offset + 27 + segments > bytes.length) return ['media_ogg_malformed']
    let bodyLength = 0
    for (let index = 0; index < segments; index += 1) bodyLength += bytes[offset + 27 + index] as number
    const pageEnd = offset + 27 + segments + bodyLength
    if (pageEnd > bytes.length) return ['media_ogg_malformed']
    let crc = 0
    for (let index = offset; index < pageEnd; index += 1) { const byte = index >= offset + 22 && index < offset + 26 ? 0 : (bytes[index] as number); crc = (((crc << 8) >>> 0) ^ (table[((crc >>> 24) ^ byte) & 0xff] as number)) >>> 0 }
    if (crc !== view.getUint32(offset + 22, true)) return ['media_ogg_malformed']
    const pageSerial = view.getUint32(offset + 14, true)
    if (serial === null) serial = pageSerial
    else if (pageSerial !== serial) return ['media_ogg_malformed']
    if (pages === 0) {
      if ((flags & 0x02) === 0) return ['media_ogg_malformed']
      const base = offset + 27 + segments
      const head = ascii(base, Math.min(bodyLength, 16))
      if (head.startsWith('OpusHead')) {
        if (bodyLength < 19 || bytes[base + 8] !== 1 || (bytes[base + 9] as number) < 1 || (bytes[base + 9] as number) > 8 || view.getUint32(base + 12, true) < 8_000) return ['media_ogg_not_audio']
      } else if (head.startsWith('\x01vorbis')) {
        if (bodyLength < 30 || view.getUint32(base + 7, true) !== 0 || (bytes[base + 11] as number) < 1 || view.getUint32(base + 12, true) < 8_000) return ['media_ogg_not_audio']
      } else return ['media_ogg_not_audio']
      identified = true
    }
    granuleLow = view.getUint32(offset + 6, true); granuleHigh = view.getUint32(offset + 10, true)
    if (flags & 0x02) singleStream = pages === 0
    if (flags & 0x04) terminated = pageEnd === bytes.length
    offset = pageEnd; pages += 1
  }
  return identified && singleStream && terminated && pages >= 3 && offset === bytes.length && (granuleHigh > 0 || granuleLow > 0) && !(granuleHigh === 0xffffffff && granuleLow === 0xffffffff) ? [] : ['media_ogg_malformed']
}

/**
 * Bounded retained-licence admission, also embedded in the generated checker.
 * Retained bytes must be readable UTF-8 text carrying the CC0 1.0 dedication
 * language, not merely a self-consistent hash over arbitrary bytes.
 */
export function validatePolishLicenceBytes(bytes: Uint8Array): string[] {
  if (!(bytes instanceof Uint8Array) || bytes.length < 120 || bytes.length > 262_144) return ['licence_text_mismatch']
  let text = ''
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return ['licence_text_mismatch'] }
  if (/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) || !/CC0/.test(text) || !/1\.0/.test(text) || !/public domain|no copyright|creative commons/i.test(text)) return ['licence_text_mismatch']
  return []
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
  const roleBytes = new Map<PolishAssetRole, number>(); let aggregate = sources.credits.bytes
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
    aggregate += source.sourceFile.bytes + source.licence.bytes
    for (const output of source.processedOutputs) { inspect(required.id, output, required.maxBytes); aggregate += output.bytes; roleBytes.set(required.role, (roleBytes.get(required.role) ?? 0) + output.bytes) }
  }
  if (aggregate > 25_165_824) problems.push({ code: 'aggregate_budget_exceeded', message: 'packaged credits, sources, licences, and outputs exceed the absolute V1 aggregate budget' })
  const pending = problems.length > 0 && problems.every((problem) => problem.code === 'missing_source' || problem.id === 'credits')
  return Object.freeze({ ok: problems.length === 0, code: problems.length === 0 ? 'polish_ready' : pending ? POLISH_PENDING_CODE : 'polish_assets_invalid', problems: Object.freeze(problems.map((problem) => Object.freeze(problem))) })
}
