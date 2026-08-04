/** Project-owned polish contract files. No asset bytes are selected in this slice. */

import { createHash } from 'node:crypto'

import type { QualityProfile, QualityTier, SemanticCue, SemanticEvent } from './effects.js'
import type { ImplementationPlan } from './plan.js'
import {
  POLISH_ASSET_MANIFEST_VERSION,
  POLISH_RECIPE_VERSION,
  POLISH_SOURCE_MANIFEST_VERSION,
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
export const POLISH_ASSET_MANIFEST_PATH = `${POLISH_DIRECTORY}/manifest.json`
export const POLISH_SOURCE_MANIFEST_PATH = `${POLISH_DIRECTORY}/sources.json`
export const POLISH_STYLE_PATH = `${POLISH_DIRECTORY}/style.json`
export const POLISH_CHECK_PATH = `${POLISH_DIRECTORY}/check.mjs`
export const POLISH_ATTRIBUTION_PATH = `${POLISH_DIRECTORY}/THIRD_PARTY_ASSETS.md`

function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n` }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }

const qualityProfiles: Readonly<Record<QualityTier, QualityProfile>> = Object.freeze({
  low: Object.freeze({ tier: 'low', maxParticles: 24, maxVoices: 8, postProcessing: Object.freeze([]), shadows: false, cameraImpulseScale: 0 }),
  medium: Object.freeze({ tier: 'medium', maxParticles: 64, maxVoices: 16, postProcessing: Object.freeze(['fxaa', 'bloom'] as const), shadows: false, cameraImpulseScale: 0.5 }),
  high: Object.freeze({ tier: 'high', maxParticles: 128, maxVoices: 24, postProcessing: Object.freeze(['fxaa', 'bloom', 'ssao'] as const), shadows: true, cameraImpulseScale: 1 }),
})

function requirement(id: string, role: PolishAssetRole, kind: PolishAssetKind): PolishAssetRequirement {
  return Object.freeze({ id, role, kind })
}

export function starterPolishAssetManifest(dimension: '2d' | '3d'): PolishAssetManifestV1 {
  const visual = dimension === '2d' ? 'atlas' : 'model'
  return Object.freeze({
    version: POLISH_ASSET_MANIFEST_VERSION,
    recipeId: 'first-encounter',
    assets: Object.freeze([
      requirement('hero-character', 'character', visual),
      requirement('hero-motion', 'rig-or-atlas', dimension === '2d' ? 'atlas' : 'animation'),
      requirement('training-sentinel', 'target', visual),
      requirement('encounter-environment', 'environment', visual),
      requirement('encounter-effects', 'effect', 'image'),
      ...['ambience', 'footstep-a', 'footstep-b', 'interaction', 'swing', 'impact', 'refusal', 'success']
        .map((id) => requirement(id, 'audio', 'audio')),
    ]),
  })
}

function starterRecipe(plan: ImplementationPlan, sourceManifestHash: string, styleProfileHash: string): PolishRecipeV1 {
  const dimension = plan.engine.dimension
  const action = (value: ActionRecipe) => Object.freeze(value)
  const actions = Object.freeze([
    action({ id: 'inspect-sentinel', kind: 'interact', anticipationMs: 180, contactMs: 360, recoveryMs: 680, cooldownMs: 900, interrupt: 'before-contact', cancel: 'on-refusal', events: Object.freeze(['anticipation', 'contact', 'success', 'refusal', 'cooldown', 'recovery']), cueOverrides: Object.freeze({ anticipation: 'interaction', contact: 'interaction' }) }),
    action({ id: 'strike-sentinel', kind: 'strike', anticipationMs: 220, contactMs: 440, recoveryMs: 820, cooldownMs: 1_200, interrupt: 'before-contact', cancel: 'on-refusal', events: Object.freeze(['anticipation', 'contact', 'success', 'refusal', 'cooldown', 'recovery']), cueOverrides: Object.freeze({ anticipation: 'swing', contact: 'impact' }) }),
  ])
  const cues: Readonly<Record<SemanticCue, readonly string[]>> = Object.freeze({
    ambience: Object.freeze(['ambience']), footstep: Object.freeze(['footstep-a', 'footstep-b']), interaction: Object.freeze(['interaction']),
    swing: Object.freeze(['swing']), impact: Object.freeze(['impact']), refusal: Object.freeze(['refusal']), success: Object.freeze(['success']),
  })
  const effects = Object.freeze({
    anticipation: Object.freeze({ event: 'anticipation', cue: null, visual: 'telegraph', cameraImpulse: 0, hud: 'action' }),
    contact: Object.freeze({ event: 'contact', cue: null, visual: 'contact', cameraImpulse: 0.35, hud: 'action' }),
    success: Object.freeze({ event: 'success', cue: 'success', visual: 'status', cameraImpulse: 0.15, hud: 'success' }),
    refusal: Object.freeze({ event: 'refusal', cue: 'refusal', visual: 'status', cameraImpulse: 0, hud: 'refusal' }),
    cooldown: Object.freeze({ event: 'cooldown', cue: null, visual: 'status', cameraImpulse: 0, hud: 'cooldown' }),
    recovery: Object.freeze({ event: 'recovery', cue: null, visual: 'none', cameraImpulse: 0, hud: 'none' }),
  } satisfies Readonly<Record<SemanticEvent, unknown>>) as PolishRecipeV1['effects']

  return Object.freeze({
    version: POLISH_RECIPE_VERSION, id: 'first-encounter', dimension, durationMs: 30_000,
    styleProfileHash, sourceManifestHash,
    actor: Object.freeze({ characterAsset: 'hero-character', rigOrAtlas: 'hero-motion' }),
    target: Object.freeze({ asset: 'training-sentinel', interactionRadiusM: 2.25 }), actions, cues, effects, qualityProfiles,
    capture: Object.freeze({ profile: 'medium', durationMs: 30_000, steps: Object.freeze([{ atMs: 8_000, action: 'inspect-sentinel' }, { atMs: 16_000, action: 'strike-sentinel' }, { atMs: 22_000, action: 'strike-sentinel' }]) }),
  })
}

export function polishProjectFiles(plan: ImplementationPlan): readonly WorkspaceFile[] {
  const sources: PolishSourceManifestV1 = Object.freeze({ version: POLISH_SOURCE_MANIFEST_VERSION, assets: Object.freeze([]) })
  const sourceText = json(sources)
  const styleText = json(resolveStyle(plan.intent))
  const recipe = starterRecipe(plan, sha256(sourceText), sha256(styleText))
  return Object.freeze([
    { path: POLISH_ASSET_MANIFEST_PATH, contents: json(starterPolishAssetManifest(plan.engine.dimension)) },
    { path: POLISH_SOURCE_MANIFEST_PATH, contents: sourceText },
    { path: POLISH_STYLE_PATH, contents: styleText },
    { path: POLISH_RECIPE_PATH, contents: json(recipe) },
    { path: POLISH_QUALITY_PATH, contents: json({ version: 1, profiles: qualityProfiles }) },
    { path: POLISH_ATTRIBUTION_PATH, contents: '# Third-party assets\n\nNo assets are admitted yet. This file is not a licence inventory and the polished route is blocked.\n' },
    { path: POLISH_CHECK_PATH, contents: checkScript() },
  ])
}

function checkScript(): string {
  return `#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const problems = []
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const hashPattern = /^[a-f0-9]{64}$/
const validHash = (value) => hashPattern.test(value ?? '') && !/^0{64}$/.test(value)
const validUtc = (value) => { try { return /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(value ?? '') && new Date(value).toISOString() === value } catch { return false } }
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|')
const safePath = (value) => typeof value === 'string' && value !== '' && !value.includes('\\\\') && !value.includes('\\0') && !value.startsWith('/') && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
const safeUrl = (value) => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash } catch { return false } }
const readJson = (name) => { try { const raw = readFileSync(resolve(here, name), 'utf8'); return { raw, value: JSON.parse(raw) } } catch (error) { problems.push({ code: 'invalid_json', id: name, message: String(error) }); return { raw: '', value: null } } }
const sourceDoc = readJson('sources.json')
const styleDoc = readJson('style.json')
const manifestDoc = readJson('manifest.json')
const recipeDoc = readJson('recipe.json')
const qualityDoc = readJson('quality.json')
const sources = sourceDoc.value
const manifest = manifestDoc.value
const recipe = recipeDoc.value
if (!exact(manifest, ['version','recipeId','assets']) || manifest?.version !== 1 || manifest?.recipeId !== 'first-encounter' || !Array.isArray(manifest?.assets)) problems.push({ code: 'invalid_manifest', message: 'manifest.json must be the exact version-1 first-encounter asset manifest' })
if (!exact(sources, ['version','assets']) || sources?.version !== 1 || !Array.isArray(sources?.assets)) problems.push({ code: 'invalid_sources', message: 'sources.json must be an exact version-1 source manifest' })
if (!exact(recipe, ['version','id','dimension','durationMs','styleProfileHash','sourceManifestHash','actor','target','actions','cues','effects','qualityProfiles','capture']) || recipe?.version !== 1 || recipe?.id !== 'first-encounter' || !['2d', '3d'].includes(recipe?.dimension) || !Number.isInteger(recipe?.durationMs) || recipe.durationMs < 25000 || recipe.durationMs > 35000 || !validHash(recipe?.styleProfileHash) || !validHash(recipe?.sourceManifestHash)) problems.push({ code: 'invalid_recipe', message: 'recipe.json must be the exact bounded version-1 first-encounter recipe' })
const actionIds = new Set()
for (const action of recipe?.actions ?? []) {
  const invalidAction = !exact(action, ['id','kind','anticipationMs','contactMs','recoveryMs','cooldownMs','interrupt','cancel','events','cueOverrides']) || !idPattern.test(action?.id ?? '') || actionIds.has(action.id) || !['interact','strike'].includes(action?.kind) || !Number.isInteger(action?.anticipationMs) || action.anticipationMs < 50 || !Number.isInteger(action?.contactMs) || action.contactMs <= action.anticipationMs || !Number.isInteger(action?.recoveryMs) || action.recoveryMs <= action.contactMs || !Number.isInteger(action?.cooldownMs) || action.cooldownMs < action.recoveryMs || !Array.isArray(action?.events) || !['anticipation','contact','success','refusal','cooldown','recovery'].every((event) => action.events.includes(event)) || !exact(action?.cueOverrides, ['anticipation','contact'])
  if (invalidAction) problems.push({ code: 'invalid_action', id: action?.id, message: 'action timing, events, cue overrides, or id is invalid' })
  actionIds.add(action?.id)
}
if (!Array.isArray(recipe?.actions) || recipe.actions.length < 2) problems.push({ code: 'invalid_actions', message: 'recipe needs bounded interact and strike actions' })
if (!['interact','strike'].every((kind) => recipe?.actions?.some((action) => action.kind === kind))) problems.push({ code: 'invalid_action_kinds', message: 'recipe must declare both interact and strike' })
const tiers = ['low','medium','high'].map((tier) => recipe?.qualityProfiles?.[tier])
for (let index = 1; index < tiers.length; index += 1) {
  const lower = tiers[index - 1]; const higher = tiers[index]
  if (!lower || !higher || lower.maxParticles > higher.maxParticles || lower.maxVoices > higher.maxVoices || lower.cameraImpulseScale > higher.cameraImpulseScale || (lower.shadows && !higher.shadows) || !lower.postProcessing?.every((effect) => higher.postProcessing?.includes(effect))) problems.push({ code: 'invalid_quality_degradation', message: 'lower quality cannot demand more work than a higher tier' })
}
if (qualityDoc.value?.version !== 1 || JSON.stringify(qualityDoc.value?.profiles) !== JSON.stringify(recipe?.qualityProfiles)) problems.push({ code: 'quality_mismatch', message: 'quality.json must exactly match recipe qualityProfiles' })
const sourceHash = createHash('sha256').update(sourceDoc.raw).digest('hex')
if (recipe?.sourceManifestHash !== sourceHash) problems.push({ code: 'source_manifest_hash_mismatch', message: 'recipe sourceManifestHash is stale' })
const styleHash = createHash('sha256').update(styleDoc.raw).digest('hex')
if (recipe?.styleProfileHash !== styleHash) problems.push({ code: 'style_profile_hash_mismatch', message: 'recipe styleProfileHash is stale' })
const requiredIds = new Set()
for (const asset of manifest?.assets ?? []) {
  if (!exact(asset, ['id','role','kind']) || !idPattern.test(asset?.id ?? '') || requiredIds.has(asset.id)) problems.push({ code: 'invalid_requirement', id: asset?.id, message: 'asset requirements must have exact keys and unique kebab-case ids' })
  requiredIds.add(asset?.id)
}
for (const referenced of [recipe?.actor?.characterAsset, recipe?.actor?.rigOrAtlas, recipe?.target?.asset, ...Object.values(recipe?.cues ?? {}).flat()]) {
  if (!requiredIds.has(referenced)) problems.push({ code: 'undeclared_recipe_asset', id: referenced, message: 'recipe references an asset absent from manifest.json' })
}
const sourceIds = new Set()
const byId = new Map()
const outputPaths = new Set()
for (const source of sources?.assets ?? []) {
  const invalid = !exact(source, ['id','canonicalUrl','provider','providerAssetVersion','acquisitionMode','acquiredAt','sha256','licence','attribution','rawRedistribution','processedOutputs']) || !idPattern.test(source?.id ?? '') || sourceIds.has(source.id) || !safeUrl(source?.canonicalUrl) || !['kenney','quaternius','poly-haven','local-user'].includes(source?.provider) || typeof source?.providerAssetVersion !== 'string' || !source.providerAssetVersion.trim() || /^(latest|current)$/i.test(source.providerAssetVersion.trim()) || !['download','api','local-user'].includes(source?.acquisitionMode) || !validUtc(source?.acquiredAt) || !validHash(source?.sha256) || !exact(source?.licence, ['id','referenceUrl','filePath']) || !source?.licence?.id || !safeUrl(source?.licence?.referenceUrl) || !safePath(source?.licence?.filePath) || !source?.attribution?.trim() || !['allowed','processed-only','forbidden'].includes(source?.rawRedistribution) || !Array.isArray(source?.processedOutputs) || source.processedOutputs.length < 1 || source.processedOutputs.length > 20 || !source.processedOutputs.every((output) => exact(output, ['path','sha256']) && safePath(output?.path) && validHash(output?.sha256))
  if (invalid) problems.push({ code: 'invalid_source', id: source?.id, message: 'source record is incomplete, unsafe, duplicated, or unpinned' })
  for (const output of source?.processedOutputs ?? []) { const folded = output?.path?.toLowerCase(); if (outputPaths.has(folded)) problems.push({ code: 'duplicate_output', id: source?.id, message: output?.path }); outputPaths.add(folded) }
  sourceIds.add(source?.id); byId.set(source?.id, source)
}
for (const required of manifest?.assets ?? []) {
  const source = byId.get(required.id)
  if (!source) { problems.push({ code: 'missing_source', id: required.id, message: 'required polish asset has no admitted source record' }); continue }
  for (const entry of [{ path: source.licence.filePath, sha256: null }, ...source.processedOutputs]) {
    const relative = entry.path
    const path = resolve(root, relative)
    if (!(path === root || path.startsWith(root + sep))) { problems.push({ code: 'unsafe_path', id: source.id, message: relative }); continue }
    if (!existsSync(path) || !statSync(path).isFile()) { problems.push({ code: 'file_missing', id: source.id, message: relative }); continue }
    if (lstatSync(path).isSymbolicLink()) { problems.push({ code: 'symlink_refused', id: source.id, message: relative }); continue }
    if (entry.sha256 !== null) {
      const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
      if (actual !== entry.sha256) problems.push({ code: 'hash_mismatch', id: source.id, message: relative })
    }
  }
}
if (problems.length) {
  const code = problems.every((problem) => problem.code === 'missing_source') ? 'polish_assets_pending' : 'polish_assets_invalid'
  process.stderr.write(JSON.stringify({ ok: false, code, problems }) + '\\n')
  process.exit(1)
}
process.stdout.write(JSON.stringify({ ok: true, code: 'polish_ready', admitted: requiredIds.size }) + '\\n')
`
}
