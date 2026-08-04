import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { projectFiles } from '../src/scaffold.js'
import { POLISH_CHECK_PATH, POLISH_RECIPE_PATH } from '../src/scaffold-polish.js'
import { planFor } from './fixtures.js'
import { runProcess } from './process.js'

const temporary: string[] = []
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('generated polish contract', () => {
  for (const dimension of ['2d', '3d'] as const) {
    test(`${dimension} owns a recipe and a fail-closed check without harness imports`, async () => {
      const plan = planFor({ name: `Polish ${dimension}`, dimension, gameplay: 'Players meet a training sentinel.' })
      const files = projectFiles({ slug: `polish-${dimension}`, title: `Polish ${dimension}` }, plan)
      const paths = files.map(({ path }) => path)
      expect(paths).toContain(POLISH_RECIPE_PATH)
      expect(paths).toContain(POLISH_CHECK_PATH)
      const recipe = JSON.parse(files.find(({ path }) => path === POLISH_RECIPE_PATH)!.contents)
      expect(recipe.dimension).toBe(dimension)
      const quality = JSON.parse(files.find(({ path }) => path === 'kei-mmo/polish/quality.json')!.contents)
      expect(quality.profiles).toEqual(recipe.qualityProfiles)
      expect(JSON.parse(files.find(({ path }) => path === 'package.json')!.contents).scripts['polish:check']).toBe(`node ${POLISH_CHECK_PATH}`)
      for (const file of files.filter(({ path }) => path.startsWith('kei-mmo/polish/'))) {
        expect(file.contents).not.toMatch(/from ['"]create-kei-mmo|require\(['"]create-kei-mmo/)
      }

      const directory = mkdtempSync(join(tmpdir(), `kei-polish-${dimension}-`)); temporary.push(directory)
      for (const file of files.filter(({ path }) => path.startsWith('kei-mmo/polish/'))) {
        const target = join(directory, ...file.path.split('/')); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, file.contents)
      }
      const result = await runProcess(process.execPath, [join(directory, ...POLISH_CHECK_PATH.split('/'))], { cwd: directory, timeoutMs: 10_000 })
      expect(result.status).toBe(1)
      const report = JSON.parse(result.stderr)
      expect(report).toMatchObject({ code: 'polish_assets_pending' })
      expect(report.problems).toContainEqual(expect.objectContaining({ code: 'missing_source', id: 'hero-character' }))
    })
  }
})
