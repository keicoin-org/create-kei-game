/**
 * `tsc --noEmit` against the project as scaffolded, not against the templates
 * it was assembled from.
 *
 * `typecheck.test.ts` (#61) put `templates/` inside a typechecked program, but
 * it reads the templates as they sit on disk, with the three `__…_LITERAL__`
 * tokens standing in as `string`. That is four things outside the check —
 * see #63 — and this closes the first three of them for the local template:
 *
 *   1. Substitution itself. `literal()` quotes a currency name for source
 *      text; a name that survives escaping into something that typechecks
 *      but does not parse would pass every other test in this suite and only
 *      show up here, compiling the actual substituted output.
 *   2. The generated `tsconfig.json` as the developer receives it — its own
 *      `include`, resolved from the project's own root, not extended from
 *      this package's.
 *   3. A template that is individually valid but disagrees with itself once
 *      assembled — this compiles every generated file as one program, the
 *      way the developer's own `tsc` would.
 *
 * It does not close the fourth: `world-of-wonder` and `carpet-markets` are
 * downloaded rather than shipped (`templates.ts`), so nothing here compiles
 * them. That needs a network fetch and a real package install and belongs in
 * its own, slower job — see #63's discussion of a scheduled run.
 *
 * No `bun install` happens for the scaffolded project either: it resolves
 * `kei-transaction` and `@babylonjs/core` by walking up to this package's own
 * `node_modules`, the same way `purchase.test.ts` already relies on for
 * running the generated server. That is also this test's one gap against a
 * real developer checkout — it cannot catch a `dependencies` entry that is
 * missing or wrong, only code that fails to compile once the packages it
 * names are resolved from somewhere.
 */

import { describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

import { projectFrom } from '../src/naming.js'
import { scaffold } from '../src/scaffold.js'
import { writeFiles } from '../src/write.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const directory = join(root, '.generated', 'scaffold-typecheck')

describe('the scaffolded project, typechecked as itself', () => {
  // Building a real ts.Program over Babylon.js and the SDK is slower than this
  // suite's other tests — comfortably under a second run alone, but this
  // suite runs everything else alongside it too, and the default per-test
  // timeout is tighter than that leaves room for.
  test(
    'star-clicker compiles clean against its own tsconfig.json',
    async () => {
      await rm(directory, { recursive: true, force: true })
      const project = projectFrom({ name: 'Star Clicker', currency: 'Gold Pieces' })
      await writeFiles(directory, await scaffold(project, { sdkVersion: '^0.8.0' }))

      const configPath = join(directory, 'tsconfig.json')
      const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
          throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
        },
      })
      if (!parsed) throw new Error(`${configPath} could not be read`)
      expect(parsed.fileNames.length).toBeGreaterThan(0)

      const program = ts.createProgram(parsed.fileNames, parsed.options)
      const diagnostics = ts.getPreEmitDiagnostics(program)

      const messages = diagnostics.map((diagnostic) => {
        const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        if (!diagnostic.file || diagnostic.start === undefined) return text
        const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        return `${diagnostic.file.fileName}:${line + 1}:${character + 1} — ${text}`
      })
      expect(messages).toEqual([])

      await rm(directory, { recursive: true, force: true })
    },
    30_000,
  )
})
