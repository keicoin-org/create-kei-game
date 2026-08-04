import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'

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
export interface PolishAdmissionReport { readonly ok: boolean; readonly code: 'polish_ready' | 'polish_review_required' | typeof POLISH_PENDING_CODE | 'polish_assets_invalid'; readonly problems: readonly PolishAdmissionProblem[] }

export interface PolishSourceCatalogRecord {
  readonly id: string
  readonly dimensions: readonly PolishDimension[]
  readonly role: PolishAssetRole
  readonly kinds: readonly PolishAssetKind[]
  readonly semanticFamily: string
  readonly reviewedReuseGroup: string | null
  readonly reviewedProcessedSha256: readonly string[]
  readonly provider: 'kenney'
  readonly canonicalUrl: string
  readonly providerAssetVersion: string
  readonly acquisitionMode: 'download'
  readonly sourceArchiveUrl: string
  readonly sourceArchiveEntry: string
  readonly sourceSha256: string
  readonly sourceBytes: number
  readonly licenceReferenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/'
  readonly licenceSha256: string
  readonly licenceBytes: number
  readonly attribution: string
}

/**
 * Offline V1 admission catalog. A source claim is accepted only when its
 * provider identity and retained source/licence bytes match one of these
 * reviewed records; arbitrary provider-shaped URLs are not evidence.
 *
 * This function is self-contained because its exact body is copied into the
 * generated project checker.
 */
