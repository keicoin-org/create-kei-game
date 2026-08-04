import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'

import {
  POLISH_CREDITS_PATH,
  admitPolishAssets,
  expectedCredits,
  parsePolishAssetManifest,
  parsePolishRecipe,
  parsePolishSourceManifest,
  polishSourceCatalogRecord,
  portablePolishPathKey,
  safePolishPath,
  validatePolishLicenceBytes,
  validatePolishAssetManifestDocument,
  validatePolishMediaBytes,
  validatePolishRecipeDocument,
  validatePolishRecipeManifestBinding,
  validatePolishSourceManifestBinding,
  validatePolishSourceManifestDocument,
  type PolishSourceManifestV1,
} from '../src/polish.js'
import { polishProjectFiles, POLISH_ASSET_MANIFEST_PATH, POLISH_RECIPE_PATH } from '../src/scaffold-polish.js'
import { planFor } from './fixtures.js'
import { ancestorSkeletonAnimationGlb, CC0_TEXT, cyclicSceneGlb, disconnectedJointAnimationGlb, dummySkinAnimationGlb, duplicateJointSkinAnimationGlb, emptyPaletteTransparencyPng, extraUnreferencedMeshGlb, forbiddenNormalizedAccessorGlb, glbWithOutOfRangePosition, hugeSkinWeightAnimationGlb, indexedQuadGlb, invalidInverseBindMatricesAnimationGlb, misalignedAccessorAnimationGlb, misalignedJointVertexAttributeGlb, misalignedNonSkinVertexAttributeGlb, mismatchedSkinAccessorCountAnimationGlb, missingSkinAttributesAnimationGlb, mixedDegenerateTriangleGlb, mixedTrianglePointGlb, nonFiniteSkinWeightAnimationGlb, oggWithoutAudioPacket, outOfRangeIndexGlb, outOfRangePaletteIndexPng, outOfRangeSkeletonAnimationGlb, outOfRangeSkinIndexAccessorAnimationGlb, outOfRangeSkinIndexAnimationGlb, outOfRangeSkinJointAnimationGlb, oversizedSkinIndexCountAnimationGlb, paddedTriangleGlb, paddingOnlyInfluencedJointAnimationGlb, pngWithInvalidDeflate, referencedPointGlb, repeatedFourthPositionGlb, riggedAnimationGlb, sceneTriangleGlb, sharedRootSkinAnimationGlb, siblingSkeletonAnimationGlb, tinyGlb, tinyOgg, tinyPng, transparentPalettePng, transparentRgbaPng, uninfluencedJointAnimationGlb, uniformFilteredPng, uniformPalettePng, unnormalizedSkinWeightsAnimationGlb, unpairedSkinSetAnimationGlb, unrelatedUsedSkinAnimationGlb, unreferencedPointGlb, unusedFourthPositionGlb, unusedSkinJointAnimationGlb, variedPng, zeroWeightSkinAnimationGlb } from './media.js'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function generated(dimension: '2d' | '3d' = '2d') {
  const plan = planFor({ name: 'Polish Contract', dimension, gameplay: 'Players meet a training sentinel.' })
  const files = polishProjectFiles(plan)
  return {
    recipe: JSON.parse(files.find(({ path }) => path === POLISH_RECIPE_PATH)!.contents),
    manifest: JSON.parse(files.find(({ path }) => path === POLISH_ASSET_MANIFEST_PATH)!.contents),
  }
}

function source(id = 'hero-character', overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const catalog = polishSourceCatalogRecord(id)
  if (!catalog) throw new Error(`unknown fixture catalog id: ${id}`)
  const output = `asset:${id}`
  return {
    id,
    canonicalUrl: catalog.canonicalUrl,
    provider: catalog.provider, providerAssetVersion: catalog.providerAssetVersion, acquisitionMode: catalog.acquisitionMode, acquiredAt: '2026-08-04T12:00:00.000Z',
    sourceFile: { path: `kei-mmo/content/source-bytes/${id}.bin`, sha256: catalog.sourceSha256, bytes: catalog.sourceBytes, packaged: true },
    licence: { id: 'CC0-1.0', referenceUrl: catalog.licenceReferenceUrl, filePath: `kei-mmo/content/licenses/${id}.txt`, sha256: catalog.licenceSha256, bytes: catalog.licenceBytes },
    attribution: catalog.attribution, rawRedistribution: 'allowed',
    processedOutputs: [{ path: `assets/polish/${id}.png`, sha256: hash(output), bytes: Buffer.byteLength(output) }],
    ...overrides,
  }
}

