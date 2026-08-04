import { createHash } from 'node:crypto'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { expectedCredits, parsePolishRecipe, type PolishSourceManifestV1 } from '../src/polish.js'
import {
  POLISH_ASSET_MANIFEST_PATH,
  POLISH_ATTRIBUTION_PATH,
  POLISH_CHECK_PATH,
  POLISH_RECIPE_PATH,
  POLISH_SOURCE_MANIFEST_PATH,
  polishProjectFiles,
} from '../src/scaffold-polish.js'
import { planFor } from './fixtures.js'
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
    const raw = Buffer.from(`raw:${requirement.id}`); const licence = Buffer.from(`CC0:${requirement.id}`); const output = Buffer.from(`runtime:${requirement.id}`)
    const extension = requirement.kind === 'audio' ? 'ogg' : requirement.kind === 'model' || requirement.kind === 'animation' ? 'glb' : 'png'
    const sourcePath = `kei-mmo/content/source-bytes/${requirement.id}.bin`
    const licencePath = `kei-mmo/content/licenses/${requirement.id}.txt`
    const outputPath = `assets/polish/${requirement.id}.${extension}`
    put(root, sourcePath, raw); put(root, licencePath, licence); put(root, outputPath, output)
    return {
      id: requirement.id, canonicalUrl: `https://kenney.nl/assets/${requirement.id}`, provider: 'kenney', providerAssetVersion: '2026-08-04', acquisitionMode: 'download', acquiredAt: '2026-08-04T12:00:00.000Z',
      sourceFile: { path: sourcePath, sha256: sha256(raw), bytes: raw.byteLength, packaged: true },
      licence: { id: 'CC0-1.0', referenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', filePath: licencePath, sha256: sha256(licence), bytes: licence.byteLength },
      attribution: `Kenney ${requirement.id}, CC0`, rawRedistribution: 'allowed', processedOutputs: [{ path: outputPath, sha256: sha256(output), bytes: output.byteLength }],
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
    test(`${dimension} is ready only with fully admitted project bytes`, async () => {
      const ready = fixture(dimension, true)
      const result = await check(ready.root)
      expect(result.status).toBe(0)
      expect(result.report).toMatchObject({ ok: true, code: 'polish_ready', admitted: ready.manifest.assets.length })
    })
  }

  test.each([
    ['unknown event', (recipe: any) => { recipe.actions[0].events.push('execute') }],
    ['silent effect', (recipe: any) => { recipe.effects.contact.cue = null }],
    ['missing remote observer', (recipe: any) => { recipe.capture.steps[5].observerIds = [] }],
    ['nonmonotonic authority', (recipe: any) => { recipe.authority.events[1].tick = recipe.authority.events[0].tick }],
    ['nonmonotonic quality', (recipe: any) => { recipe.qualityProfiles.low.maxParticles = 500 }],
  ])('copies the authoritative parser and rejects %s after harness deletion', async (_name, mutate) => {
    const current = fixture('2d', true); mutate(current.recipe)
    expect(parsePolishRecipe(current.recipe)).toBeNull()
    put(current.root, POLISH_RECIPE_PATH, json(current.recipe))
    const result = await check(current.root)
    expect(result.status).toBe(1)
    expect(result.report.code).toBe('polish_assets_invalid')
    expect(result.report.problems.some((problem: any) => String(problem.code).startsWith('invalid_') || problem.code === 'non_monotonic_quality' || problem.code === 'missing_remote_observation')).toBeTrue()
  })

  test.each([
    ['provider host', (current: any) => { current.sources.assets[0].canonicalUrl = 'https://evil.example/assets/hero' }],
    ['licence bytes', (current: any) => { put(current.root, current.sources.assets[0].licence.filePath, 'tampered licence') }],
    ['credits bytes', (current: any) => { put(current.root, POLISH_ATTRIBUTION_PATH, '# forged credits\n') }],
    ['processed hash', (current: any) => { put(current.root, current.sources.assets[0].processedOutputs[0].path, 'tampered output') }],
    ['Windows alias', (current: any) => { current.sources.assets[0].processedOutputs[0].path = 'assets/polish/CON.png' }],
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
