/**
 * What a 3D scaffold actually receives, and the test the whole slice hangs on:
 * the generated project keeps working with the harness gone. The check script
 * runs under plain `node`; the player imports nothing; and a generated asset
 * whose bytes never arrived fails the project's own gate, not just ours.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { contentProjectFiles, CONTENT_MANIFEST_PATH, CUTSCENE_PLAYER_PATH } from '../src/content-project.js'
import { planMmo } from '../src/planner.js'
import { projectFrom } from '../src/naming.js'
import type { WorkspaceFile } from '../src/source.js'
import { scaffoldWorkspace } from '../src/source.js'
import { intentFor, SCAFFOLD_INTENT } from './fixtures.js'

/** A 3D brief that asks for a story opening and ambient sound, in sci-fi. */
const CINEMATIC_INTENT = {
  name: 'Salvage Run',
  dimension: '3d' as const,
  gameplay: 'Crews salvage derelict stations, with a story intro cinematic.',
  art: 'Grounded, with an ambient hum of machinery.',
}

const temporary: string[] = []

function writtenTo(directory: string, files: readonly WorkspaceFile[]): void {
  for (const file of files) {
    const target = join(directory, ...file.path.split('/'))
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, file.contents, 'utf8')
  }
}

function scaffoldOnDisk(intent: Parameters<typeof intentFor>[0]): { directory: string; files: readonly WorkspaceFile[] } {
  const plan = planMmo(intentFor(intent))
  const files = scaffoldWorkspace(projectFrom(plan.intent.name), plan)
  const directory = mkdtempSync(join(tmpdir(), 'kei-mmo-content-'))
  temporary.push(directory)
  writtenTo(directory, files)
  return { directory, files }
}

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('what the scaffold carries', () => {
  test('a plain 3D plan gets manifest, pipelines, and check — no cut-scene it never asked for', () => {
    const plan = planMmo(intentFor(SCAFFOLD_INTENT))
    const files = contentProjectFiles(projectFrom(plan.intent.name), plan)
    const paths = files.map(({ path }) => path)
    expect(paths).toEqual(['kei-mmo/content/manifest.json', 'kei-mmo/content/pipelines.json', 'kei-mmo/content/check.mjs'])
  })

  test('a cinematic brief adds the assembled cut-scene and the player module', () => {
    const plan = planMmo(intentFor(CINEMATIC_INTENT))
    const files = contentProjectFiles(projectFrom(plan.intent.name), plan)
    const paths = files.map(({ path }) => path)
    expect(paths).toContain('kei-mmo/content/cutscenes/salvage-run-arrival.json')
    expect(paths).toContain(CUTSCENE_PLAYER_PATH)
  })

  test('a 2D plan gets no content files and its scaffold is untouched', () => {
    const plan = planMmo(intentFor({ name: 'Flatland', dimension: '2d', gameplay: 'Pixel traders in a tile world.' }))
    expect(plan.content).toBeUndefined()
    expect(contentProjectFiles(projectFrom('Flatland'), plan)).toEqual([])
    const paths = scaffoldWorkspace(projectFrom('Flatland'), plan).map(({ path }) => path)
    expect(paths).not.toContain('kei-mmo/content/manifest.json')
    expect(JSON.parse(scaffoldWorkspace(projectFrom('Flatland'), plan).find(({ path }) => path === 'package.json')!.contents).scripts['content:check']).toBeUndefined()
  })

  test('the declared style changes what the manifest carries', () => {
    const sciFi = planMmo(intentFor(CINEMATIC_INTENT))
    const historical = planMmo(intentFor({
      name: 'Longships',
      dimension: '3d',
      gameplay: 'Viking crews raid a medieval coast, with a story intro.',
    }))
    const manifestFor = (plan: typeof sciFi) =>
      JSON.parse(
        contentProjectFiles(projectFrom(plan.intent.name), plan)
          .find(({ path }) => path === CONTENT_MANIFEST_PATH)!.contents,
      ) as { assets: Array<{ id: string; kind: string }> }

    const sciFiIds = manifestFor(sciFi).assets.map(({ id }) => id)
    const historicalIds = manifestFor(historical).assets.map(({ id }) => id)
    expect(sciFiIds).toContain('console-bank')
    expect(sciFiIds).not.toContain('barrel')
    expect(historicalIds).toContain('barrel')
    expect(historicalIds).not.toContain('console-bank')
  })

  test('no genre leaks into an unspecified brief\'s content, fantasy least of all', () => {
    const plan = planMmo(intentFor({ name: 'Plain', dimension: '3d', gameplay: 'Players trade and build together, with a story intro.' }))
    const files = contentProjectFiles(projectFrom('Plain'), plan)
    const everything = files.map(({ contents }) => contents).join('\n').toLowerCase()
    for (const word of ['fantasy', 'dragon', 'magic', 'shrine', 'medieval', 'starship', 'cyber']) {
      expect(everything).not.toContain(word)
    }
    expect(plan.content?.style.setting).toBe('unspecified')
  })

  test('content files are deterministic, byte for byte, across runs', () => {
    const render = () => {
      const plan = planMmo(intentFor(CINEMATIC_INTENT))
      return contentProjectFiles(projectFrom(plan.intent.name), plan)
        .map(({ path, contents }) => `${path}\n${contents}`)
        .join('\n---\n')
    }
    expect(render()).toBe(render())
  })

  test('nothing written imports the harness, and the player imports nothing at all', () => {
    const plan = planMmo(intentFor(CINEMATIC_INTENT))
    const files = scaffoldWorkspace(projectFrom(plan.intent.name), plan)
    for (const file of files) {
      expect(file.contents).not.toMatch(/from ['"]create-kei-mmo|require\(['"]create-kei-mmo/)
    }
    const player = files.find(({ path }) => path === CUTSCENE_PLAYER_PATH)!
    expect(player.contents).not.toMatch(/^\s*import /m)
  })
})

describe('runnable with the harness deleted', () => {
  test('the check script admits the scaffold under plain node, and blocks a missing generated output', () => {
    const { directory } = scaffoldOnDisk(CINEMATIC_INTENT)
    const script = join(directory, 'kei-mmo', 'content', 'check.mjs')

    const clean = spawnSync('node', [script], { encoding: 'utf8', timeout: 30_000 })
    expect(clean.error).toBeUndefined()
    expect(clean.stderr).toBe('')
    expect(clean.status).toBe(0)
    expect(clean.stdout).toContain('Content admitted')

    // The developer declares a generated mesh; the generator never ran. The
    // project's own gate — not the harness — refuses the manifest.
    const manifestPath = join(directory, 'kei-mmo', 'content', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { assets: unknown[] }
    manifest.assets.push({
      id: 'hero-wreck',
      kind: 'model-file',
      title: 'Hero wreck',
      source: { kind: 'generated', generator: 'text-to-3d' },
      licence: 'CC0-1.0',
      path: 'assets/models/hero-wreck.glb',
    })
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    const blocked = spawnSync('node', [script], { encoding: 'utf8', timeout: 30_000 })
    expect(blocked.status).toBe(1)
    expect(blocked.stderr).toContain('generator_output_missing')
    expect(blocked.stderr).toContain('text-to-3d')
  })

  test('the check script refuses a cut-scene referencing a clip that is not admitted', () => {
    const { directory } = scaffoldOnDisk(CINEMATIC_INTENT)
    const manifestPath = join(directory, 'kei-mmo', 'content', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { assets: Array<{ id: string }> }
    // The walk clip's record disappears after the scene shipped — the exact
    // drift the gate exists to catch.
    manifest.assets = manifest.assets.filter(({ id }) => id !== 'walk-loop')
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    const result = spawnSync('node', [join(directory, 'kei-mmo', 'content', 'check.mjs')], {
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('walk-loop')
    expect(result.stderr).toContain('never reference a missing clip')
  })

  test('the player module drives the shipped cut-scene with no harness anywhere near it', async () => {
    const { directory } = scaffoldOnDisk(CINEMATIC_INTENT)
    const player = await import(pathToFileURL(join(directory, 'src', 'shared', 'cutscene.ts')).href) as
      typeof import('../src/content-project.js') extends never ? never : {
        cutSceneDuration(doc: unknown): number
        advanceCutScene(doc: unknown, timeMs: number, previousTimeMs?: number): {
          done: boolean
          beatId: string
          line: string
          camera: { position: readonly number[]; lookAt: readonly number[]; fovDeg: number }
          actions: readonly { clipId: string }[]
          dueCues: readonly { cueId: string }[]
        }
      }
    const doc = JSON.parse(
      readFileSync(join(directory, 'kei-mmo', 'content', 'cutscenes', 'salvage-run-arrival.json'), 'utf8'),
    ) as { durationMs: number }

    expect(player.cutSceneDuration(doc)).toBe(doc.durationMs)

    const opening = player.advanceCutScene(doc, 0)
    expect(opening.done).toBeFalse()
    expect(opening.beatId).toBe('beat-1')
    expect(opening.line).not.toBe('')
    expect(opening.camera.fovDeg).toBeGreaterThan(0)
    expect(opening.dueCues.map(({ cueId }) => cueId)).toContain('cue-drone')

    const midway = player.advanceCutScene(doc, 12_000, 0)
    expect(midway.beatId).toBe('beat-3')
    expect(midway.actions.map(({ clipId }) => clipId)).toContain('kneel-inspect')

    const wide = player.advanceCutScene(doc, 0).camera.position
    const pushed = player.advanceCutScene(doc, 10_500, 10_000).camera.position
    expect(pushed).not.toEqual(wide)

    const end = player.advanceCutScene(doc, doc.durationMs, doc.durationMs - 100)
    expect(end.done).toBeTrue()
  })
})