function sources(records: Record<string, unknown>[]) {
  const provisional = { version: 1, credits: { path: POLISH_CREDITS_PATH, sha256: 'a'.repeat(64), bytes: 1 }, assets: records }
  const credits = expectedCredits(provisional as unknown as PolishSourceManifestV1)
  return { value: { ...provisional, credits: { path: POLISH_CREDITS_PATH, sha256: hash(credits), bytes: Buffer.byteLength(credits) } }, credits }
}

describe('PolishRecipeV1 authority and presentation contract', () => {
  test.each(['2d', '3d'] as const)('parses the complete %s first-encounter timeline', (dimension) => {
    const parsed = parsePolishRecipe(generated(dimension).recipe)
    expect(parsed?.authority.events.map(({ outcome }) => outcome)).toEqual(['accepted', 'accepted', 'refused', 'cooldown', 'recovered'])
    expect(parsed?.capture.steps.map(({ kind }) => kind)).toEqual(['connect-local', 'connect-scripted-remote', 'approach', 'interact', 'strike', 'remote-observe', 'refusal', 'cooldown', 'recovery', 'reset'])
    expect(parsed?.effects.recovery).toMatchObject({ cue: 'recovery', visual: 'status', hud: 'recovery', reducedMotion: { cameraImpulse: 0 } })
  })

  test.each([
    ['foreign field', (recipe: any) => { recipe.surprise = true }],
    ['unknown event', (recipe: any) => { recipe.actions[0].events[0] = 'execute' }],
    ['silent contact', (recipe: any) => { recipe.effects.contact.cue = null }],
    ['feedback-erasing low tier', (recipe: any) => { recipe.qualityProfiles.low.maxParticles = recipe.qualityProfiles.high.maxParticles + 1 }],
    ['nonmonotonic server tick', (recipe: any) => { recipe.authority.events[1].tick = recipe.authority.events[0].tick }],
    ['forged contact outcome', (recipe: any) => { recipe.authority.events[2].contact = true }],
    ['missing remote proof', (recipe: any) => { recipe.capture.steps = recipe.capture.steps.filter((step: any) => step.kind !== 'remote-observe') }],
    ['capture/event mismatch', (recipe: any) => { recipe.capture.steps[3].expectedOutcome = 'refused' }],
    ['anonymous device', (recipe: any) => { recipe.budgets.referenceDevice = '' }],
    ['nonexistent capture event id', (recipe: any) => { recipe.capture.steps[3].expectedEventId = 'event-ghost' }],
    ['interact step bound to the strike action', (recipe: any) => { recipe.capture.steps[3].actionId = 'strike-sentinel' }],
    ['strike-only authority', (recipe: any) => { for (const event of recipe.authority.events) event.kind = 'strike' }],
    ['trivial capture feedback', (recipe: any) => { for (const step of recipe.capture.steps) { step.visual = 'x'; step.audio = 'x'; step.hud = 'x' } }],
    ['reduced-motion feedback drop', (recipe: any) => { recipe.effects.contact.reducedMotion.visual = 'status' }],
  ])('rejects %s identically through the authoritative validator', (_name, mutate) => {
    const recipe = structuredClone(generated().recipe); mutate(recipe)
    expect(validatePolishRecipeDocument(recipe).length).toBeGreaterThan(0)
    expect(parsePolishRecipe(recipe)).toBeNull()
  })

  test.each([
    ['null action', (recipe: any) => { recipe.actions[0] = null }, 'invalid_action'],
    ['primitive action', (recipe: any) => { recipe.actions[0] = 7 }, 'invalid_action'],
    ['null authority event', (recipe: any) => { recipe.authority.events[0] = null }, 'invalid_authority_event'],
    ['primitive authority event', (recipe: any) => { recipe.authority.events[0] = 'event' }, 'invalid_authority_event'],
    ['null capture step', (recipe: any) => { recipe.capture.steps[0] = null }, 'invalid_capture_step'],
    ['primitive capture step', (recipe: any) => { recipe.capture.steps[0] = false }, 'invalid_capture_step'],
    ['null remote observers', (recipe: any) => { recipe.capture.steps[5].observerIds = null }, 'invalid_capture_step'],
    ['null quality profile', (recipe: any) => { recipe.qualityProfiles.medium = null }, 'invalid_quality_medium'],
    ['non-numeric duration', (recipe: any) => { recipe.durationMs = '30000' }, 'invalid_recipe_bounds'],
  ] as const)('is total over a %s', (_name, mutate, expectedCode) => {
    const recipe = structuredClone(generated().recipe); mutate(recipe)
    let problems: string[] = []
    expect(() => { problems = validatePolishRecipeDocument(recipe) }).not.toThrow()
    expect(problems).toContain(expectedCode)
    expect(() => parsePolishRecipe(recipe)).not.toThrow()
    expect(parsePolishRecipe(recipe)).toBeNull()
  })

  test.each([
    ['effect camera impulse', (recipe: any, value: number) => { recipe.effects.contact.cameraImpulse = value }, 'invalid_effect_contact'],
    ['quality camera impulse scale', (recipe: any, value: number) => { recipe.qualityProfiles.medium.cameraImpulseScale = value }, 'invalid_quality_medium'],
    ['quality p95 frame time', (recipe: any, value: number) => { recipe.qualityProfiles.medium.p95FrameMs = value }, 'invalid_quality_medium'],
    ['quality p99 frame time', (recipe: any, value: number) => { recipe.qualityProfiles.medium.p99FrameMs = value }, 'invalid_quality_medium'],
    ['quality maximum long frame', (recipe: any, value: number) => { recipe.qualityProfiles.medium.maxLongFrameMs = value }, 'invalid_quality_medium'],
  ] as const)('rejects every non-finite %s before cloning', (_name, mutate, expectedCode) => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const recipe = structuredClone(generated().recipe); mutate(recipe, value)
      expect(validatePolishRecipeDocument(recipe)).toContain(expectedCode)
      expect(parsePolishRecipe(recipe)).toBeNull()
    }
  })

  test('requires every feedback channel to carry the capture-step semantic', () => {
    const recipe = structuredClone(generated().recipe)
    const strike = recipe.capture.steps.find((step: any) => step.kind === 'strike')
    strike.visual = 'generic visual placeholder'
    strike.audio = 'generic audio placeholder'
    strike.hud = 'strike outcome remains visible'
    expect(validatePolishRecipeDocument(recipe)).toContain('weak_capture_feedback')
  })

  test('binds remote observation to the same accepted strike event', () => {
    const recipe = structuredClone(generated().recipe)
    const remote = recipe.capture.steps.find((step: any) => step.kind === 'remote-observe')
    remote.actionId = 'inspect-sentinel'
    remote.expectedEventId = 'event-interact'
    expect(validatePolishRecipeDocument(recipe)).toContain('remote_observation_mismatch')
  })

  test.each([
    ['missing environment role', (manifest: any) => { manifest.assets = manifest.assets.filter((asset: any) => asset.role !== 'environment') }],
    ['missing effect role', (manifest: any) => { manifest.assets = manifest.assets.filter((asset: any) => asset.role !== 'effect') }],
    ['duplicate character role', (manifest: any) => { manifest.assets.push({ ...manifest.assets[0], id: 'second-hero' }) }],
  ])('rejects a manifest with %s', (_name, mutate) => {
    const manifest = structuredClone(generated().manifest); mutate(manifest)
    expect(parsePolishAssetManifest(manifest)).toBeNull()
  })

  test.each([null, 'asset', 9, false])('returns manifest problems for malformed asset entry %p', (entry) => {
    const manifest = structuredClone(generated().manifest)
    manifest.assets[0] = entry
    let problems: string[] = []
    expect(() => { problems = validatePolishAssetManifestDocument(manifest) }).not.toThrow()
    expect(problems).toContain('invalid_requirement')
    expect(() => parsePolishAssetManifest(manifest)).not.toThrow()
    expect(parsePolishAssetManifest(manifest)).toBeNull()
  })

  test('binds recipe actor, target, and cue ids to manifest semantic roles', () => {
    const { recipe, manifest } = generated()
    expect(validatePolishRecipeManifestBinding(recipe, manifest)).toEqual([])
    const swapped = structuredClone(manifest)
    const hero = swapped.assets.find((asset: any) => asset.id === 'hero-character')
    const sentinel = swapped.assets.find((asset: any) => asset.id === 'training-sentinel')
    hero.role = 'target'; sentinel.role = 'character'
    expect(validatePolishRecipeManifestBinding(recipe, swapped)).toContain('role_binding_mismatch')
    const missing = structuredClone(manifest)
    missing.assets = missing.assets.filter((asset: any) => asset.role !== 'environment')
    expect(validatePolishRecipeManifestBinding(recipe, missing)).toContain('missing_role_environment')
  })
})

