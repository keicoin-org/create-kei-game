/**
 * That the deliverable is inside a typechecked program.
 *
 * `tsconfig.json` covered `src` alone for as long as this package existed, so
 * `templates/` — the game a developer actually runs — was outside every program
 * and a missing identifier in it was nobody's error. The gate is
 * `tsconfig.templates.json` and `bun run typecheck`; what can silently undo it
 * is not the config being deleted, which is loud, but a template file being
 * added somewhere the config's `include` does not reach. A `templates/client/`
 * that nothing checks is the same hole again, quietly.
 *
 * So this expands the config the way `tsc` does — through TypeScript's own
 * parser, `extends` and `exclude` and all — and asks it whether it has heard of
 * every template source on disk. It is deliberately not a typecheck: running
 * one costs a minute because the template imports Babylon.js, and this has to
 * be cheap enough to stay in the suite.
 */

import { describe, expect, test } from 'bun:test'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))

/** What `tsc -p tsconfig.templates.json` would read, as absolute paths. */
const programFiles = (config: string): Set<string> => {
  const path = resolve(root, config)
  const parsed = ts.getParsedCommandLineOfConfigFile(path, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
    },
  })
  if (!parsed) throw new Error(`${config} could not be read`)
  const errors = parsed.errors.filter((error) => error.category === ts.DiagnosticCategory.Error)
  if (errors.length > 0) {
    throw new Error(errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, ' ')).join('\n'))
  }
  return new Set(parsed.fileNames.map((name) => resolve(name)))
}

const sourcesUnder = async (directory: string, prefix = ''): Promise<string[]> => {
  const found: string[] = []
  for (const entry of await readdir(join(directory, prefix))) {
    const relative = prefix === '' ? entry : `${prefix}${sep}${entry}`
    if ((await stat(join(directory, relative))).isDirectory()) {
      found.push(...(await sourcesUnder(directory, relative)))
    } else if (/\.tsx?$/.test(entry)) {
      found.push(relative)
    }
  }
  return found
}

describe('the generated game is typechecked', () => {
  test('every TypeScript file in the template is in the program', async () => {
    const templates = join(root, 'templates')
    const onDisk = await sourcesUnder(templates)
    const checked = programFiles('tsconfig.templates.json')

    expect(onDisk.length).toBeGreaterThan(0)
    const missed = onDisk.filter((relative) => !checked.has(resolve(templates, relative)))
    expect(missed).toEqual([])
  })

  /**
   * The three `__…_LITERAL__` tokens are declared as `string` so an
   * unsubstituted template parses. That declaration is only honest while the
   * declared name is one `scaffold()` actually fills — a token declared here
   * and substituted nowhere would typecheck in the template and reach the
   * developer as a `ReferenceError`, which is the exact failure this issue is
   * about. `scaffold.test.ts` catches it from the other side by refusing any
   * `__…__` in generated output; this catches it at the declaration.
   */
  test('every declared placeholder is one the scaffolder substitutes', async () => {
    const declarations = await Bun.file(join(root, 'types/template-placeholders.d.ts')).text()
    const declared = [...declarations.matchAll(/declare const (__[A-Z0-9_]+__)\b/g)].map((match) => match[1])
    const substituted = await Bun.file(join(root, 'src/scaffold.ts')).text()

    expect(declared.length).toBeGreaterThan(0)
    expect(declared.filter((token) => !substituted.includes(`${token}:`))).toEqual([])
  })
})
