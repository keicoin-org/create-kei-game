/**
 * The gate over `templates/`, and whether it is one.
 *
 * `templates/` is the product — `src/` is only the machinery that copies it —
 * and until `tsconfig.templates.json` existed it was outside every program in
 * this repository. `tsc` reported success without opening a single file under
 * it, which is how `server/orders.ts` came to reference five functions that do
 * not exist and still pass the build. A missing identifier is the easiest error
 * a typechecker catches, and this one shipped.
 *
 * So the interesting assertion is not "the templates compile" — that is the
 * first test and it is the cheap half. It is the second: that the gate refuses
 * something. A config whose `include` quietly matches nothing also exits 0, and
 * is indistinguishable from a passing check until the day it is needed. Here the
 * probe is added to `templates/server/`, which the shipped config covers by
 * directory rather than by filename, so the file being checked at all is part of
 * what is under test.
 *
 * Both cases run `bun run typecheck:templates` as a process, because that string
 * is what `.github/workflows/ci.yml` runs. A test that called the compiler API
 * directly would keep passing through a typo in the script.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const repository = join(import.meta.dir, '..')

/**
 * Somewhere the shipped `include` already covers. Named as a probe so a run that
 * dies before its cleanup leaves something obviously not a template behind.
 */
const probe = join(repository, 'templates', 'server', 'undefined-identifier.probe.ts')

interface Check {
  code: number
  output: string
}

async function typecheckTemplates(): Promise<Check> {
  const child = Bun.spawn(['bun', 'run', 'typecheck:templates'], {
    cwd: repository,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code: await child.exited, output: `${stdout}${stderr}` }
}

afterEach(async () => {
  await rm(probe, { force: true })
})

describe('typechecking the generated game', () => {
  test(
    'the templates compile under the options a generated project ships with',
    async () => {
      const { code, output } = await typecheckTemplates()
      expect(output).not.toMatch(/error TS/)
      expect(code).toBe(0)
    },
    120_000,
  )

  test(
    'a template file referencing an undefined identifier fails the build',
    async () => {
      // The reported shape, reduced to one line: a call to something no import
      // and no declaration provides. Under the old config this file was not read
      // and `bun run typecheck` still said nothing was wrong.
      await writeFile(probe, 'export const rows = entriesFrom(new Map<string, number>())\n')

      const { code, output } = await typecheckTemplates()
      expect(output).toMatch(/error TS2304: Cannot find name 'entriesFrom'/)
      expect(code).not.toBe(0)
    },
    120_000,
  )
})
