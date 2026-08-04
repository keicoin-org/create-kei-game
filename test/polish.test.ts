import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'

import {
  POLISH_CREDITS_PATH,
  admitPolishAssets,
  expectedCredits,
  parsePolishAssetManifest,
  parsePolishRecipe,
  parsePolishSourceManifest,
  portablePolishPathKey,
  safePolishPath,
  validatePolishRecipeDocument,
  type PolishSourceManifestV1,
} from '../src/polish.js'
import { polishProjectFiles, POLISH_ASSET_MANIFEST_PATH, POLISH_RECIPE_PATH } from '../src/scaffold-polish.js'
import { planFor } from './fixtures.js'

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
  const raw = `raw:${id}`; const licence = `CC0:${id}`; const output = `asset:${id}`
  return {
    id,
    canonicalUrl: `https://kenney.nl/assets/${id}`,
    provider: 'kenney', providerAssetVersion: '2026-01-15', acquisitionMode: 'download', acquiredAt: '2026-08-04T12:00:00.000Z',
    sourceFile: { path: `kei-mmo/content/source-bytes/${id}.bin`, sha256: hash(raw), bytes: Buffer.byteLength(raw), packaged: true },
    licence: { id: 'CC0-1.0', referenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', filePath: `kei-mmo/content/licenses/${id}.txt`, sha256: hash(licence), bytes: Buffer.byteLength(licence) },
    attribution: `Kenney ${id}, CC0`, rawRedistribution: 'allowed',
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
  ])('rejects %s identically through the authoritative validator', (_name, mutate) => {
    const recipe = structuredClone(generated().recipe); mutate(recipe)
    expect(validatePolishRecipeDocument(recipe).length).toBeGreaterThan(0)
    expect(parsePolishRecipe(recipe)).toBeNull()
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
  ])('refuses %s', (_name, override) => {
    expect(parsePolishSourceManifest(sources([{ ...source(), ...override }]).value)).toBeNull()
  })

  test('refuses cross-record case and Unicode path collisions', () => {
    const second = source('training-sentinel', { processedOutputs: [{ path: 'ASSETS/POLISH/HERO-CHARACTER.PNG', sha256: 'b'.repeat(64), bytes: 10 }] })
    const first = source('hero-character', { processedOutputs: [{ path: 'assets/polish/hero-character.png', sha256: 'a'.repeat(64), bytes: 10 }] })
    expect(parsePolishSourceManifest(sources([first, second]).value)).toBeNull()
  })

  test('checks source, licence, credits, output bytes and per-file budget', () => {
    const { manifest } = generated()
    manifest.assets = [manifest.assets[0]]
    const parsedManifest = parsePolishAssetManifest(manifest)!
    const registry = sources([source()]); const parsedSources = parsePolishSourceManifest(registry.value)!
    const record = parsedSources.assets[0]!
    const files = new Map([
      [parsedSources.credits.path, { size: parsedSources.credits.bytes, sha256: parsedSources.credits.sha256 }],
      [record.sourceFile.path, { size: record.sourceFile.bytes, sha256: record.sourceFile.sha256 }],
      [record.licence.filePath, { size: record.licence.bytes, sha256: record.licence.sha256 }],
      [record.processedOutputs[0]!.path, { size: record.processedOutputs[0]!.bytes, sha256: record.processedOutputs[0]!.sha256 }],
    ])
    expect(admitPolishAssets(parsedManifest, parsedSources, (path) => files.get(path) ?? null).code).toBe('polish_ready')
    files.set(record.licence.filePath, { size: record.licence.bytes, sha256: 'b'.repeat(64) })
    expect(admitPolishAssets(parsedManifest, parsedSources, (path) => files.get(path) ?? null).problems).toContainEqual(expect.objectContaining({ code: 'hash_mismatch' }))
  })
})