export function polishSourceCatalogRecord(value: unknown, sourceSha256?: unknown): PolishSourceCatalogRecord | null {
  if (typeof value !== 'string' || (sourceSha256 !== undefined && typeof sourceSha256 !== 'string')) return null
  const cc0 = 'https://creativecommons.org/publicdomain/zero/1.0/' as const
  const record = (id: string, dimensions: readonly PolishDimension[], role: PolishAssetRole, kinds: readonly PolishAssetKind[], semanticFamily: string, reviewedReuseGroup: string | null, canonicalUrl: string, providerAssetVersion: string, sourceArchiveUrl: string, sourceArchiveEntry: string, sourceSha: string, sourceBytes: number, licenceSha256: string, licenceBytes: number, attribution: string): PolishSourceCatalogRecord => ({
    id, dimensions, role, kinds, semanticFamily, reviewedReuseGroup, reviewedProcessedSha256: [], provider: 'kenney', canonicalUrl, providerAssetVersion, acquisitionMode: 'download', sourceArchiveUrl, sourceArchiveEntry, sourceSha256: sourceSha, sourceBytes, licenceReferenceUrl: cc0, licenceSha256, licenceBytes, attribution,
  })
  const tinyUrl = 'https://kenney.nl/media/pages/assets/tiny-dungeon/f8422efb44-1674742415/kenney_tiny-dungeon.zip'
  const charactersUrl = 'https://kenney.nl/media/pages/assets/animated-characters-protagonists/608191acc4-1774773108/kenney_animated-characters-protagonists.zip'
  const miniUrl = 'https://kenney.nl/media/pages/assets/mini-dungeon/6cd72dc849-1785314274/kenney_mini-dungeon.zip'
  const particleUrl = 'https://kenney.nl/media/pages/assets/particle-pack/f8fe0f8cb8-1677578741/kenney_particle-pack.zip'
  const audioUrl = 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip'
  const records: PolishSourceCatalogRecord[] = [
    ...['hero-character','hero-motion','training-sentinel','encounter-environment'].map((id) => record(id, ['2d'], id === 'hero-character' ? 'character' : id === 'hero-motion' ? 'rig-or-atlas' : id === 'training-sentinel' ? 'target' : 'environment', ['atlas'], id, id === 'hero-character' || id === 'hero-motion' ? 'hero-2d-atlas' : null, 'https://kenney.nl/assets/tiny-dungeon', '1.0', tinyUrl, 'Tilemap/tilemap.png', '5653222ac495d89e942f9b636300759b3f38e85b26e9b888676f2e9ab834095a', 5_533, '9f574a2f1f636a3db8a0665ba90212f34e2b5e61ecb533d77c05237766374111', 570, 'Kenney Tiny Dungeon 1.0, CC0')),
    record('hero-character', ['3d'], 'character', ['model'], 'hero-character', null, 'https://kenney.nl/assets/animated-characters-protagonists', '1.0', charactersUrl, 'Model/characterMedium.fbx', '18835fef534eede635b081ee7fe647d01a885550a591d2e6bf071010906167d8', 167_212, '68280323c6dca1f532c71fb248a6f344abed39a574278a2edfa27801aea3d0cd', 699, 'Kenney Animated Characters Protagonists 1.0, CC0'),
    record('hero-motion', ['3d'], 'rig-or-atlas', ['animation'], 'hero-motion', null, 'https://kenney.nl/assets/animated-characters-protagonists', '1.0', charactersUrl, 'Animations/idle.fbx', 'c8a24e0294376ee5a195c56752a13310e1c0b5f8588a4db50e094120e3e4cc74', 608_188, '68280323c6dca1f532c71fb248a6f344abed39a574278a2edfa27801aea3d0cd', 699, 'Kenney Animated Characters Protagonists 1.0, CC0'),
    record('training-sentinel', ['3d'], 'target', ['model'], 'training-sentinel', null, 'https://kenney.nl/assets/mini-dungeon', '1.6', miniUrl, 'Models/GLB format/character-orc.glb', 'e0b021c98b34a633567ca79f7c129cca48fd7919aa9e959464deba226767c284', 199_616, 'f8b470068a1c043854101c9ff7161d376ba02c36239da3c1dbdfa928b08444b6', 701, 'Kenney Mini Dungeon 1.6, CC0'),
    record('encounter-environment', ['3d'], 'environment', ['model'], 'encounter-environment', null, 'https://kenney.nl/assets/mini-dungeon', '1.6', miniUrl, 'Models/GLB format/floor.glb', 'e45e31b7b77370a9e3829b690e123ea2127a674e2726f7908f3ffb6ac2612f70', 1_796, 'f8b470068a1c043854101c9ff7161d376ba02c36239da3c1dbdfa928b08444b6', 701, 'Kenney Mini Dungeon 1.6, CC0'),
    record('encounter-effects', ['2d','3d'], 'effect', ['image'], 'encounter-effects', null, 'https://kenney.nl/assets/particle-pack', '1.0', particleUrl, 'PNG (Transparent)/slash_01.png', 'cb4787978122bb863866a1681af22a7dec39a4566f08c400f233740eb1d3730c', 25_465, 'f9e70b81d8cc07c4e07c9f2eff1d94fd371a06070b18cb67c651c41158ec2975', 651, 'Kenney Particle Pack 1.0, CC0'),
  ]
  const cues = [
    ['ambience','Audio/creak1.ogg','8a346186fd297254248cab8e8117060a52a5cf2a84f603153a762108550ea95e',15_761],
    ['footstep-a','Audio/footstep00.ogg','6fe61ef1fc3bcf0e253bf2eb64759db6cb69e2fe452f4d88cc597ecf78a3d601',9_475],
    ['footstep-b','Audio/footstep01.ogg','313472dba31fd0c855376069fa368bb5a198c27251cc8398ef464578b7047a4c',9_900],
    ['interaction','Audio/bookOpen.ogg','953390534377222bee89ac8cd9e60a58fdc037c71a4d7c18c43cd647c7f34ba8',8_273],
    ['swing','Audio/knifeSlice.ogg','4cd96dc630bed9840c15f1dd2306da2cc56a4da26a5d3f1a03c5a7265ac5e54f',15_532],
    ['impact','Audio/chop.ogg','d00c2b3c9fff07e376145c8c8c45c90e5084ec192f6ce0387db233f7b86f1486',9_370],
    ['refusal','Audio/doorClose_1.ogg','834d29c60a8a8bfb50b158cdb6b7dfa8f02812a408a1ee9703d038dfab0b1aeb',18_564],
    ['success','Audio/handleCoins.ogg','8a91f969e932df709df80ee124d86a51389eed9b67f22e5e716bc2bbf60d8dab',25_394],
    ['cooldown','Audio/bookClose.ogg','81e976532565f4372abd14e83d2684195fa548d0a28d345de221e56052454f32',9_292],
    ['recovery','Audio/drawKnife1.ogg','276403e72c3b71c47bc24db3083970c23f8e5551ffa78f436f83483c56f3f0bb',11_134],
  ] as const
  for (const [id, entry, sha, bytes] of cues) records.push(record(id, ['2d','3d'], 'audio', ['audio'], id, null, 'https://kenney.nl/assets/rpg-audio', '1.0', audioUrl, entry, sha, bytes, '5735dfd72cb64cbbceda4ebc00c380c41ca680edb82ff153aa7c9ab97614c539', 478, 'Kenney RPG Audio 1.0, CC0'))
  return records.find((candidate) => candidate.id === value && (sourceSha256 === undefined || candidate.sourceSha256 === sourceSha256)) ?? null
}

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
  const stepKinds: string[] = []; let previousMs = -1; let strikeCapture: any = null
  for (const step of Array.isArray(recipe.capture?.steps) ? recipe.capture.steps : []) {
    if (!exact(step, ['atMs','kind','actorId','targetId','actionId','expectedEventId','expectedOutcome','expectedContact','observerIds','visual','audio','hud']) || !integer(step.atMs, 0, recipe.durationMs - 1) || step.atMs <= previousMs || !['connect-local','connect-scripted-remote','approach','interact','strike','remote-observe','refusal','cooldown','recovery','reset'].includes(step.kind) || !id(step.actorId) || (step.targetId !== null && !id(step.targetId)) || (step.actionId !== null && (!id(step.actionId) || !actionIds.has(step.actionId))) || (step.expectedEventId !== null && !id(step.expectedEventId)) || (step.expectedOutcome !== null && !['accepted','refused','cooldown','recovered'].includes(step.expectedOutcome)) || (step.expectedContact !== null && typeof step.expectedContact !== 'boolean') || !Array.isArray(step.observerIds) || step.observerIds.some((entry: unknown) => !id(entry)) || new Set(step.observerIds).size !== step.observerIds.length || !feedback(step.visual) || !feedback(step.audio) || !feedback(step.hud)) problems.push('invalid_capture_step')
    const semantic = stepSemantics[step.kind]
    if (step.visual === step.audio || step.visual === step.hud || step.audio === step.hud || (semantic && ![step.visual, step.audio, step.hud].every((channel) => typeof channel === 'string' && semantic.test(channel)))) problems.push('weak_capture_feedback')
    const authority = step.expectedEventId === null ? undefined : eventById.get(step.expectedEventId)
    if (step.expectedEventId !== null && !authority) problems.push('unknown_capture_event')
    if ((step.expectedEventId === null) !== (step.expectedOutcome === null) || (step.expectedEventId === null) !== (step.expectedContact === null) || (authority && (authority.outcome !== step.expectedOutcome || authority.contact !== step.expectedContact || authority.actorId !== step.actorId || authority.targetId !== step.targetId))) problems.push('capture_authority_mismatch')
    const action = step.actionId === null ? undefined : actionById.get(step.actionId)
    if (step.kind in outcomeByStepKind && (!action || !authority || authority.kind !== action.kind || step.expectedOutcome !== outcomeByStepKind[step.kind] || (['interact','strike'].includes(step.kind) && action.kind !== step.kind))) problems.push('capture_binding_mismatch')
    if (step.kind === 'strike') strikeCapture = step
    if (step.kind === 'remote-observe') {
      if (!authority || authority.kind !== 'strike' || !step.observerIds.includes('scripted-remote')) problems.push('missing_remote_observation')
      if (!strikeCapture || step.expectedEventId !== strikeCapture.expectedEventId || step.actionId !== strikeCapture.actionId || step.actorId !== strikeCapture.actorId || step.targetId !== strikeCapture.targetId || step.expectedOutcome !== strikeCapture.expectedOutcome || step.expectedContact !== strikeCapture.expectedContact) problems.push('remote_observation_mismatch')
    }
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
    const catalog = polishSourceCatalogRecord(source?.id, source?.sourceFile?.sha256)
    if (!exact(source, ['id','canonicalUrl','provider','providerAssetVersion','acquisitionMode','acquiredAt','sourceFile','licence','attribution','rawRedistribution','processedOutputs']) || !id(source.id) || ids.has(source.id) || !canonical || !['kenney','quaternius','poly-haven'].includes(source.provider) || typeof source.providerAssetVersion !== 'string' || source.providerAssetVersion.trim() !== source.providerAssetVersion || source.providerAssetVersion.length < 1 || source.providerAssetVersion.length > 120 || /^(?:latest|current)$/i.test(source.providerAssetVersion) || !['download','api'].includes(source.acquisitionMode) || !utc(source.acquiredAt) || !exact(source.sourceFile, ['path','sha256','bytes','packaged']) || !portablePath(source.sourceFile?.path) || !source.sourceFile.path.startsWith('kei-mmo/content/source-bytes/') || !hash(source.sourceFile?.sha256) || !Number.isInteger(source.sourceFile?.bytes) || source.sourceFile.bytes < 1 || source.sourceFile.bytes > 16_777_216 || source.sourceFile?.packaged !== true || !exact(source.licence, ['id','referenceUrl','filePath','sha256','bytes']) || source.licence?.id !== 'CC0-1.0' || !licenceUrl || !portablePath(source.licence?.filePath) || !source.licence.filePath.startsWith('kei-mmo/content/licenses/') || !hash(source.licence?.sha256) || !Number.isInteger(source.licence?.bytes) || source.licence.bytes < 1 || source.licence.bytes > 262_144 || typeof source.attribution !== 'string' || source.attribution.trim() !== source.attribution || source.attribution.length < 1 || source.attribution.length > 500 || source.rawRedistribution !== 'allowed' || !Array.isArray(source.processedOutputs) || source.processedOutputs.length < 1 || source.processedOutputs.length > 20) problems.push('invalid_source')
    if (canonical && ((source.provider === 'kenney' && (canonical.hostname !== 'kenney.nl' || !/^\/assets\/[a-z0-9][a-z0-9-]*$/.test(canonical.pathname) || source.acquisitionMode !== 'download')) || (source.provider === 'quaternius' && (canonical.hostname !== 'quaternius.com' || canonical.pathname.length < 2 || source.acquisitionMode !== 'download')) || (source.provider === 'poly-haven' && (canonical.hostname !== 'polyhaven.com' || !/^\/a\/[a-z0-9_-]+$/.test(canonical.pathname) || source.acquisitionMode !== 'api')))) problems.push('provider_policy_mismatch')
    if (licenceUrl && !['creativecommons.org','kenney.nl','quaternius.com','polyhaven.com'].includes(licenceUrl.hostname)) problems.push('licence_host_mismatch')
    if (typeof source.attribution === 'string' && (!/CC0/.test(source.attribution) || (source.provider === 'kenney' && !/kenney/i.test(source.attribution)) || (source.provider === 'quaternius' && !/quaternius/i.test(source.attribution)) || (source.provider === 'poly-haven' && !/poly[ -]?haven/i.test(source.attribution)))) problems.push('attribution_provider_mismatch')
    if (!catalog || source.provider !== catalog.provider || source.canonicalUrl !== catalog.canonicalUrl || source.providerAssetVersion !== catalog.providerAssetVersion || source.acquisitionMode !== catalog.acquisitionMode || source.sourceFile?.sha256 !== catalog.sourceSha256 || source.sourceFile?.bytes !== catalog.sourceBytes || source.licence?.referenceUrl !== catalog.licenceReferenceUrl || source.licence?.sha256 !== catalog.licenceSha256 || source.licence?.bytes !== catalog.licenceBytes || source.attribution !== catalog.attribution) problems.push('source_catalog_mismatch')
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

/** Bind retained source members and processed identities to semantic requirements. */
export function validatePolishSourceManifestBinding(manifest: unknown, sources: unknown): string[] {
  const record = (item: unknown): item is Record<string, any> => typeof item === 'object' && item !== null && !Array.isArray(item)
  if (!record(manifest) || !['2d','3d'].includes(manifest.dimension) || !Array.isArray(manifest.assets) || !record(sources) || !Array.isArray(sources.assets)) return ['unbound_source_documents']
  const problems: string[] = []
  const sourceById = new Map<string, any>()
  for (const source of sources.assets) if (record(source) && typeof source.id === 'string') sourceById.set(source.id, source)
  const outputOwners = new Map<string, { family: string; reuse: string | null; id: string }>()
  for (const requirement of manifest.assets) {
    if (!record(requirement) || typeof requirement.id !== 'string') continue
    const source = sourceById.get(requirement.id)
    if (!source) continue
    const catalog = polishSourceCatalogRecord(requirement.id, source.sourceFile?.sha256)
    if (!catalog) problems.push('source_catalog_mismatch')
    else {
      if (!catalog.dimensions.includes(manifest.dimension)) problems.push('source_catalog_dimension_mismatch')
      if (catalog.role !== requirement.role) problems.push('source_catalog_role_mismatch')
      if (!catalog.kinds.includes(requirement.kind)) problems.push('source_catalog_kind_mismatch')
    }
    const family = catalog?.semanticFamily ?? requirement.id
    const reuse = catalog?.reviewedReuseGroup ?? null
    for (const output of Array.isArray(source.processedOutputs) ? source.processedOutputs : []) {
      if (typeof output?.sha256 !== 'string') continue
      const owner = outputOwners.get(output.sha256)
      if (owner && owner.family !== family && (!reuse || reuse !== owner.reuse)) problems.push('processed_output_alias')
      else if (!owner) outputOwners.set(output.sha256, { family, reuse, id: requirement.id })
    }
  }
  return [...new Set(problems)]
}

/** Successful structural admission still requires catalog-reviewed output hashes. */
export function polishReviewProblems(manifest: unknown, sources: unknown): PolishAdmissionProblem[] {
  if (typeof manifest !== 'object' || manifest === null || !Array.isArray((manifest as any).assets) || typeof sources !== 'object' || sources === null || !Array.isArray((sources as any).assets)) return [{ code: 'review_required_unbound_documents', message: 'semantic review cannot bind malformed documents' }]
  const sourceById = new Map((sources as any).assets.map((source: any) => [source?.id, source]))
  const problems: PolishAdmissionProblem[] = []
  for (const requirement of (manifest as any).assets) {
    const source: any = sourceById.get(requirement?.id)
    const catalog = polishSourceCatalogRecord(requirement?.id, source?.sourceFile?.sha256)
    if (!catalog || !Array.isArray(source?.processedOutputs)) continue
    for (const output of source.processedOutputs) if (!catalog.reviewedProcessedSha256.includes(output?.sha256)) problems.push({ code: 'review_required_unapproved_output', id: requirement.id, message: `${output?.path ?? 'output'} has no catalog-reviewed semantic derivation` })
  }
  return problems
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
 * generated checker. It performs bounded PNG decompression and scanline
 * checks, validates GLB references against declared buffers/accessors, and
 * reconstructs Ogg packets through a real Opus audio packet. Every loop and
 * allocation is bounded by the already-budgeted input and explicit output
 * ceilings.
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
    let offset = 8; let sawHeader = false; let sawPalette = false; let sawTransparency = false; let sawData = false; let dataEnded = false; let sawEnd = false; let chunks = 0
    let width = 0; let height = 0; let bitDepth = 0; let colorType = -1; let palette: Uint8Array | null = null; let transparency: Uint8Array | null = null; const compressed: Uint8Array[] = []; let compressedBytes = 0
    while (offset + 12 <= bytes.length && chunks < 4_096 && !sawEnd) {
      const length = view.getUint32(offset)
      if (length > 0x7fffffff || offset + 12 + length > bytes.length) return ['media_png_malformed']
      const type = ascii(offset + 4, 4)
      if (!/^[A-Za-z]{4}$/.test(type) || (type !== 'IDAT' && sawData)) dataEnded = sawData
      if (!sawHeader) {
        if (type !== 'IHDR' || length !== 13) return ['media_png_malformed']
        width = view.getUint32(offset + 8); height = view.getUint32(offset + 12); bitDepth = bytes[offset + 16] as number; colorType = bytes[offset + 17] as number
        const legalDepths: Record<number, readonly number[]> = { 0: [1,2,4,8,16], 2: [8,16], 3: [1,2,4,8], 4: [8,16], 6: [8,16] }
        if (width < 8 || width > 8_192 || height < 8 || height > 8_192 || !legalDepths[colorType]?.includes(bitDepth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) return ['media_png_malformed']
        sawHeader = true
      }
      if (crc32(offset + 4, offset + 8 + length) !== view.getUint32(offset + 8 + length)) return ['media_png_malformed']
      if (type === 'IHDR' && chunks !== 0) return ['media_png_malformed']
      if (type === 'PLTE') {
        if (sawPalette || sawData || length < 3 || length > 768 || length % 3 !== 0 || colorType === 0 || colorType === 4 || (colorType === 3 && length / 3 > 2 ** bitDepth)) return ['media_png_malformed']
        sawPalette = true; palette = bytes.slice(offset + 8, offset + 8 + length)
      } else if (type === 'tRNS') {
        if (sawTransparency || sawData || (colorType === 3 && (!palette || length < 1 || length > palette.length / 3)) || (colorType === 0 && length !== 2) || (colorType === 2 && length !== 6) || ![0,2,3].includes(colorType)) return ['media_png_malformed']
        sawTransparency = true; transparency = bytes.slice(offset + 8, offset + 8 + length)
      } else if (type === 'IDAT') {
        if (dataEnded || (colorType === 3 && !sawPalette)) return ['media_png_malformed']
        sawData = true; compressedBytes += length
        if (compressedBytes > bytes.length) return ['media_png_malformed']
        compressed.push(bytes.subarray(offset + 8, offset + 8 + length))
      } else if (type === 'IEND') {
        if (length !== 0 || !sawData) return ['media_png_malformed']
        sawEnd = true
      } else if ((type.charCodeAt(0) & 0x20) === 0 && type !== 'IHDR' && type !== 'PLTE') return ['media_png_malformed']
      offset += 12 + length; chunks += 1
    }
    if (!sawHeader || !sawEnd || compressedBytes < 8 || offset !== bytes.length) return ['media_png_malformed']
    const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
    const rowBytes = Math.ceil(width * (channels[colorType] as number) * bitDepth / 8)
    const inflatedBytes = height * (rowBytes + 1)
    if (!Number.isSafeInteger(inflatedBytes) || inflatedBytes < 1 || inflatedBytes > 67_108_864) return ['media_png_malformed']
    let pixels: Uint8Array
    try { pixels = inflateSync(Buffer.concat(compressed.map((part) => Buffer.from(part))), { maxOutputLength: inflatedBytes + 1 }) } catch { return ['media_png_malformed'] }
    if (pixels.length !== inflatedBytes) return ['media_png_malformed']
    const bytesPerPixel = Math.max(1, Math.ceil((channels[colorType] as number) * bitDepth / 8))
    const previous = new Uint8Array(rowBytes); const current = new Uint8Array(rowBytes); const distinctPixels = new Set<number>()
    const paeth = (left: number, up: number, upperLeft: number) => { const estimate = left + up - upperLeft; const leftDistance = Math.abs(estimate - left); const upDistance = Math.abs(estimate - up); const upperLeftDistance = Math.abs(estimate - upperLeft); return leftDistance <= upDistance && leftDistance <= upperLeftDistance ? left : upDistance <= upperLeftDistance ? up : upperLeft }
    const observe = (row: Uint8Array, column: number) => {
      if (colorType === 3 || bitDepth < 8) {
        const bit = column * bitDepth; const sample = ((row[Math.floor(bit / 8)] as number) >>> (8 - bitDepth - (bit % 8))) & ((1 << bitDepth) - 1)
        if (colorType === 3) {
          if (!palette || sample >= palette.length / 3) return false
          const alpha = transparency && sample < transparency.length ? transparency[sample] as number : 255
          if (distinctPixels.size < 4) distinctPixels.add((((palette[sample * 3] as number) << 24) | ((palette[sample * 3 + 1] as number) << 16) | ((palette[sample * 3 + 2] as number) << 8) | alpha) >>> 0)
        } else if (distinctPixels.size < 4) distinctPixels.add(sample)
        return true
      }
      if (distinctPixels.size >= 4) return true
      const pixelBytes = (channels[colorType] as number) * (bitDepth / 8); let key = 0x811c9dc5
      for (let index = 0; index < pixelBytes; index += 1) key = Math.imul(key ^ (row[column * pixelBytes + index] as number), 0x01000193) >>> 0
      distinctPixels.add(key)
      return true
    }
    for (let row = 0; row < height; row += 1) {
      const source = row * (rowBytes + 1); const filter = pixels[source] as number
      if (filter > 4) return ['media_png_malformed']
      for (let column = 0; column < rowBytes; column += 1) {
        const encoded = pixels[source + 1 + column] as number; const left = column >= bytesPerPixel ? current[column - bytesPerPixel] as number : 0; const up = previous[column] as number; const upperLeft = column >= bytesPerPixel ? previous[column - bytesPerPixel] as number : 0
        const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft)
        current[column] = (encoded + predictor) & 0xff
      }
      for (let column = 0; column < width; column += 1) if (!observe(current, column)) return ['media_png_malformed']
      previous.set(current)
    }
    if (width * height < 256 || distinctPixels.size < 4) return ['media_png_placeholder']
    return []
  }
  if (kind === 'model' || kind === 'animation') {
    if (ascii(0, 4) !== 'glTF' || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) return ['media_glb_malformed']
    const jsonLength = view.getUint32(12, true)
    if (ascii(16, 4) !== 'JSON' || jsonLength < 2 || jsonLength % 4 !== 0 || 20 + jsonLength > bytes.length) return ['media_glb_malformed']
    let gltf: any = null
    try { gltf = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength))) } catch { return ['media_glb_malformed'] }
    if (typeof gltf !== 'object' || gltf === null || Array.isArray(gltf) || gltf.asset?.version !== '2.0') return ['media_glb_malformed']
    const binOffset = 20 + jsonLength
    if (binOffset + 8 > bytes.length) return ['media_glb_malformed']
    const binLength = view.getUint32(binOffset, true)
    if (ascii(binOffset + 4, 3) !== 'BIN' || bytes[binOffset + 7] !== 0 || binOffset + 8 + binLength !== bytes.length) return ['media_glb_malformed']
    const integer = (item: unknown, min: number, max: number) => Number.isInteger(item) && (item as number) >= min && (item as number) <= max
    const record = (item: unknown): item is Record<string, any> => typeof item === 'object' && item !== null && !Array.isArray(item)
    if (!Array.isArray(gltf.buffers) || gltf.buffers.length !== 1 || !record(gltf.buffers[0]) || 'uri' in gltf.buffers[0] || !integer(gltf.buffers[0].byteLength, 1, binLength) || binLength - gltf.buffers[0].byteLength > 3 || !Array.isArray(gltf.bufferViews) || gltf.bufferViews.length < 1 || gltf.bufferViews.length > 65_536 || !Array.isArray(gltf.accessors) || gltf.accessors.length < 1 || gltf.accessors.length > 65_536) return ['media_glb_malformed']
    const bufferViews = gltf.bufferViews
    for (const item of bufferViews) {
      const start = item?.byteOffset ?? 0
      if (!record(item) || item.buffer !== 0 || !integer(start, 0, binLength) || !integer(item.byteLength, 1, binLength) || start + item.byteLength > gltf.buffers[0].byteLength || (item.byteStride !== undefined && (!integer(item.byteStride, 4, 252) || item.byteStride % 4 !== 0))) return ['media_glb_malformed']
    }
    const componentBytes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
    const typeComponents: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
    const accessors = gltf.accessors
    for (const accessor of accessors) {
      const accessorOffset = accessor?.byteOffset ?? 0; const componentSize = componentBytes[accessor?.componentType]; const components = typeComponents[accessor?.type]
      if (!record(accessor) || 'sparse' in accessor || !integer(accessor.bufferView, 0, bufferViews.length - 1) || !componentSize || !components || !integer(accessor.count, 1, 16_777_216) || !integer(accessorOffset, 0, binLength) || accessorOffset % componentSize !== 0 || (accessor.normalized !== undefined && typeof accessor.normalized !== 'boolean')) return ['media_glb_malformed']
      const bufferView = bufferViews[accessor.bufferView]; const elementBytes = componentSize * components; const stride = bufferView.byteStride ?? elementBytes
      if (((bufferView.byteOffset ?? 0) + accessorOffset) % componentSize !== 0 || stride < elementBytes || accessorOffset + (accessor.count - 1) * stride + elementBytes > bufferView.byteLength) return ['media_glb_malformed']
    }
    const validAccessor = (item: unknown) => integer(item, 0, accessors.length - 1)
    const vertexAccessorAligned = (index: number) => { const accessor = accessors[index]; const bufferView = bufferViews[accessor.bufferView]; return ((bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)) % 4 === 0 }
    const accessorFloats = (index: number): number[] | null => {
      const accessor = accessors[index]; if (!accessor || accessor.componentType !== 5126) return null
      const bufferView = bufferViews[accessor.bufferView]; const components = typeComponents[accessor.type]; if (!bufferView || !components) return null
      const stride = bufferView.byteStride ?? components * 4; const start = binOffset + 8 + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0); const values: number[] = []
      for (let element = 0; element < accessor.count; element += 1) for (let component = 0; component < components; component += 1) { const value = view.getFloat32(start + element * stride + component * 4, true); if (!Number.isFinite(value)) return null; values.push(value) }
      return values
    }
    const accessorComponent = (index: number, element: number, component: number): number => {
      const accessor = accessors[index]; const bufferView = bufferViews[accessor.bufferView]; const componentSize = componentBytes[accessor.componentType] as number; const components = typeComponents[accessor.type] as number
      const stride = bufferView.byteStride ?? componentSize * components; const at = binOffset + 8 + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + element * stride + component * componentSize
      return accessor.componentType === 5121 ? view.getUint8(at) : accessor.componentType === 5123 ? view.getUint16(at, true) : view.getFloat32(at, true)
    }
    if (gltf.meshes !== undefined && (!Array.isArray(gltf.meshes) || gltf.meshes.length < 1 || gltf.meshes.some((mesh: any) => !record(mesh) || !Array.isArray(mesh.primitives) || mesh.primitives.length < 1 || mesh.primitives.some((primitive: any) => !record(primitive) || !record(primitive.attributes) || Object.values(primitive.attributes).some((accessor) => !validAccessor(accessor)) || (primitive.indices !== undefined && !validAccessor(primitive.indices)) || (primitive.mode !== undefined && !integer(primitive.mode, 0, 6)))))) return ['media_glb_malformed']
    if (!Array.isArray(gltf.nodes) || gltf.nodes.length < 1 || gltf.nodes.length > 65_536 || gltf.nodes.some((node: any) => !record(node) || (node.mesh !== undefined && !integer(node.mesh, 0, (gltf.meshes?.length ?? 0) - 1)) || (node.children !== undefined && (!Array.isArray(node.children) || node.children.some((child: unknown) => !integer(child, 0, gltf.nodes.length - 1)))))) return ['media_glb_malformed']
    if (!Array.isArray(gltf.scenes) || gltf.scenes.length < 1 || !integer(gltf.scene, 0, gltf.scenes.length - 1) || gltf.scenes.some((scene: any) => !record(scene) || !Array.isArray(scene.nodes) || scene.nodes.some((node: unknown) => !integer(node, 0, gltf.nodes.length - 1)))) return ['media_glb_malformed']
    const reachableNodes = new Set<number>(); const pendingNodes = [...gltf.scenes[gltf.scene].nodes]
    while (pendingNodes.length) { const node = pendingNodes.pop() as number; if (reachableNodes.has(node)) continue; reachableNodes.add(node); for (const child of gltf.nodes[node].children ?? []) pendingNodes.push(child) }
    const indexAccessor = (index: number): { count: number; value: (element: number) => number } | null => {
      const accessor = accessors[index]; if (!accessor || accessor.type !== 'SCALAR' || ![5121,5123,5125].includes(accessor.componentType)) return null
      const bufferView = bufferViews[accessor.bufferView]; const componentSize = componentBytes[accessor.componentType]; if (!bufferView || !componentSize) return null
      const stride = bufferView.byteStride ?? componentSize; const start = binOffset + 8 + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
      return { count: accessor.count, value: (element: number) => { const at = start + element * stride; return accessor.componentType === 5121 ? view.getUint8(at) : accessor.componentType === 5123 ? view.getUint16(at, true) : view.getUint32(at, true) } }
    }
    if (kind === 'model') {
      if (!Array.isArray(gltf.meshes) || gltf.meshes.length < 1 || !gltf.meshes.every((mesh: any) => Array.isArray(mesh?.primitives) && mesh.primitives.length > 0 && mesh.primitives.every((primitive: any) => record(primitive) && record(primitive.attributes) && validAccessor(primitive.attributes.POSITION) && accessors[primitive.attributes.POSITION]?.type === 'VEC3' && accessors[primitive.attributes.POSITION]?.componentType === 5126 && (primitive.indices === undefined || (validAccessor(primitive.indices) && accessors[primitive.indices]?.type === 'SCALAR' && [5121,5123,5125].includes(accessors[primitive.indices]?.componentType) && accessors[primitive.indices]?.normalized !== true))))) return ['media_glb_missing_mesh']
      const reachableMeshes = new Set<number>(); for (const nodeIndex of reachableNodes) { const mesh = gltf.nodes[nodeIndex].mesh; if (integer(mesh, 0, gltf.meshes.length - 1)) reachableMeshes.add(mesh) }
      if (reachableMeshes.size !== gltf.meshes.length) return ['media_glb_placeholder']
      const referencedPositions = new Set<string>(); let triangles = 0
      const triangle = (positions: number[], a: number, b: number, c: number) => {
        if ([a,b,c].some((index) => !integer(index, 0, positions.length / 3 - 1))) return false
        const ab = [0,1,2].map((axis) => (positions[b * 3 + axis] as number) - (positions[a * 3 + axis] as number)); const ac = [0,1,2].map((axis) => (positions[c * 3 + axis] as number) - (positions[a * 3 + axis] as number))
        const cross = [ab[1] as number * (ac[2] as number) - (ab[2] as number) * (ac[1] as number), (ab[2] as number) * (ac[0] as number) - (ab[0] as number) * (ac[2] as number), (ab[0] as number) * (ac[1] as number) - (ab[1] as number) * (ac[0] as number)]
        return cross.reduce((sum, value) => sum + value * value, 0) > 1e-10
      }
      for (const meshIndex of reachableMeshes) {
        for (const primitive of gltf.meshes[meshIndex].primitives) {
          const mode = primitive.mode ?? 4; if (![4,5,6].includes(mode)) return ['media_glb_placeholder']
          const positions = accessorFloats(primitive.attributes.POSITION); if (!positions) return ['media_glb_malformed']
          const positionCount = positions.length / 3; const indexed = primitive.indices === undefined ? null : indexAccessor(primitive.indices)
          if (primitive.indices !== undefined && !indexed) return ['media_glb_malformed']
          const indexCount = indexed?.count ?? positionCount; const at = (element: number) => indexed ? indexed.value(element) : element
          if ((mode === 4 && (indexCount < 3 || indexCount % 3 !== 0)) || (mode !== 4 && indexCount < 3)) return ['media_glb_placeholder']
          for (let element = 0; element < indexCount; element += 1) {
            const vertex = at(element); if (!integer(vertex, 0, positionCount - 1)) return ['media_glb_malformed']
            if (referencedPositions.size < 4) referencedPositions.add([0,1,2].map((axis) => { const value = positions[vertex * 3 + axis] as number; return Object.is(value, -0) ? 0 : value }).join(','))
          }
          const requireTriangle = (a: number, b: number, c: number) => { triangles += 1; return triangle(positions, a, b, c) }
          if (mode === 4) for (let index = 0; index < indexCount; index += 3) if (!requireTriangle(at(index), at(index + 1), at(index + 2))) return ['media_glb_placeholder']
          if (mode === 5) for (let index = 0; index + 2 < indexCount; index += 1) if (!requireTriangle(at(index), at(index + 1), at(index + 2))) return ['media_glb_placeholder']
          if (mode === 6) for (let index = 1; index + 1 < indexCount; index += 1) if (!requireTriangle(at(0), at(index), at(index + 1))) return ['media_glb_placeholder']
        }
      }
      if (triangles < 2 || referencedPositions.size < 4) return ['media_glb_placeholder']
    }
    if (kind === 'animation') {
      if (!Array.isArray(gltf.animations) || gltf.animations.length < 1 || !gltf.animations.every((animation: any) => Array.isArray(animation?.channels) && animation.channels.length > 0 && Array.isArray(animation?.samplers) && animation.samplers.length > 0 && animation.samplers.every((sampler: any) => record(sampler) && validAccessor(sampler.input) && validAccessor(sampler.output) && ['LINEAR','STEP','CUBICSPLINE'].includes(sampler.interpolation ?? 'LINEAR') && accessors[sampler.input]?.type === 'SCALAR' && accessors[sampler.input]?.componentType === 5126) && animation.channels.every((channel: any) => {
        if (!record(channel) || !integer(channel.sampler, 0, animation.samplers.length - 1) || !record(channel.target) || !integer(channel.target.node, 0, gltf.nodes.length - 1) || !['translation','rotation','scale'].includes(channel.target.path)) return false
        const sampler = animation.samplers[channel.sampler]; const input = accessors[sampler.input]; const output = accessors[sampler.output]; const expectedType = channel.target.path === 'rotation' ? 'VEC4' : 'VEC3'; const multiplier = sampler.interpolation === 'CUBICSPLINE' ? 3 : 1
        return output?.type === expectedType && output?.componentType === 5126 && output.count === input.count * multiplier
      }))) return ['media_glb_missing_animation']
      if (!Array.isArray(gltf.skins) || gltf.skins.length < 1 || gltf.skins.some((skin: any) => !record(skin) || !Array.isArray(skin.joints) || skin.joints.length < 2 || new Set(skin.joints).size !== skin.joints.length || skin.joints.some((joint: unknown) => !integer(joint, 0, gltf.nodes.length - 1)) || (skin.skeleton !== undefined && !integer(skin.skeleton, 0, gltf.nodes.length - 1)) || (skin.inverseBindMatrices !== undefined && (!validAccessor(skin.inverseBindMatrices) || accessors[skin.inverseBindMatrices].type !== 'MAT4' || accessors[skin.inverseBindMatrices].componentType !== 5126 || accessors[skin.inverseBindMatrices].normalized === true || accessors[skin.inverseBindMatrices].count !== skin.joints.length)))) return ['media_glb_animation_rig_missing']
      const usedSkins = new Set<number>(); const validatedSkinMeshes = new Set<string>(); const checkedInverseAccessors = new Set<number>(); let decodedSkinComponents = 0
      for (const nodeIndex of reachableNodes) { const node = gltf.nodes[nodeIndex]; if (node.skin !== undefined) {
        if (!integer(node.skin, 0, gltf.skins.length - 1) || !integer(node.mesh, 0, (gltf.meshes?.length ?? 0) - 1)) return ['media_glb_animation_rig_missing']
        const skin = gltf.skins[node.skin]
        if (skin.inverseBindMatrices !== undefined && !checkedInverseAccessors.has(skin.inverseBindMatrices)) { decodedSkinComponents += accessors[skin.inverseBindMatrices].count * 16; if (decodedSkinComponents > 16_777_216 || !accessorFloats(skin.inverseBindMatrices)) return ['media_glb_malformed']; checkedInverseAccessors.add(skin.inverseBindMatrices) }
        const skinMesh = `${node.skin}:${node.mesh}`; if (!validatedSkinMeshes.has(skinMesh)) {
        for (const primitive of gltf.meshes[node.mesh].primitives) {
          const positionIndex = primitive.attributes.POSITION; if (!validAccessor(positionIndex)) return ['media_glb_animation_rig_missing']
          const position = accessors[positionIndex]; if (position.type !== 'VEC3' || position.componentType !== 5126 || position.normalized === true || !vertexAccessorAligned(positionIndex)) return ['media_glb_malformed']
          const jointSets = new Map<number, number>(); const weightSets = new Map<number, number>()
          for (const [semantic, accessorIndex] of Object.entries(primitive.attributes)) {
            const match = /^(JOINTS|WEIGHTS)_(0|[1-9][0-9]*)$/.exec(semantic)
            if (!match) { if (semantic.startsWith('JOINTS_') || semantic.startsWith('WEIGHTS_')) return ['media_glb_malformed']; continue }
            const set = Number(match[2]); if (!Number.isSafeInteger(set)) return ['media_glb_malformed']
            ;(match[1] === 'JOINTS' ? jointSets : weightSets).set(set, accessorIndex as number)
          }
          if (!jointSets.has(0) || !weightSets.has(0)) return ['media_glb_animation_rig_missing']
          if (jointSets.size !== weightSets.size) return ['media_glb_malformed']
          decodedSkinComponents += position.count * jointSets.size * 8; if (decodedSkinComponents > 16_777_216) return ['media_glb_malformed']
          const pairs: Array<{ joints: number; weights: number }> = []
          for (let set = 0; set < jointSets.size; set += 1) {
            const joints = jointSets.get(set); const weights = weightSets.get(set); if (joints === undefined || weights === undefined) return ['media_glb_malformed']
            const jointAccessor = accessors[joints]; const weightAccessor = accessors[weights]
            if (jointAccessor.type !== 'VEC4' || ![5121,5123].includes(jointAccessor.componentType) || jointAccessor.normalized === true || weightAccessor.type !== 'VEC4' || ![5121,5123,5126].includes(weightAccessor.componentType) || (weightAccessor.componentType === 5126 ? weightAccessor.normalized === true : weightAccessor.normalized !== true) || jointAccessor.count !== position.count || weightAccessor.count !== position.count || !vertexAccessorAligned(joints) || !vertexAccessorAligned(weights)) return ['media_glb_malformed']
            pairs.push({ joints, weights })
          }
          for (let vertex = 0; vertex < position.count; vertex += 1) {
            const influences = new Set<number>(); let totalWeight = 0; let weightTolerance = 1e-4
            for (const pair of pairs) for (let component = 0; component < 4; component += 1) {
              const joint = accessorComponent(pair.joints, vertex, component); if (!integer(joint, 0, skin.joints.length - 1)) return ['media_glb_malformed']
              const weightAccessor = accessors[pair.weights]; const encodedWeight = accessorComponent(pair.weights, vertex, component); const weight = weightAccessor.componentType === 5121 ? encodedWeight / 255 : weightAccessor.componentType === 5123 ? encodedWeight / 65535 : encodedWeight
              if (weightAccessor.componentType === 5121) weightTolerance = Math.max(weightTolerance, 1 / 255 + 1e-6); else if (weightAccessor.componentType === 5123) weightTolerance = Math.max(weightTolerance, 1 / 65535 + 1e-6)
              if (!Number.isFinite(weight) || weight < 0) return ['media_glb_malformed']
              if (weight > 0) { if (influences.has(joint)) return ['media_glb_malformed']; influences.add(joint); totalWeight += weight }
            }
            if (!Number.isFinite(totalWeight)) return ['media_glb_malformed']
            if (totalWeight <= 1e-8) return ['media_glb_animation_rig_missing']
            if (Math.abs(totalWeight - 1) > weightTolerance) return ['media_glb_malformed']
          }
        }
        validatedSkinMeshes.add(skinMesh)
        }
        usedSkins.add(node.skin)
      } }
      const usedJoints = new Set<number>(); for (const skinIndex of usedSkins) for (const joint of gltf.skins[skinIndex].joints) usedJoints.add(joint)
      if (!usedSkins.size || usedJoints.size < 2) return ['media_glb_animation_rig_missing']
      let observableRigMotion = false
      for (const animation of gltf.animations) { const samplerMoves: boolean[] = []; for (const sampler of animation.samplers) {
        const times = accessorFloats(sampler.input); const values = accessorFloats(sampler.output)
        if (!times || !values || times.length < 2 || times.some((time, index) => index > 0 && time <= (times[index - 1] as number))) return ['media_glb_animation_timeline_invalid']
        const components = typeComponents[accessors[sampler.output].type] as number; const multiplier = sampler.interpolation === 'CUBICSPLINE' ? 3 : 1; const first = sampler.interpolation === 'CUBICSPLINE' ? components : 0; const last = (times.length - 1) * components * multiplier + first; let moves = false
        for (let component = 0; component < components; component += 1) if (Math.abs((values[last + component] as number) - (values[first + component] as number)) > 1e-5) moves = true
        samplerMoves.push(moves)
      } for (const channel of animation.channels) if (usedJoints.has(channel.target.node) && samplerMoves[channel.sampler]) observableRigMotion = true }
      if (!observableRigMotion) return ['media_glb_animation_no_motion']
    }
    return []
  }
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) { let r = (n << 24) >>> 0; for (let k = 0; k < 8; k += 1) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0; table[n] = r }
  const packetAscii = (packet: Uint8Array, offset: number, length: number) => { let out = ''; for (let index = 0; index < length; index += 1) out += String.fromCharCode(packet[offset + index] ?? 0); return out }
  const validTags = (packet: Uint8Array) => {
    if (packet.length < 16 || packetAscii(packet, 0, 8) !== 'OpusTags') return false
    const packetView = new DataView(packet.buffer, packet.byteOffset, packet.byteLength); const vendorLength = packetView.getUint32(8, true); let cursor = 12 + vendorLength
    if (cursor + 4 > packet.length) return false
    const comments = packetView.getUint32(cursor, true); cursor += 4
    if (comments > 65_536) return false
    for (let index = 0; index < comments; index += 1) { if (cursor + 4 > packet.length) return false; const length = packetView.getUint32(cursor, true); cursor += 4; if (cursor + length > packet.length) return false; cursor += length }
    return cursor === packet.length
  }
  const validAudioPacket = (packet: Uint8Array) => {
    if (packet.length < 2 || packetAscii(packet, 0, Math.min(packet.length, 8)) === 'OpusHead' || packetAscii(packet, 0, Math.min(packet.length, 8)) === 'OpusTags') return false
    const code = (packet[0] as number) & 3
    if (code === 0) return true
    if (code === 1) return packet.length >= 3 && (packet.length - 1) % 2 === 0
    if (code === 2) {
      if (packet.length < 4) return false
      const first = packet[1] as number; const size = first < 252 ? first : packet.length > 2 ? first + 4 * (packet[2] as number) : packet.length
      const header = first < 252 ? 2 : 3
      return size > 0 && packet.length - header - size > 0
    }
    const countByte = packet[1] as number; const frames = countByte & 0x3f
    if (frames < 1 || frames > 48) return false
    let cursor = 2; let padding = 0
    if (countByte & 0x40) { let next = 255; while (next === 255 && cursor < packet.length) { next = packet[cursor++] as number; padding += next === 255 ? 254 : next } }
    const end = packet.length - padding
    if (cursor >= end) return false
    if (!(countByte & 0x80)) return (end - cursor) % frames === 0 && (end - cursor) / frames > 0
    let used = 0
    for (let frame = 0; frame < frames - 1; frame += 1) { if (cursor >= end) return false; const first = packet[cursor++] as number; let size = first; if (first >= 252) { if (cursor >= end) return false; size = first + 4 * (packet[cursor++] as number) } if (size < 1) return false; used += size }
    return end - cursor - used > 0
  }
  let offset = 0; let pages = 0; let terminated = false; let serial: number | null = null; let expectedSequence = 0; let finalGranule = 0n
  let packetParts: Uint8Array[] = []; let packetBytes = 0; let packetIndex = 0; let identified = false; let tagged = false; let audioPackets = 0; let audioPacketBytes = 0
  while (offset < bytes.length && pages < 65_536) {
    if (offset + 27 > bytes.length || ascii(offset, 4) !== 'OggS' || bytes[offset + 4] !== 0) return ['media_ogg_malformed']
    const flags = bytes[offset + 5] as number
    if ((flags & ~0x07) !== 0 || (pages === 0) !== Boolean(flags & 0x02) || (pages > 0 && (flags & 0x02) !== 0) || Boolean(flags & 0x01) !== (packetBytes > 0) || terminated) return ['media_ogg_malformed']
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
    if (view.getUint32(offset + 18, true) !== expectedSequence) return ['media_ogg_malformed']
    const granule = view.getBigUint64(offset + 6, true)
    if (granule !== 0xffffffffffffffffn) { if (granule < finalGranule) return ['media_ogg_malformed']; finalGranule = granule }
    let bodyOffset = offset + 27 + segments
    for (let index = 0; index < segments; index += 1) {
      const length = bytes[offset + 27 + index] as number
      packetParts.push(bytes.subarray(bodyOffset, bodyOffset + length)); packetBytes += length; bodyOffset += length
      if (packetBytes > 1_048_576) return ['media_ogg_malformed']
      if (length < 255) {
        const packet = Buffer.concat(packetParts.map((part) => Buffer.from(part)), packetBytes)
        if (packetIndex === 0) {
          if (packet.length < 19 || packetAscii(packet, 0, 8) !== 'OpusHead' || packet[8] !== 1 || (packet[9] as number) < 1 || (packet[9] as number) > 8 || new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(12, true) < 8_000 || (packet[18] === 0 ? packet.length !== 19 || (packet[9] as number) > 2 : packet.length !== 21 + (packet[9] as number))) return ['media_ogg_not_audio']
          identified = true
        } else if (packetIndex === 1) {
          if (!validTags(packet)) return ['media_ogg_not_audio']
          tagged = true
        } else {
          if (!validAudioPacket(packet)) return ['media_ogg_not_audio']
          audioPackets += 1; audioPacketBytes += packet.length
        }
        packetParts = []; packetBytes = 0; packetIndex += 1
      }
    }
    if (flags & 0x04) terminated = pageEnd === bytes.length
    offset = pageEnd; pages += 1; expectedSequence += 1
  }
  if (!(identified && tagged && audioPackets > 0 && packetBytes === 0 && terminated && pages >= 3 && offset === bytes.length && finalGranule > 0n)) return ['media_ogg_malformed']
  return audioPackets >= 2 && audioPacketBytes >= 16 && finalGranule >= 4_800n ? [] : ['media_ogg_placeholder']
}