describe('admitted media and licence byte semantics', () => {
  test('rejects structurally valid but production-trivial placeholder media', () => {
    expect(validatePolishMediaBytes('atlas', tinyPng())).toEqual(['media_png_placeholder'])
    expect(validatePolishMediaBytes('image', tinyPng())).toEqual(['media_png_placeholder'])
    expect(validatePolishMediaBytes('image', uniformFilteredPng())).toEqual(['media_png_placeholder'])
    expect(validatePolishMediaBytes('atlas', uniformPalettePng())).toEqual(['media_png_placeholder'])
    expect(validatePolishMediaBytes('image', transparentPalettePng())).toEqual(['media_png_placeholder'])
    expect(validatePolishMediaBytes('image', transparentRgbaPng())).toEqual(['media_png_placeholder'])
    expect(validatePolishMediaBytes('model', tinyGlb('model'))).toEqual(['media_glb_placeholder'])
    expect(validatePolishMediaBytes('model', unreferencedPointGlb())).toEqual(['media_glb_placeholder'])
    expect(validatePolishMediaBytes('model', paddedTriangleGlb(true))).toEqual(['media_glb_placeholder'])
    expect(validatePolishMediaBytes('model', paddedTriangleGlb(false))).toEqual(['media_glb_placeholder'])
    expect(validatePolishMediaBytes('animation', tinyGlb('animation'))).toEqual(['media_glb_animation_rig_missing'])
    expect(validatePolishMediaBytes('animation', dummySkinAnimationGlb())).toEqual(['media_glb_animation_rig_missing'])
    expect(validatePolishMediaBytes('animation', missingSkinAttributesAnimationGlb())).toEqual(['media_glb_animation_rig_missing'])
    expect(validatePolishMediaBytes('animation', unusedSkinJointAnimationGlb())).toEqual(['media_glb_animation_rig_missing'])
    expect(validatePolishMediaBytes('animation', zeroWeightSkinAnimationGlb())).toEqual(['media_glb_animation_rig_missing'])
    expect(validatePolishMediaBytes('animation', uninfluencedJointAnimationGlb())).toEqual(['media_glb_animation_no_motion'])
    expect(validatePolishMediaBytes('animation', unrelatedUsedSkinAnimationGlb())).toEqual(['media_glb_animation_no_motion'])
    expect(validatePolishMediaBytes('animation', duplicateJointSkinAnimationGlb())).toEqual(['media_glb_animation_rig_missing'])
    expect(validatePolishMediaBytes('audio', tinyOgg())).toEqual(['media_ogg_placeholder'])
  })

  test('accepts bounded decoded pixels, scene triangles, and joint-bound motion above the placeholder floor', () => {
    expect(validatePolishMediaBytes('image', variedPng())).toEqual([])
    expect(validatePolishMediaBytes('model', sceneTriangleGlb())).toEqual([])
    expect(validatePolishMediaBytes('model', indexedQuadGlb())).toEqual([])
    expect(validatePolishMediaBytes('animation', riggedAnimationGlb())).toEqual([])
    expect(validatePolishMediaBytes('animation', sharedRootSkinAnimationGlb())).toEqual([])
    expect(validatePolishMediaBytes('animation', ancestorSkeletonAnimationGlb())).toEqual([])
  })

  test.each([
    ['a non-skin COLOR_0 accessor with a relative byte offset of two', 'model', misalignedNonSkinVertexAttributeGlb],
    ['a JOINTS_0 accessor at absolute byte 40 but relative byte offset two', 'animation', misalignedJointVertexAttributeGlb],
  ] as const)('rejects %s', (_name, kind, build) => {
    expect(validatePolishMediaBytes(kind, build())).toEqual(['media_glb_malformed'])
  })

  test.each([
    ['a sibling declared as the skeleton', siblingSkeletonAnimationGlb],
    ['joint roots disconnected from the active scene', disconnectedJointAnimationGlb],
  ] as const)('rejects animation skin hierarchy with %s', (_name, build) => {
    expect(validatePolishMediaBytes('animation', build())).toEqual(['media_glb_animation_rig_missing'])
  })

  test('does not admit an animated joint influenced only by indexed accessor padding', () => {
    expect(validatePolishMediaBytes('animation', paddingOnlyInfluencedJointAnimationGlb())).toEqual(['media_glb_animation_no_motion'])
  })

  test.each([
    ['an out-of-range skinned vertex index', outOfRangeSkinIndexAnimationGlb],
    ['an out-of-range skin topology accessor', outOfRangeSkinIndexAccessorAnimationGlb],
    ['an index accessor count above the global bound', oversizedSkinIndexCountAnimationGlb],
  ] as const)('bounds %s before skin influence traversal', (_name, build) => {
    expect(validatePolishMediaBytes('animation', build())).toEqual(['media_glb_malformed'])
  })

  test.each(['model-position', 'model-unsigned-int', 'animation-input', 'animation-output'] as const)('rejects glTF normalized:true on forbidden %s accessors', (target) => {
    expect(validatePolishMediaBytes(target.startsWith('animation-') ? 'animation' : 'model', forbiddenNormalizedAccessorGlb(target))).toEqual(['media_glb_malformed'])
  })

  test.each([
    ['unnormalized integer weights', unnormalizedSkinWeightsAnimationGlb, 'media_glb_malformed'],
    ['an out-of-range skin joint index', outOfRangeSkinJointAnimationGlb, 'media_glb_malformed'],
    ['all-zero skin weights', zeroWeightSkinAnimationGlb, 'media_glb_animation_rig_missing'],
    ['skin attribute count mismatching POSITION', mismatchedSkinAccessorCountAnimationGlb, 'media_glb_malformed'],
    ['an unpaired additional joint set', unpairedSkinSetAnimationGlb, 'media_glb_malformed'],
    ['a non-finite float skin weight', nonFiniteSkinWeightAnimationGlb, 'media_glb_malformed'],
    ['a huge finite float skin weight', hugeSkinWeightAnimationGlb, 'media_glb_malformed'],
    ['an invalid inverse-bind-matrix accessor', invalidInverseBindMatricesAnimationGlb, 'media_glb_animation_rig_missing'],
    ['an out-of-range skeleton node', outOfRangeSkeletonAnimationGlb, 'media_glb_animation_rig_missing'],
    ['a combined buffer-view/accessor misalignment', misalignedAccessorAnimationGlb, 'media_glb_malformed'],
  ] as const)('rejects animation skinning with %s', (_name, build, code) => {
    expect(validatePolishMediaBytes('animation', build())).toEqual([code])
  })

  test.each([
    ['an unused fourth POSITION behind one triangle', unusedFourthPositionGlb, 'media_glb_placeholder'],
    ['a repeated fourth POSITION', repeatedFourthPositionGlb, 'media_glb_placeholder'],
    ['one good triangle beside a degenerate triangle', mixedDegenerateTriangleGlb, 'media_glb_placeholder'],
    ['an extra unreferenced mesh', extraUnreferencedMeshGlb, 'media_glb_placeholder'],
    ['mixed triangle and point primitives', mixedTrianglePointGlb, 'media_glb_placeholder'],
    ['a scene-reachable point-only primitive', referencedPointGlb, 'media_glb_placeholder'],
    ['an out-of-range vertex index', outOfRangeIndexGlb, 'media_glb_malformed'],
  ] as const)('rejects %s', (_name, build, code) => {
    expect(validatePolishMediaBytes('model', build())).toEqual([code])
  })

  test.each([
    ['text bytes labelled as PNG', 'image', () => Buffer.from('runtime:hero-character runtime:hero-character'), 'media_png_malformed'],
    ['text bytes labelled as GLB', 'model', () => Buffer.from('runtime:training-sentinel runtime:training-sentinel'), 'media_glb_malformed'],
    ['text bytes labelled as OGG', 'audio', () => Buffer.from('runtime:ambience runtime:ambience runtime:ambience'), 'media_ogg_malformed'],
    ['PNG with a corrupted chunk CRC', 'atlas', () => { const bytes = tinyPng(); bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff; return bytes }, 'media_png_malformed'],
    ['PNG with CRC-correct invalid compressed scanlines', 'image', () => pngWithInvalidDeflate(), 'media_png_malformed'],
    ['palette PNG with a late out-of-range index', 'image', () => outOfRangePaletteIndexPng(), 'media_png_malformed'],
    ['indexed PNG with empty tRNS', 'image', () => emptyPaletteTransparencyPng(), 'media_png_malformed'],
    ['truncated GLB container', 'model', () => tinyGlb('model').subarray(0, 40), 'media_glb_malformed'],
    ['GLB with an out-of-range POSITION accessor', 'model', () => glbWithOutOfRangePosition(), 'media_glb_malformed'],
    ['GLB with a self-cycle', 'model', () => cyclicSceneGlb(), 'media_glb_malformed'],
    ['GLB with a multi-node cycle', 'model', () => cyclicSceneGlb(true), 'media_glb_malformed'],
    ['GLB without an animation for the rig requirement', 'animation', () => tinyGlb('model'), 'media_glb_missing_animation'],
    ['Ogg stream without its terminating page', 'audio', () => { const bytes = tinyOgg(); return bytes.subarray(0, bytes.length - 31) }, 'media_ogg_malformed'],
    ['Ogg stream with duration metadata but no audio packet', 'audio', () => oggWithoutAudioPacket(), 'media_ogg_malformed'],
  ] as const)('refuses %s', (_name, kind, build, code) => {
    expect(validatePolishMediaBytes(kind, build())).toEqual([code])
  })

  test('requires retained licence bytes to carry the CC0 dedication text', () => {
    expect(validatePolishLicenceBytes(Buffer.from(CC0_TEXT))).toEqual([])
    expect(validatePolishLicenceBytes(Buffer.from('not the CC0 legal text'))).toEqual(['licence_text_mismatch'])
    expect(validatePolishLicenceBytes(Buffer.from('CC0 1.0 Creative Commons public domain. '.repeat(4)))).toEqual(['licence_text_mismatch'])
    expect(validatePolishLicenceBytes(Buffer.alloc(200, 0x90))).toEqual(['licence_text_mismatch'])
  })
})

