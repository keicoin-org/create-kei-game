import { createHash } from 'node:crypto'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { expectedCredits, parsePolishRecipe, polishSourceCatalogRecord, type PolishSourceManifestV1 } from '../src/polish.js'
import {
  POLISH_ASSET_MANIFEST_PATH,
  POLISH_ATTRIBUTION_PATH,
  POLISH_CHECK_PATH,
  POLISH_RECIPE_PATH,
  POLISH_SOURCE_MANIFEST_PATH,
  polishProjectFiles,
} from '../src/scaffold-polish.js'
import { planFor } from './fixtures.js'
import { catalogLicenceBytes, catalogSourceBytes, cyclicSceneGlb, dummySkinAnimationGlb, extraUnreferencedMeshGlb, glbWithOutOfRangePosition, missingSkinAttributesAnimationGlb, mixedDegenerateTriangleGlb, mixedTrianglePointGlb, oggWithoutAudioPacket, outOfRangeIndexGlb, outOfRangePaletteIndexPng, outOfRangeSkinIndexAccessorAnimationGlb, outOfRangeSkinIndexAnimationGlb, oversizedSkinIndexCountAnimationGlb, paddedTriangleGlb, paddingOnlyInfluencedJointAnimationGlb, pngWithInvalidDeflate, referencedPointGlb, repeatedFourthPositionGlb, tinyGlb, tinyOgg, tinyPng, transparentPalettePng, uniformFilteredPng, uniformPalettePng, unreferencedPointGlb, unusedFourthPositionGlb } from './media.js'
import { runProcess } from './process.js'

const temporary: string[] = []
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

function put(root: string, path: string, contents: string | Uint8Array) {
  const target = join(root, ...path.split('/')); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, contents)
}

function fixture(dimension: '2d' | '3d', ready: boolean) {
  const root = mkdtempSync(join(tmpdir(), `kei-polish-${dimension}-`)); temporary.push(root)
  const files = polishProjectFiles(planFor({ name: `Polish ${dimension}`, dimension, gameplay: 'Players meet a training sentinel.' }))
  for (const file of files) put(root, file.path, file.contents)
  const manifest = JSON.parse(files.find(({ path }) => path === POLISH_ASSET_MANIFEST_PATH)!.contents)
  const recipe = JSON.parse(files.find(({ path }) => path === POLISH_RECIPE_PATH)!.contents)
  if (!ready) return { root, manifest, recipe, sources: JSON.parse(files.find(({ path }) => path === POLISH_SOURCE_MANIFEST_PATH)!.contents) }

  const assets = manifest.assets.map((requirement: any) => {
    const raw = catalogSourceBytes(requirement.id); const licence = catalogLicenceBytes(requirement.id)
    const catalog = polishSourceCatalogRecord(requirement.id)
    if (!catalog) throw new Error(`missing fixture source catalog record: ${requirement.id}`)
    const output = requirement.kind === 'audio' ? tinyOgg() : requirement.kind === 'model' ? tinyGlb('model') : requirement.kind === 'animation' ? tinyGlb('animation') : tinyPng()
    const extension = requirement.kind === 'audio' ? 'ogg' : requirement.kind === 'model' || requirement.kind === 'animation' ? 'glb' : 'png'
    const sourcePath = `kei-mmo/content/source-bytes/${requirement.id}.bin`
    const licencePath = `kei-mmo/content/licenses/${requirement.id}.txt`
    const outputPath = `assets/polish/${requirement.id}.${extension}`
    put(root, sourcePath, raw); put(root, licencePath, licence); put(root, outputPath, output)
    return {
      id: requirement.id, canonicalUrl: catalog.canonicalUrl, provider: catalog.provider, providerAssetVersion: catalog.providerAssetVersion, acquisitionMode: catalog.acquisitionMode, acquiredAt: '2026-08-04T12:00:00.000Z',
      sourceFile: { path: sourcePath, sha256: sha256(raw), bytes: raw.byteLength, packaged: true },
      licence: { id: 'CC0-1.0', referenceUrl: catalog.licenceReferenceUrl, filePath: licencePath, sha256: sha256(licence), bytes: licence.byteLength },
      attribution: catalog.attribution, rawRedistribution: 'allowed', processedOutputs: [{ path: outputPath, sha256: sha256(output), bytes: output.byteLength }],
    }
  })
  const provisional = { version: 1, credits: { path: POLISH_ATTRIBUTION_PATH, sha256: 'a'.repeat(64), bytes: 1 }, assets }
  const credits = expectedCredits(provisional as PolishSourceManifestV1)
  const sources = { ...provisional, credits: { path: POLISH_ATTRIBUTION_PATH, sha256: sha256(credits), bytes: Buffer.byteLength(credits) } }
  put(root, POLISH_ATTRIBUTION_PATH, credits)
  writeSources(root, sources, recipe)
  return { root, manifest, recipe, sources }
}