/**
 * Bounded retained-licence admission, also embedded in the generated checker.
 * Retained bytes must be readable UTF-8 text carrying the CC0 1.0 dedication
 * language, not merely a self-consistent hash over arbitrary bytes.
 */
export function validatePolishLicenceBytes(bytes: Uint8Array): string[] {
  if (!(bytes instanceof Uint8Array) || !['9f574a2f1f636a3db8a0665ba90212f34e2b5e61ecb533d77c05237766374111','5735dfd72cb64cbbceda4ebc00c380c41ca680edb82ff153aa7c9ab97614c539','68280323c6dca1f532c71fb248a6f344abed39a574278a2edfa27801aea3d0cd','f8b470068a1c043854101c9ff7161d376ba02c36239da3c1dbdfa928b08444b6','f9e70b81d8cc07c4e07c9f2eff1d94fd371a06070b18cb67c651c41158ec2975'].includes(createHash('sha256').update(bytes).digest('hex'))) return ['licence_text_mismatch']
  let text = ''
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return ['licence_text_mismatch'] }
  if (bytes.length < 400 || bytes.length > 1_024 || /[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) || !/Creative Commons (?:Zero, )?CC0/.test(text) || !text.includes('creativecommons.org/publicdomain/zero/1.0/') || !/Kenney/i.test(text)) return ['licence_text_mismatch']
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
  for (const code of validatePolishSourceManifestBinding(requirements, sources)) problems.push({ code, message: 'source catalog semantic binding rejected' })
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
  if (problems.length > 0) return Object.freeze({ ok: false, code: pending ? POLISH_PENDING_CODE : 'polish_assets_invalid', problems: Object.freeze(problems.map((problem) => Object.freeze(problem))) })
  const review = polishReviewProblems(requirements, sources)
  return Object.freeze({ ok: review.length === 0, code: review.length === 0 ? 'polish_ready' : 'polish_review_required', problems: Object.freeze(review.map((problem) => Object.freeze(problem))) })
}
