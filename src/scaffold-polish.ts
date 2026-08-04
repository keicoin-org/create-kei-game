/** Project-owned polish contract files. No asset bytes are selected in this slice. */

import { createHash } from 'node:crypto'

import type { QualityProfile, QualityTier, SemanticCue, SemanticEvent } from './effects.js'
import type { ImplementationPlan } from './plan.js'
import {
  POLISH_ASSET_MANIFEST_VERSION,
  POLISH_CREDITS_PATH,
  POLISH_RECIPE_VERSION,
  POLISH_SOURCE_MANIFEST_VERSION,
  expectedCredits,
  validatePolishAssetManifestDocument,
  validatePolishRecipeDocument,
  validatePolishSourceManifestDocument,
  type ActionRecipe,
  type PolishAssetKind,
  type PolishAssetManifestV1,
  type PolishAssetRequirement,
  type PolishAssetRole,
  type PolishRecipeV1,
  type PolishSourceManifestV1,
} from './polish.js'
import type { WorkspaceFile } from './source.js'
import { resolveStyle } from './style.js'

export const POLISH_DIRECTORY = 'kei-mmo/polish'
export const POLISH_RECIPE_PATH = `${POLISH_DIRECTORY}/recipe.json`
export const POLISH_QUALITY_PATH = `${POLISH_DIRECTORY}/quality.json`
export const POLISH_ASSET_MANIFEST_PATH = 'kei-mmo/content/polish-manifest.json'
export const POLISH_SOURCE_MANIFEST_PATH = 'kei-mmo/content/sources.json'
export const POLISH_STYLE_PATH = `${POLISH_DIRECTORY}/style.json`
export const POLISH_CHECK_PATH = `${POLISH_DIRECTORY}/check.mjs`
export const POLISH_ATTRIBUTION_PATH = POLISH_CREDITS_PATH