function writeSources(root: string, sources: any, recipe: any) {
  const sourceText = json(sources); put(root, POLISH_SOURCE_MANIFEST_PATH, sourceText)
  recipe.sourceManifestHash = sha256(sourceText); put(root, POLISH_RECIPE_PATH, json(recipe))
}

async function check(root: string) {
  const result = await runProcess(process.execPath, [join(root, ...POLISH_CHECK_PATH.split('/'))], { cwd: root, timeoutMs: 20_000 })
  return { ...result, report: JSON.parse(result.status === 0 ? result.stdout : result.stderr) }
}

describe('generated project-owned polish checker', () => {
  for (const dimension of ['2d', '3d'] as const) {
    test(`${dimension} is pending without admitted assets`, async () => {
      const pending = fixture(dimension, false)
      const pendingResult = await check(pending.root)
      expect(pendingResult.status).toBe(1)
      expect(pendingResult.report).toMatchObject({ code: 'polish_assets_pending' })
    })
    test(`${dimension} rejects the demonstrated one-placeholder-per-kind alias attack`, async () => {
      const ready = fixture(dimension, true)
      const result = await check(ready.root)
      expect(result.status).toBe(1)
      expect(result.report).toMatchObject({ ok: false, code: 'polish_assets_invalid' })
      expect(result.report.problems).toContainEqual(expect.objectContaining({ code: 'processed_output_alias' }))
      expect(result.report.problems).toContainEqual(expect.objectContaining({ code: dimension === '2d' ? 'media_png_placeholder' : 'media_glb_placeholder' }))
      expect(result.report.problems).toContainEqual(expect.objectContaining({ code: 'media_ogg_placeholder' }))
    })
    test(`${dimension} embeds the decoded media semantics that reject structurally valid bypasses`, async () => {
      const current = fixture(dimension, true)
      const replace = (id: string, bytes: Buffer) => {
        const output = current.sources.assets.find((asset: any) => asset.id === id).processedOutputs[0]
        put(current.root, output.path, bytes); output.sha256 = sha256(bytes); output.bytes = bytes.byteLength
      }
      if (dimension === '2d') replace('hero-character', uniformFilteredPng())
      else { replace('training-sentinel', unreferencedPointGlb()); replace('hero-motion', dummySkinAnimationGlb()) }
      writeSources(current.root, current.sources, current.recipe)
      const result = await check(current.root)
      expect(result.status).toBe(1)
      expect(result.report.problems).toContainEqual(expect.objectContaining({ id: dimension === '2d' ? 'hero-character' : 'training-sentinel', code: dimension === '2d' ? 'media_png_placeholder' : 'media_glb_placeholder' }))
      if (dimension === '3d') expect(result.report.problems).toContainEqual(expect.objectContaining({ id: 'hero-motion', code: 'media_glb_animation_rig_missing' }))
    })
    test(`${dimension} embeds visible-pixel, referenced-vertex, and acyclic-scene admission`, async () => {
      const current = fixture(dimension, true)
      const replace = (id: string, bytes: Buffer) => {
        const output = current.sources.assets.find((asset: any) => asset.id === id).processedOutputs[0]
        put(current.root, output.path, bytes); output.sha256 = sha256(bytes); output.bytes = bytes.byteLength
      }
      if (dimension === '2d') replace('hero-character', transparentPalettePng())
      else { replace('hero-character', cyclicSceneGlb(true)); replace('training-sentinel', paddedTriangleGlb(true)) }
      writeSources(current.root, current.sources, current.recipe)
      const result = await check(current.root)
      expect(result.status).toBe(1)
      if (dimension === '2d') expect(result.report.problems).toContainEqual(expect.objectContaining({ id: 'hero-character', code: 'media_png_placeholder' }))
      else {
        expect(result.report.problems).toContainEqual(expect.objectContaining({ id: 'hero-character', code: 'media_glb_malformed' }))
        expect(result.report.problems).toContainEqual(expect.objectContaining({ id: 'training-sentinel', code: 'media_glb_placeholder' }))
      }
    })
  }

  test.each([
    ['unused fourth POSITION', unusedFourthPositionGlb, 'media_glb_placeholder'],
    ['repeated fourth POSITION', repeatedFourthPositionGlb, 'media_glb_placeholder'],
    ['good plus degenerate triangle', mixedDegenerateTriangleGlb, 'media_glb_placeholder'],
    ['extra unreferenced mesh', extraUnreferencedMeshGlb, 'media_glb_placeholder'],
    ['mixed triangle and point primitives', mixedTrianglePointGlb, 'media_glb_placeholder'],
    ['scene-reachable point primitive', referencedPointGlb, 'media_glb_placeholder'],
    ['out-of-range vertex index', outOfRangeIndexGlb, 'media_glb_malformed'],
  ] as const)('generated 3d checker rejects %s', async (_name, build, expectedCode) => {
    const current = fixture('3d', true)
    const output = current.sources.assets.find((asset: any) => asset.id === 'training-sentinel').processedOutputs[0]
    const bytes = build(); put(current.root, output.path, bytes); output.sha256 = sha256(bytes); output.bytes = bytes.byteLength
    writeSources(current.root, current.sources, current.recipe)
    const result = await check(current.root)
    expect(result.status).toBe(1)
    expect(result.report.problems).toContainEqual(expect.objectContaining({ id: 'training-sentinel', code: expectedCode }))
  })

  test('generated 2d checker resolves palette colours before measuring diversity', async () => {
    const current = fixture('2d', true)
    const output = current.sources.assets.find((asset: any) => asset.id === 'hero-character').processedOutputs[0]
    const bytes = uniformPalettePng(); put(current.root, output.path, bytes); output.sha256 = sha256(bytes); output.bytes = bytes.byteLength
    writeSources(current.root, current.sources, current.recipe)
    const result = await check(current.root)
    expect(result.status).toBe(1)
    expect(result.report.problems).toContainEqual(expect.objectContaining({ id: 'hero-character', code: 'media_png_placeholder' }))
  })

  test('generated 2d checker validates every palette index after reaching the diversity floor', async () => {
    const current = fixture('2d', true)
    const output = current.sources.assets.find((asset: any) => asset.id === 'hero-character').processedOutputs[0]
    const bytes = outOfRangePaletteIndexPng(); put(current.root, output.path, bytes); output.sha256 = sha256(bytes); output.bytes = bytes.byteLength
    writeSources(current.root, current.sources, current.recipe)
    const result = await check(current.root)
    expect(result.status).toBe(1)
    expect(result.report.problems).toContainEqual(expect.objectContaining({ id: 'hero-character', code: 'media_png_malformed' }))
  })

  test('generated 3d checker refuses a skin attached to primitives without joint influences', async () => {
    const current = fixture('3d', true)
    const output = current.sources.assets.find((asset: any) => asset.id === 'hero-motion').processedOutputs[0]
    const bytes = missingSkinAttributesAnimationGlb(); put(current.root, output.path, bytes); output.sha256 = sha256(bytes); output.bytes = bytes.byteLength
    writeSources(current.root, current.sources, current.recipe)
    const result = await check(current.root)
    expect(result.status).toBe(1)
    expect(result.report.problems).toContainEqual(expect.objectContaining({ id: 'hero-motion', code: 'media_glb_animation_rig_missing' }))
  })

  test('generated 3d checker ignores an animated joint influenced only by indexed accessor padding', async () => {
    const current = fixture('3d', true)
    const output = current.sources.assets.find((asset: any) => asset.id === 'hero-motion').processedOutputs[0]
    const bytes = paddingOnlyInfluencedJointAnimationGlb(); put(current.root, output.path, bytes); output.sha256 = sha256(bytes); output.bytes = bytes.byteLength
    writeSources(current.root, current.sources, current.recipe)
    const result = await check(current.root)
    expect(result.status).toBe(1)
    expect(result.report.problems).toContainEqual(expect.objectContaining({ id: 'hero-motion', code: 'media_glb_animation_no_motion' }))
  })

  test.each([
    ['an out-of-range skinned vertex index', outOfRangeSkinIndexAnimationGlb, 'media_glb_malformed'],
    ['an out-of-range skin topology accessor', outOfRangeSkinIndexAccessorAnimationGlb, 'media_glb_malformed'],
    ['an index accessor count above the global bound', oversizedSkinIndexCountAnimationGlb, 'media_glb_malformed'],
  ] as const)('generated 3d checker bounds %s', async (_name, build, expectedCode) => {
    const current = fixture('3d', true)
    const output = current.sources.assets.find((asset: any) => asset.id === 'hero-motion').processedOutputs[0]
    const bytes = build(); put(current.root, output.path, bytes); output.sha256 = sha256(bytes); output.bytes = bytes.byteLength
    writeSources(current.root, current.sources, current.recipe)
    const result = await check(current.root)
    expect(result.status).toBe(1)
    expect(result.report.problems).toContainEqual(expect.objectContaining({ id: 'hero-motion', code: expectedCode }))
  })

  test.each([
    ['unknown event', (recipe: any) => { recipe.actions[0].events.push('execute') }, 'invalid_action'],
    ['silent effect', (recipe: any) => { recipe.effects.contact.cue = null }, 'invalid_effect_contact'],
    ['missing remote observer', (recipe: any) => { recipe.capture.steps[5].observerIds = [] }, 'missing_remote_observation'],
    ['nonmonotonic authority', (recipe: any) => { recipe.authority.events[1].tick = recipe.authority.events[0].tick }, 'invalid_authority_event'],
    ['nonmonotonic quality', (recipe: any) => { recipe.qualityProfiles.low.maxParticles = 500 }, 'non_monotonic_quality'],
    ['per-channel placeholders', (recipe: any) => { recipe.capture.steps[4].visual = 'generic visual placeholder'; recipe.capture.steps[4].audio = 'generic audio placeholder' }, 'weak_capture_feedback'],
    ['remote rebound to interaction', (recipe: any) => { recipe.capture.steps[5].actionId = 'inspect-sentinel'; recipe.capture.steps[5].expectedEventId = 'event-interact' }, 'remote_observation_mismatch'],
  ])('copies the authoritative parser and rejects %s after harness deletion', async (_name, mutate, expectedCode) => {
    const current = fixture('2d', true); mutate(current.recipe)
    expect(parsePolishRecipe(current.recipe)).toBeNull()
    put(current.root, POLISH_RECIPE_PATH, json(current.recipe))
    const result = await check(current.root)
    expect(result.status).toBe(1)
    expect(result.report.code).toBe('polish_assets_invalid')
    expect(result.report.problems).toContainEqual(expect.objectContaining({ code: expectedCode }))
  })

  test.each([
    ['provider host', (current: any) => { current.sources.assets[0].canonicalUrl = 'https://evil.example/assets/hero' }],
    ['licence bytes', (current: any) => { put(current.root, current.sources.assets[0].licence.filePath, 'tampered licence') }],
    ['credits bytes', (current: any) => { put(current.root, POLISH_ATTRIBUTION_PATH, '# forged credits\n') }],
    ['processed hash', (current: any) => { put(current.root, current.sources.assets[0].processedOutputs[0].path, 'tampered output') }],
    ['Windows alias', (current: any) => { current.sources.assets[0].processedOutputs[0].path = 'assets/polish/CON.png' }],
    ['invented catalog provenance', (current: any) => { current.sources.assets[0].canonicalUrl = 'https://kenney.nl/assets/invented-hero-that-does-not-exist'; current.sources.assets[0].providerAssetVersion = 'invented-v999'; current.sources.assets[0].attribution = 'Kenney invented asset, CC0-1.0' }],
  ])('fails closed on mutated %s', async (_name, mutate) => {
    const current = fixture('2d', true); mutate(current); writeSources(current.root, current.sources, current.recipe)
    const result = await check(current.root)
    expect(result.status).toBe(1)
    expect(result.report.code).toBe('polish_assets_invalid')
  })

  test('refuses a symlink or Windows junction ancestor that escapes the project root', async () => {
    const current = fixture('3d', true)
    const outside = mkdtempSync(join(tmpdir(), 'kei-polish-outside-')); temporary.push(outside)
    const bytes = Buffer.from('outside raw bytes'); writeFileSync(join(outside, 'raw.bin'), bytes)
    const link = join(current.root, 'kei-mmo', 'content', 'escape')
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    current.sources.assets[0].sourceFile = { path: 'kei-mmo/content/escape/raw.bin', sha256: sha256(bytes), bytes: bytes.byteLength, packaged: true }
    writeSources(current.root, current.sources, current.recipe)
    const result = await check(current.root)
    expect(result.status).toBe(1)
    expect(result.report.problems).toContainEqual(expect.objectContaining({ code: 'file_invalid', message: expect.stringContaining('link_component_refused') }))
  })

  test('rejects the demonstrated combined end-to-end forgery', async () => {
    const current = fixture('2d', true)
    for (const record of current.sources.assets) {
      const forgedOutput = Buffer.from(`runtime:${record.id} runtime:${record.id} runtime:${record.id}`)
      put(current.root, record.processedOutputs[0].path, forgedOutput)
      record.processedOutputs[0].sha256 = sha256(forgedOutput); record.processedOutputs[0].bytes = forgedOutput.byteLength
      const forgedLicence = Buffer.from('not the CC0 legal text')
      put(current.root, record.licence.filePath, forgedLicence)
      record.licence.sha256 = sha256(forgedLicence); record.licence.bytes = forgedLicence.byteLength
    }
    const hero = current.manifest.assets.find((asset: any) => asset.id === 'hero-character')
    const sentinel = current.manifest.assets.find((asset: any) => asset.id === 'training-sentinel')
    hero.role = 'target'; sentinel.role = 'character'
    current.manifest.assets = current.manifest.assets.filter((asset: any) => !['encounter-environment', 'encounter-effects'].includes(asset.id))
    current.sources.assets = current.sources.assets.filter((record: any) => !['encounter-environment', 'encounter-effects'].includes(record.id))
    put(current.root, POLISH_ASSET_MANIFEST_PATH, json(current.manifest))
    for (const event of current.recipe.authority.events) event.kind = 'strike'
    current.recipe.capture.steps[3].actionId = 'strike-sentinel'
    for (const [index, step] of current.recipe.capture.steps.entries()) {
      if (index !== 4 && step.expectedEventId !== null) step.expectedEventId = 'event-ghost'
      step.visual = 'x'; step.audio = 'x'; step.hud = 'x'
    }
    const credits = expectedCredits(current.sources as PolishSourceManifestV1)
    current.sources.credits = { path: POLISH_ATTRIBUTION_PATH, sha256: sha256(credits), bytes: Buffer.byteLength(credits) }
    put(current.root, POLISH_ATTRIBUTION_PATH, credits)
    writeSources(current.root, current.sources, current.recipe)
    const result = await check(current.root)
    expect(result.status).toBe(1)
    expect(result.report.code).toBe('polish_assets_invalid')
    const codes = new Set(result.report.problems.map((problem: any) => problem.code))
    for (const code of ['media_png_malformed', 'media_ogg_malformed', 'licence_text_mismatch', 'role_binding_mismatch', 'missing_role_environment', 'missing_role_effect', 'unknown_capture_event', 'weak_capture_feedback', 'missing_authority_kind_interact', 'capture_binding_mismatch']) expect(codes).toContain(code)
  })

  test('rejects internally malformed PNG, GLB, and Ogg bytes with matching declared hashes', async () => {
    const current = fixture('3d', true)
    const kindById = new Map(current.manifest.assets.map((asset: any) => [asset.id, asset.kind]))
    for (const record of current.sources.assets) {
      const kind = kindById.get(record.id)
      const malformed = kind === 'audio' ? oggWithoutAudioPacket() : kind === 'model' ? glbWithOutOfRangePosition('model') : kind === 'animation' ? glbWithOutOfRangePosition('animation') : pngWithInvalidDeflate()
      const output = record.processedOutputs[0]
      put(current.root, output.path, malformed)
      output.sha256 = sha256(malformed); output.bytes = malformed.byteLength
    }
    writeSources(current.root, current.sources, current.recipe)
    const result = await check(current.root)
    expect(result.status).toBe(1)
    const codes = new Set(result.report.problems.map((problem: any) => problem.code))
    expect(codes).toContain('media_png_malformed')
    expect(codes).toContain('media_glb_malformed')
    expect(codes).toContain('media_ogg_malformed')
  })

  test('counts packaged raw source, licence, and credits bytes against the aggregate budget', async () => {
    const current = fixture('2d', true)
    const roleById = new Map(current.manifest.assets.map((asset: any) => [asset.id, asset.role]))
    let visual = 0; let audio = 0
    for (const record of current.sources.assets) {
      for (const output of record.processedOutputs) {
        if (roleById.get(record.id) === 'audio') audio += output.bytes; else visual += output.bytes
      }
    }
    current.recipe.budgets.maxVisualBytes = visual
    current.recipe.budgets.maxAudioBytes = audio
    current.recipe.budgets.maxAggregateBytes = visual + audio
    writeSources(current.root, current.sources, current.recipe)
    const result = await check(current.root)
    expect(result.status).toBe(1)
    expect(result.report.code).toBe('polish_assets_invalid')
    expect(result.report.problems).toContainEqual(expect.objectContaining({ code: 'aggregate_budget_exceeded' }))
  })

  test('bounds a file before reading it and enforces the per-file role budget', async () => {
    const current = fixture('2d', true)
    const requirement = current.manifest.assets[0]
    const output = current.sources.assets[0].processedOutputs[0]
    const oversized = Buffer.alloc(requirement.maxBytes + 1, 7)
    put(current.root, output.path, oversized)
    output.bytes = oversized.byteLength; output.sha256 = sha256(oversized)
    writeSources(current.root, current.sources, current.recipe)
    const result = await check(current.root)
    expect(result.status).toBe(1)
    expect(result.report.problems).toContainEqual(expect.objectContaining({ code: 'file_invalid', message: expect.stringContaining('byte_budget_mismatch') }))
  })
})