describe('portable path and provenance contract', () => {
  test.each(['assets/hero.png:zone', 'assets/CON.png', 'assets/hero. ', 'assets/e\u0301.png', 'assets\\hero.png', '../hero.png', 'C:/hero.png'])('refuses Windows-unsafe or aliased path %s', (path) => {
    expect(safePolishPath(path)).toBeFalse()
  })

  test('uses case and Unicode compatibility folding for collision detection', () => {
    expect(portablePolishPathKey('Assets/HERO.png')).toBe(portablePolishPathKey('assets/hero.png'))
    expect(portablePolishPathKey('assets/\uff21.png')).toBe(portablePolishPathKey('assets/a.png'))
  })

  test.each([
    ['spoofed Kenney host', { canonicalUrl: 'https://evil.example/assets/hero-character' }],
    ['wrong Poly Haven acquisition', { provider: 'poly-haven', canonicalUrl: 'https://polyhaven.com/a/hero', acquisitionMode: 'download' }],
    ['unbound licence host', { licence: { id: 'CC0-1.0', referenceUrl: 'https://evil.example/licence', filePath: 'kei-mmo/content/licenses/hero.txt', sha256: 'a'.repeat(64), bytes: 10 } }],
    ['unverifiable source bytes', { sourceFile: { path: 'kei-mmo/content/source.bin', sha256: 'a'.repeat(64), bytes: 10, packaged: false } }],
    ['forbidden redistribution', { rawRedistribution: 'forbidden' }],
    ['Windows ADS', { processedOutputs: [{ path: 'assets/hero.png:zone', sha256: 'a'.repeat(64), bytes: 10 }] }],
    ['unpinned Kenney asset path', { canonicalUrl: 'https://kenney.nl/' }],
    ['attribution naming neither provider nor licence', { attribution: 'somebody else entirely' }],
    ['invented provider asset and matching invented assertions', { canonicalUrl: 'https://kenney.nl/assets/invented-hero-that-does-not-exist', providerAssetVersion: 'invented-v999', attribution: 'Kenney invented asset, CC0-1.0' }],
  ])('refuses %s', (_name, override) => {
    expect(parsePolishSourceManifest(sources([{ ...source(), ...override }]).value)).toBeNull()
  })

  test('binds provenance fields and retained byte hashes to the reviewed catalog record', () => {
    const registry = sources([source()]).value as any
    expect(validatePolishSourceManifestDocument(registry)).toEqual([])
    registry.assets[0].sourceFile.sha256 = 'b'.repeat(64)
    expect(validatePolishSourceManifestDocument(registry)).toContain('source_catalog_mismatch')
  })

  test.each([
    ['null source', (registry: any) => { registry.assets[0] = null }, 'invalid_source'],
    ['primitive source', (registry: any) => { registry.assets[0] = 11 }, 'invalid_source'],
    ['null source file', (registry: any) => { registry.assets[0].sourceFile = null }, 'invalid_source'],
    ['null licence', (registry: any) => { registry.assets[0].licence = null }, 'invalid_source'],
    ['null processed output', (registry: any) => { registry.assets[0].processedOutputs[0] = null }, 'invalid_output'],
  ] as const)('is total over a %s', (_name, mutate, expectedCode) => {
    const registry = sources([source()]).value as any; mutate(registry)
    let problems: string[] = []
    expect(() => { problems = validatePolishSourceManifestDocument(registry) }).not.toThrow()
    expect(problems).toContain(expectedCode)
    expect(() => parsePolishSourceManifest(registry)).not.toThrow()
    expect(parsePolishSourceManifest(registry)).toBeNull()
  })

  test('binds catalog members to dimensions, roles, kinds, and distinct processed identities', () => {
    const manifest = generated('2d').manifest
    const registry = sources(manifest.assets.map((requirement: any) => source(requirement.id))).value as any
    expect(validatePolishSourceManifestBinding(manifest, registry)).toEqual([])
    registry.assets.find((asset: any) => asset.id === 'training-sentinel').processedOutputs[0].sha256 = registry.assets.find((asset: any) => asset.id === 'hero-character').processedOutputs[0].sha256
    expect(validatePolishSourceManifestBinding(manifest, registry)).toContain('processed_output_alias')
    const wrongRole = structuredClone(manifest)
    wrongRole.assets.find((asset: any) => asset.id === 'hero-character').role = 'target'
    expect(validatePolishSourceManifestBinding(wrongRole, sources(wrongRole.assets.map((requirement: any) => source(requirement.id))).value)).toContain('source_catalog_role_mismatch')
    const threeDimensionalHero = polishSourceCatalogRecord('hero-character', '18835fef534eede635b081ee7fe647d01a885550a591d2e6bf071010906167d8')
    expect(threeDimensionalHero).toMatchObject({ dimensions: ['3d'], role: 'character', kinds: ['model'], sourceArchiveEntry: 'Model/characterMedium.fbx' })
  })

  test('refuses cross-record case and Unicode path collisions', () => {
    const second = source('training-sentinel', { processedOutputs: [{ path: 'ASSETS/POLISH/HERO-CHARACTER.PNG', sha256: 'b'.repeat(64), bytes: 10 }] })
    const first = source('hero-character', { processedOutputs: [{ path: 'assets/polish/hero-character.png', sha256: 'a'.repeat(64), bytes: 10 }] })
    expect(parsePolishSourceManifest(sources([first, second]).value)).toBeNull()
  })

  test('checks source, licence, credits, output bytes and per-file budget', () => {
    const { manifest } = generated()
    const parsedManifest = parsePolishAssetManifest(manifest)!
    const registry = sources(parsedManifest.assets.map((requirement) => source(requirement.id)))
    const parsedSources = parsePolishSourceManifest(registry.value)!
    const files = new Map<string, { size: number; sha256: string }>([[parsedSources.credits.path, { size: parsedSources.credits.bytes, sha256: parsedSources.credits.sha256 }]])
    for (const record of parsedSources.assets) {
      files.set(record.sourceFile.path, { size: record.sourceFile.bytes, sha256: record.sourceFile.sha256 })
      files.set(record.licence.filePath, { size: record.licence.bytes, sha256: record.licence.sha256 })
      files.set(record.processedOutputs[0]!.path, { size: record.processedOutputs[0]!.bytes, sha256: record.processedOutputs[0]!.sha256 })
    }
    expect(admitPolishAssets(parsedManifest, parsedSources, (path) => files.get(path) ?? null).code).toBe('polish_review_required')
    const first = parsedSources.assets[0]!
    files.set(first.licence.filePath, { size: first.licence.bytes, sha256: 'b'.repeat(64) })
    expect(admitPolishAssets(parsedManifest, parsedSources, (path) => files.get(path) ?? null).problems).toContainEqual(expect.objectContaining({ code: 'hash_mismatch' }))
  })
})