function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n` }
function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex') }
function reduced(visual: 'telegraph' | 'contact' | 'status', hud: 'action' | 'success' | 'refusal' | 'cooldown' | 'recovery') { return Object.freeze({ visual, hud, cameraImpulse: 0 as const }) }

const qualityProfiles: Readonly<Record<QualityTier, QualityProfile>> = Object.freeze({
  low: Object.freeze({ tier: 'low', maxParticles: 16, maxVoices: 8, postProcessing: Object.freeze([]), shadows: false, cameraImpulseScale: 0, targetFps: 30, p95FrameMs: 33.4, p99FrameMs: 45, maxLongFrameMs: 75 }),
  medium: Object.freeze({ tier: 'medium', maxParticles: 64, maxVoices: 16, postProcessing: Object.freeze(['fxaa', 'bloom'] as const), shadows: false, cameraImpulseScale: 0.5, targetFps: 60, p95FrameMs: 16.7, p99FrameMs: 25, maxLongFrameMs: 50 }),
  high: Object.freeze({ tier: 'high', maxParticles: 128, maxVoices: 24, postProcessing: Object.freeze(['fxaa', 'bloom', 'ssao'] as const), shadows: true, cameraImpulseScale: 1, targetFps: 60, p95FrameMs: 16.7, p99FrameMs: 25, maxLongFrameMs: 50 }),
})

const ROLE_MAX: Readonly<Record<PolishAssetRole, number>> = Object.freeze({
  character: 4_194_304,
  'rig-or-atlas': 4_194_304,
  target: 2_097_152,
  environment: 6_291_456,
  audio: 1_048_576,
  effect: 2_097_152,
})

function requirement(id: string, role: PolishAssetRole, kind: PolishAssetKind): PolishAssetRequirement {
  return Object.freeze({ id, role, kind, maxBytes: ROLE_MAX[role] })
}

export function starterPolishAssetManifest(dimension: '2d' | '3d'): PolishAssetManifestV1 {
  const visual = dimension === '2d' ? 'atlas' : 'model'
  return Object.freeze({
    version: POLISH_ASSET_MANIFEST_VERSION,
    recipeId: 'first-encounter',
    dimension,
    assets: Object.freeze([
      requirement('hero-character', 'character', visual),
      requirement('hero-motion', 'rig-or-atlas', dimension === '2d' ? 'atlas' : 'animation'),
      requirement('training-sentinel', 'target', visual),
      requirement('encounter-environment', 'environment', visual),
      requirement('encounter-effects', 'effect', 'image'),
      ...['ambience', 'footstep-a', 'footstep-b', 'interaction', 'swing', 'impact', 'refusal', 'success', 'cooldown', 'recovery']
        .map((id) => requirement(id, 'audio', 'audio')),
    ]),
  })
}

function starterRecipe(plan: ImplementationPlan, sourceManifestHash: string, styleProfileHash: string): PolishRecipeV1 {
  const dimension = plan.engine.dimension
  const action = (value: ActionRecipe) => Object.freeze(value)
  const events = Object.freeze(['anticipation', 'contact', 'success', 'refusal', 'cooldown', 'recovery'] as const)
  const actions = Object.freeze([
    action({ id: 'inspect-sentinel', kind: 'interact', anticipationMs: 180, contactMs: 360, recoveryMs: 680, cooldownMs: 900, interrupt: 'before-contact', cancel: 'on-refusal', events, cueOverrides: Object.freeze({ anticipation: 'interaction', contact: 'interaction' }) }),
    action({ id: 'strike-sentinel', kind: 'strike', anticipationMs: 220, contactMs: 440, recoveryMs: 820, cooldownMs: 1_200, interrupt: 'before-contact', cancel: 'on-refusal', events, cueOverrides: Object.freeze({ anticipation: 'swing', contact: 'impact' }) }),
  ])
  const cues: Readonly<Record<SemanticCue, readonly string[]>> = Object.freeze({
    ambience: Object.freeze(['ambience']), footstep: Object.freeze(['footstep-a', 'footstep-b']), interaction: Object.freeze(['interaction']),
    swing: Object.freeze(['swing']), impact: Object.freeze(['impact']), refusal: Object.freeze(['refusal']), success: Object.freeze(['success']),
    cooldown: Object.freeze(['cooldown']), recovery: Object.freeze(['recovery']),
  })
  const effects = Object.freeze({
    anticipation: Object.freeze({ event: 'anticipation', cue: 'swing', visual: 'telegraph', cameraImpulse: 0, hud: 'action', reducedMotion: reduced('telegraph', 'action') }),
    contact: Object.freeze({ event: 'contact', cue: 'impact', visual: 'contact', cameraImpulse: 0.35, hud: 'action', reducedMotion: reduced('contact', 'action') }),
    success: Object.freeze({ event: 'success', cue: 'success', visual: 'status', cameraImpulse: 0.15, hud: 'success', reducedMotion: reduced('status', 'success') }),
    refusal: Object.freeze({ event: 'refusal', cue: 'refusal', visual: 'status', cameraImpulse: 0, hud: 'refusal', reducedMotion: reduced('status', 'refusal') }),
    cooldown: Object.freeze({ event: 'cooldown', cue: 'cooldown', visual: 'status', cameraImpulse: 0, hud: 'cooldown', reducedMotion: reduced('status', 'cooldown') }),
    recovery: Object.freeze({ event: 'recovery', cue: 'recovery', visual: 'status', cameraImpulse: 0, hud: 'recovery', reducedMotion: reduced('status', 'recovery') }),
  } satisfies Readonly<Record<SemanticEvent, unknown>>) as PolishRecipeV1['effects']
  const authority = Object.freeze({
    tickRateHz: 20 as const,
    events: Object.freeze([
      Object.freeze({ eventId: 'event-interact', tick: 160, actorId: 'local-player', targetId: 'training-sentinel', kind: 'interact' as const, outcome: 'accepted' as const, contact: true }),
      Object.freeze({ eventId: 'event-strike', tick: 320, actorId: 'local-player', targetId: 'training-sentinel', kind: 'strike' as const, outcome: 'accepted' as const, contact: true }),
      Object.freeze({ eventId: 'event-refusal', tick: 400, actorId: 'local-player', targetId: 'training-sentinel', kind: 'strike' as const, outcome: 'refused' as const, contact: false }),
      Object.freeze({ eventId: 'event-cooldown', tick: 420, actorId: 'local-player', targetId: 'training-sentinel', kind: 'strike' as const, outcome: 'cooldown' as const, contact: false }),
      Object.freeze({ eventId: 'event-recovery', tick: 460, actorId: 'local-player', targetId: 'training-sentinel', kind: 'strike' as const, outcome: 'recovered' as const, contact: false }),
    ]),
  })
  const step = (atMs: number, kind: PolishRecipeV1['capture']['steps'][number]['kind'], actorId: string, targetId: string | null, actionId: string | null, eventId: string | null, outcome: 'accepted' | 'refused' | 'cooldown' | 'recovered' | null, contact: boolean | null, observerIds: readonly string[], visual: string, audio: string, hud: string) => Object.freeze({ atMs, kind, actorId, targetId, actionId, expectedEventId: eventId, expectedOutcome: outcome, expectedContact: contact, observerIds: Object.freeze([...observerIds]), visual, audio, hud })
  const capture = Object.freeze({
    profile: 'medium' as const, durationMs: 30_000, scriptedRemoteLabel: 'Scripted remote automation (not a live player)',
    steps: Object.freeze([
      step(500, 'connect-local', 'local-player', null, null, null, null, null, ['local-player'], 'connection state visible', 'ambience begins after gesture', 'local identity visible'),
      step(1_500, 'connect-scripted-remote', 'scripted-remote', null, null, null, null, null, ['local-player'], 'distinct remote silhouette', 'remote arrival cue', 'automation label visible'),
      step(4_000, 'approach', 'local-player', 'training-sentinel', null, null, null, null, ['local-player','scripted-remote'], 'distance telegraph closes', 'footsteps audible', 'interaction prompt visible'),
      step(8_000, 'interact', 'local-player', 'training-sentinel', 'inspect-sentinel', 'event-interact', 'accepted', true, ['local-player','scripted-remote'], 'interaction contact visible', 'interaction cue audible', 'success state visible'),
      step(16_000, 'strike', 'local-player', 'training-sentinel', 'strike-sentinel', 'event-strike', 'accepted', true, ['local-player'], 'strike contact visible', 'impact cue audible', 'progression update visible'),
      step(17_000, 'remote-observe', 'local-player', 'training-sentinel', 'strike-sentinel', 'event-strike', 'accepted', true, ['scripted-remote'], 'remote observes same contact', 'impact cue de-duplicated', 'remote outcome visible'),
      step(20_000, 'refusal', 'local-player', 'training-sentinel', 'strike-sentinel', 'event-refusal', 'refused', false, ['local-player','scripted-remote'], 'refusal cancels anticipation', 'refusal cue audible', 'refusal reason visible'),
      step(22_000, 'cooldown', 'local-player', 'training-sentinel', 'strike-sentinel', 'event-cooldown', 'cooldown', false, ['local-player'], 'cooldown telegraph visible', 'cooldown cue audible', 'cooldown timer visible'),
      step(25_000, 'recovery', 'local-player', 'training-sentinel', 'strike-sentinel', 'event-recovery', 'recovered', false, ['local-player','scripted-remote'], 'recovery pose visible', 'recovery cue audible', 'ready state visible'),
      step(28_000, 'reset', 'local-player', 'training-sentinel', null, null, null, null, ['local-player','scripted-remote'], 'sentinel reset visible', 'ambience continues', 'loop complete visible'),
    ]),
  })
  const maxVisualBytes = dimension === '2d' ? 4_194_304 : 12_582_912
  return Object.freeze({
    version: POLISH_RECIPE_VERSION, id: 'first-encounter', dimension, durationMs: 30_000,
    styleProfileHash, sourceManifestHash,
    actor: Object.freeze({ characterAsset: 'hero-character', rigOrAtlas: 'hero-motion' }),
    target: Object.freeze({ asset: 'training-sentinel', interactionRadiusM: 2.25 }), actions, cues, effects, qualityProfiles,
    budgets: Object.freeze({ referenceDevice: 'named desktop 1080p reference device (capture required)', maxVisualBytes, maxAudioBytes: 3_145_728, maxAggregateBytes: maxVisualBytes + 3_145_728 + 1_048_576, maxBytesByRole: ROLE_MAX }),
    authority, capture,
  })
}

export function polishProjectFiles(plan: ImplementationPlan): readonly WorkspaceFile[] {
  const creditsText = expectedCredits(Object.freeze({ version: POLISH_SOURCE_MANIFEST_VERSION, credits: Object.freeze({ path: POLISH_CREDITS_PATH, sha256: 'a'.repeat(64), bytes: 1 }), assets: Object.freeze([]) }))
  const sources: PolishSourceManifestV1 = Object.freeze({
    version: POLISH_SOURCE_MANIFEST_VERSION,
    credits: Object.freeze({ path: POLISH_CREDITS_PATH, sha256: sha256(creditsText), bytes: Buffer.byteLength(creditsText) }),
    assets: Object.freeze([]),
  })
  const sourceText = json(sources)
  const styleText = json(resolveStyle(plan.intent))
  const recipe = starterRecipe(plan, sha256(sourceText), sha256(styleText))
  return Object.freeze([
    { path: POLISH_ASSET_MANIFEST_PATH, contents: json(starterPolishAssetManifest(plan.engine.dimension)) },
    { path: POLISH_SOURCE_MANIFEST_PATH, contents: sourceText },
    { path: POLISH_STYLE_PATH, contents: styleText },
    { path: POLISH_RECIPE_PATH, contents: json(recipe) },
    { path: POLISH_QUALITY_PATH, contents: json({ version: 1, profiles: qualityProfiles }) },
    { path: POLISH_ATTRIBUTION_PATH, contents: creditsText },
    { path: POLISH_CHECK_PATH, contents: checkScript() },
  ])
}

function checkScript(): string {
  return `#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const validatePolishRecipeDocument = ${validatePolishRecipeDocument.toString()}
