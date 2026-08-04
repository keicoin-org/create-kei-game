import { describe, expect, test } from 'bun:test'

import { parsePolishRecipe, parsePolishAssetManifest, parsePolishSourceManifest, admitPolishAssets } from '../src/polish.js'
import { polishProjectFiles, POLISH_RECIPE_PATH } from '../src/scaffold-polish.js'
import { planFor } from './fixtures.js'

function generatedRecipe(): Record<string, any> {
  const plan = planFor({ name: 'Polish Contract', dimension: '2d', gameplay: 'Players meet a training sentinel.' })
  return JSON.parse(polishProjectFiles(plan).find(({ path }) => path === POLISH_RECIPE_PATH)!.contents)
}

function source(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'hero-character',
    canonicalUrl: 'https://kenney.nl/assets/example-pack',
    provider: 'kenney',
    providerAssetVersion: '2026-01-15',
    acquisitionMode: 'download',
    acquiredAt: '2026-08-04T12:00:00.000Z',
    sha256: 'a'.repeat(64),
    licence: { id: 'CC0-1.0', referenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', filePath: 'assets/licenses/hero.txt' },
    attribution: 'Kenney, CC0; attribution retained for provenance.',
    rawRedistribution: 'allowed',
    processedOutputs: [{ path: 'assets/polish/hero.png', sha256: 'a'.repeat(64) }],
    ...overrides,
  }
}

describe('PolishRecipeV1', () => {
  test('parses the generated semantic encounter exactly', () => {
    const parsed = parsePolishRecipe(generatedRecipe())
    expect(parsed?.version).toBe(1)
    expect(parsed?.actions.map(({ kind }) => kind)).toEqual(['interact', 'strike'])
    expect(parsed?.qualityProfiles.medium.postProcessing).toEqual(['fxaa', 'bloom'])
  })

  test('refuses foreign versions, unknown fields, and invalid timing', () => {
    const original = generatedRecipe()
    expect(parsePolishRecipe({ ...original, version: 2 })).toBeNull()
    expect(parsePolishRecipe({ ...original, surprise: true })).toBeNull()
    const actions = structuredClone(original.actions)
    actions[0].contactMs = actions[0].anticipationMs
    expect(parsePolishRecipe({ ...original, actions })).toBeNull()
  })

  test('refuses duplicate action ids and impossible quality degradation', () => {
    const original = generatedRecipe()
    const duplicate = structuredClone(original.actions)
    duplicate[1].id = duplicate[0].id
    expect(parsePolishRecipe({ ...original, actions: duplicate })).toBeNull()

    const qualityProfiles = structuredClone(original.qualityProfiles)
    qualityProfiles.low.maxParticles = qualityProfiles.high.maxParticles + 1
    expect(parsePolishRecipe({ ...original, qualityProfiles })).toBeNull()
  })
})

describe('polish source admission', () => {
  test('refuses foreign manifests and duplicate ids', () => {
    expect(parsePolishSourceManifest({ version: 2, assets: [] })).toBeNull()
    expect(parsePolishSourceManifest({ version: 1, assets: [source(), source()] })).toBeNull()
    expect(parsePolishAssetManifest({ version: 1, recipeId: 'first-encounter', assets: [
      { id: 'hero-character', role: 'character', kind: 'image' },
      { id: 'hero-character', role: 'character', kind: 'image' },
    ] })).toBeNull()
  })

  test.each([
    ['traversal', source({ processedOutputs: [{ path: '../hero.png', sha256: 'a'.repeat(64) }] })],
    ['absolute path', source({ processedOutputs: [{ path: 'C:/hero.png', sha256: 'a'.repeat(64) }] })],
    ['hotlink path', source({ processedOutputs: [{ path: 'https://cdn.example/hero.png', sha256: 'a'.repeat(64) }] })],
    ['data URL path', source({ processedOutputs: [{ path: 'data:image/png;base64,AAAA', sha256: 'a'.repeat(64) }] })],
    ['insecure source URL', source({ canonicalUrl: 'http://kenney.nl/assets/example-pack' })],
    ['credential URL', source({ canonicalUrl: 'https://token@kenney.nl/assets/example-pack' })],
    ['unpinned URL', source({ canonicalUrl: 'https://kenney.nl/assets/example-pack?latest=1' })],
    ['missing hash', source({ sha256: '' })],
    ['missing processed hash', source({ processedOutputs: [{ path: 'assets/polish/hero.png', sha256: '' }] })],
    ['missing licence id', source({ licence: { id: '', referenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', filePath: 'assets/licenses/hero.txt' } })],
    ['unsafe licence path', source({ licence: { id: 'CC0-1.0', referenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', filePath: '../license.txt' } })],
  ])('refuses %s', (_name, invalid) => {
    expect(parsePolishSourceManifest({ version: 1, assets: [invalid] })).toBeNull()
  })

  test('refuses duplicate processed output paths even across records', () => {
    expect(parsePolishSourceManifest({ version: 1, assets: [
      source(),
      source({ id: 'training-sentinel', processedOutputs: [{ path: 'ASSETS/POLISH/HERO.PNG', sha256: 'b'.repeat(64) }] }),
    ] })).toBeNull()
  })

  test('reports an explicit pending state until every requirement has a source', () => {
    const requirements = parsePolishAssetManifest({ version: 1, recipeId: 'first-encounter', assets: [
      { id: 'hero-character', role: 'character', kind: 'image' },
      { id: 'impact', role: 'audio', kind: 'audio' },
    ] })!
    const sources = parsePolishSourceManifest({ version: 1, assets: [source()] })!
    const report = admitPolishAssets(requirements, sources, () => ({ size: 10, sha256: 'a'.repeat(64) }))
    expect(report.ok).toBeFalse()
    expect(report.code).toBe('polish_assets_pending')
    expect(report.problems).toContainEqual(expect.objectContaining({ code: 'missing_source', id: 'impact' }))
  })

  test('refuses missing and hash-mismatched processed bytes', () => {
    const requirements = parsePolishAssetManifest({ version: 1, recipeId: 'first-encounter', assets: [
      { id: 'hero-character', role: 'character', kind: 'image' },
    ] })!
    const sources = parsePolishSourceManifest({ version: 1, assets: [source()] })!
    expect(admitPolishAssets(requirements, sources, () => null).code).toBe('polish_assets_invalid')
    expect(admitPolishAssets(requirements, sources, () => ({ size: 10, sha256: 'a'.repeat(64), isSymlink: true })).problems[0]?.code).toBe('symlink_refused')
    const mismatch = admitPolishAssets(requirements, sources, () => ({ size: 10, sha256: 'b'.repeat(64) }))
    expect(mismatch.problems[0]?.code).toBe('hash_mismatch')
  })
})