const validatePolishAssetManifestDocument = ${validatePolishAssetManifestDocument.toString()}
const validatePolishSourceManifestDocument = ${validatePolishSourceManifestDocument.toString()}
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const rootReal = realpathSync(root)
const problems = []
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const contained = (target) => { const rel = relative(rootReal, target); return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel)) }
const safePath = (value) => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 240 || value !== value.normalize('NFC') || value.includes('\\\\') || value.startsWith('/') || /[\\0-\\x1f\\x7f]/.test(value) || /^[A-Za-z]:/.test(value)) return false
  return value.split('/').every((part) => part.length > 0 && part.length <= 100 && part !== '.' && part !== '..' && !part.includes(':') && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\..*)?$/i.test(part))
}
function inspectComponents(relativePath) {
  let current = root
  for (const component of relativePath.split('/')) {
    current = resolve(current, component)
    const info = lstatSync(current)
    if (info.isSymbolicLink()) throw new Error('link_component_refused')
    const actual = realpathSync(current)
    if (!contained(actual)) throw new Error('realpath_escape')
  }
}
function secureRead(relativePath, maximumBytes, expectedBytes) {
  if (!safePath(relativePath)) throw new Error('unsafe_path')
  inspectComponents(relativePath)
  const lexical = resolve(root, ...relativePath.split('/'))
  const beforeReal = realpathSync(lexical)
  if (!contained(beforeReal)) throw new Error('realpath_escape')
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const descriptor = openSync(lexical, constants.O_RDONLY | noFollow)
  try {
    const before = fstatSync(descriptor)
    if (!before.isFile()) throw new Error('not_a_file')
    if (before.size < 1 || before.size > maximumBytes || (expectedBytes !== undefined && before.size !== expectedBytes)) throw new Error('byte_budget_mismatch')
    const bytes = Buffer.alloc(before.size); let offset = 0
    while (offset < bytes.length) { const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset); if (count === 0) throw new Error('short_read'); offset += count }
    const after = fstatSync(descriptor)
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('file_changed_during_read')
    const afterReal = realpathSync(lexical)
    if (afterReal !== beforeReal || !contained(afterReal)) throw new Error('path_changed_during_read')
    inspectComponents(relativePath)
    return bytes
  } finally { closeSync(descriptor) }
}
function readDocument(path, maximumBytes) {
  try { const raw = secureRead(path, maximumBytes); return { raw, value: JSON.parse(raw.toString('utf8')) } }
  catch (error) { problems.push({ code: 'invalid_document', id: path, message: error instanceof Error ? error.message : String(error) }); return { raw: Buffer.alloc(0), value: null } }
}
const recipeDoc = readDocument('kei-mmo/polish/recipe.json', 1_048_576)
const qualityDoc = readDocument('kei-mmo/polish/quality.json', 262_144)
const styleDoc = readDocument('kei-mmo/polish/style.json', 262_144)
const manifestDoc = readDocument('kei-mmo/content/polish-manifest.json', 1_048_576)
const sourceDoc = readDocument('kei-mmo/content/sources.json', 2_097_152)
for (const code of validatePolishRecipeDocument(recipeDoc.value)) problems.push({ code, id: 'recipe.json', message: 'recipe rejected by the authoritative V1 validator' })
for (const code of validatePolishAssetManifestDocument(manifestDoc.value)) problems.push({ code, id: 'polish-manifest.json', message: 'asset manifest rejected by the authoritative V1 validator' })
for (const code of validatePolishSourceManifestDocument(sourceDoc.value)) problems.push({ code, id: 'sources.json', message: 'source registry rejected by the authoritative V1 validator' })
const recipe = recipeDoc.value; const manifest = manifestDoc.value; const sources = sourceDoc.value
if (recipe?.dimension !== manifest?.dimension) problems.push({ code: 'dimension_mismatch', message: 'recipe and content manifest dimensions differ' })
if (hash(sourceDoc.raw) !== recipe?.sourceManifestHash) problems.push({ code: 'source_manifest_hash_mismatch', message: 'recipe source hash is stale' })
if (hash(styleDoc.raw) !== recipe?.styleProfileHash) problems.push({ code: 'style_profile_hash_mismatch', message: 'recipe style hash is stale' })
if (qualityDoc.value?.version !== 1 || JSON.stringify(qualityDoc.value?.profiles) !== JSON.stringify(recipe?.qualityProfiles)) problems.push({ code: 'quality_mismatch', message: 'quality.json differs from the authoritative recipe' })
const required = new Map((manifest?.assets ?? []).map((asset) => [asset.id, asset])); const byId = new Map((sources?.assets ?? []).map((asset) => [asset.id, asset]))
for (const referenced of [recipe?.actor?.characterAsset, recipe?.actor?.rigOrAtlas, recipe?.target?.asset, ...Object.values(recipe?.cues ?? {}).flat()]) if (!required.has(referenced)) problems.push({ code: 'undeclared_recipe_asset', id: referenced, message: 'recipe asset is absent from content/polish-manifest.json' })
for (const id of byId.keys()) if (!required.has(id)) problems.push({ code: 'unrequired_source', id, message: 'source registry contains bytes outside the polish admission manifest' })
const verify = (id, entry, maximum) => { try { const bytes = secureRead(entry.path, maximum, entry.bytes); if (hash(bytes) !== entry.sha256) problems.push({ code: 'hash_mismatch', id, message: entry.path }) } catch (error) { problems.push({ code: 'file_invalid', id, message: entry.path + ': ' + (error instanceof Error ? error.message : String(error)) }) } }
if (sources?.credits) {
  verify('credits', sources.credits, 262_144)
  try {
    const actual = secureRead(sources.credits.path, 262_144, sources.credits.bytes).toString('utf8')
    const lines = ['# Third-party assets', '', 'This inventory is generated from \`kei-mmo/content/sources.json\`.', '']
    for (const source of [...(sources.assets ?? [])].sort((a,b) => a.id.localeCompare(b.id))) lines.push('## ' + source.id, '', '- Provider: ' + source.provider, '- Source: ' + source.canonicalUrl, '- Version: ' + source.providerAssetVersion, '- Licence: ' + source.licence.id + ' (' + source.licence.referenceUrl + ')', '- Attribution: ' + source.attribution, '')
    if (actual !== lines.join('\\n') + '\\n') problems.push({ code: 'credits_content_mismatch', message: 'generated credits do not exactly describe sources.json' })
  } catch {}
}
let visualBytes = 0; let audioBytes = 0; let aggregateBytes = 0; const roleBytes = new Map()
for (const asset of manifest?.assets ?? []) {
  const source = byId.get(asset.id)
  if (!source) { problems.push({ code: 'missing_source', id: asset.id, message: 'required polish asset has no source record' }); continue }
  verify(asset.id, source.sourceFile, 16_777_216)
  verify(asset.id, { path: source.licence.filePath, sha256: source.licence.sha256, bytes: source.licence.bytes }, 262_144)
  const extensions = { atlas: ['.png','.webp'], image: ['.png','.webp'], model: ['.glb','.gltf'], animation: ['.glb','.gltf'], audio: ['.ogg','.mp3','.wav'] }[asset.kind] ?? []
  for (const output of source.processedOutputs) {
    if (!extensions.some((extension) => output.path.toLocaleLowerCase('en-US').endsWith(extension))) problems.push({ code: 'asset_kind_mismatch', id: asset.id, message: output.path })
    verify(asset.id, output, asset.maxBytes)
    aggregateBytes += output.bytes; roleBytes.set(asset.role, (roleBytes.get(asset.role) ?? 0) + output.bytes)
    if (asset.role === 'audio') audioBytes += output.bytes; else visualBytes += output.bytes
  }
}
if (visualBytes > (recipe?.budgets?.maxVisualBytes ?? 0) || audioBytes > (recipe?.budgets?.maxAudioBytes ?? 0) || aggregateBytes > (recipe?.budgets?.maxAggregateBytes ?? 0)) problems.push({ code: 'aggregate_budget_exceeded', message: 'content bytes exceed recipe budgets' })
for (const [role, bytes] of roleBytes) if (bytes > (recipe?.budgets?.maxBytesByRole?.[role] ?? 0)) problems.push({ code: 'role_budget_exceeded', id: role, message: String(bytes) })
if (problems.length) {
  const pending = problems.every((problem) => problem.code === 'missing_source')
  process.stderr.write(JSON.stringify({ ok: false, code: pending ? 'polish_assets_pending' : 'polish_assets_invalid', problems }) + '\\n')
  process.exit(1)
}
process.stdout.write(JSON.stringify({ ok: true, code: 'polish_ready', admitted: required.size, visualBytes, audioBytes, aggregateBytes }) + '\\n')
`
}
