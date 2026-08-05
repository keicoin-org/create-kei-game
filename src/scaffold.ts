/**
 * Templates in, files out. No disk is touched here.
 *
 * `scaffold()` returns what *would* be written, which is what makes the emitted
 * project testable: `test/scaffold.test.ts` reads every generated file, parses
 * the TypeScript ones, and checks that none of them import this package —
 * SPEC §11.3's test for whether the harness has quietly become a framework.
 *
 * The templates are ordinary files rather than strings in a module, so that
 * editing the generated game is editing a game, and a diff against
 * `examples/button` still reads as a diff.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, posix, sep } from 'node:path'

import { htmlText, jsonText, literal, markdownText } from './escape.js'
import type { GameProject } from './naming.js'

export interface GeneratedFile {
  /** Relative, POSIX-separated, and where it goes under the project directory. */
  path: string
  /**
   * Text for anything this package writes itself. Bytes only arrive from a
   * downloaded template (`templates.ts`), which carries models, sounds, and
   * textures that are not text and must not be round-tripped through a string.
   */
  contents: string | Uint8Array
}

/**
 * What the templates in this package produce, which is always text — the
 * narrower type is worth keeping so that everything reading a locally
 * scaffolded project gets a `string` without having to ask.
 */
export interface TextFile extends GeneratedFile {
  contents: string
}

export interface ScaffoldOptions {
  /** The `kei-transaction` range written into the generated `package.json`. */
  sdkVersion: string
  /** Overridable so tests can read templates from somewhere else. */
  templates?: string
}

/**
 * Resolves to `packages/create-kei-game/templates` from both `src/` and `dist/`,
 * which are the same depth. `files` in `package.json` ships it.
 */
export const TEMPLATE_ROOT = fileURLToPath(new URL('../templates/', import.meta.url))

/**
 * npm deletes a file called `.gitignore` from a published package and always
 * has, so it is shipped under a name npm will leave alone and renamed on the
 * way out. A generated project whose `node_modules` is not ignored is a bad
 * first commit.
 */
const RENAME_ON_WRITE: Readonly<Record<string, string>> = { gitignore: '.gitignore' }

export async function scaffold(project: GameProject, options: ScaffoldOptions): Promise<TextFile[]> {
  const root = options.templates ?? TEMPLATE_ROOT
  // Named for where each one goes, because that is what decides how it is
  // written. There is deliberately no `__PROJECT_TITLE__`: a template that wants
  // the title has to say which kind of file it is putting it in.
  const substitutions: Readonly<Record<string, string>> = {
    __PROJECT_TITLE_LITERAL__: literal(project.title),
    __PROJECT_TITLE_JSON__: jsonText(project.title),
    __PROJECT_TITLE_HTML__: htmlText(project.title),
    __PROJECT_TITLE_MD__: markdownText(project.title),
    __PROJECT_SLUG_JSON__: jsonText(project.slug),
    __CURRENCY_NAME_LITERAL__: literal(project.currency),
    __CURRENCY_NAME_MD__: markdownText(project.currency),
    __CURRENCY_SYMBOL_LITERAL__: literal(project.symbol),
    __CURRENCY_SYMBOL_MD__: markdownText(project.symbol),
    __SDK_VERSION_JSON__: jsonText(options.sdkVersion),
  }

  const files: TextFile[] = []
  for (const relative of (await listFiles(root)).sort()) {
    const contents = await readFile(join(root, relative.split(posix.sep).join(sep)), 'utf8')
    files.push({ path: rename(relative), contents: substitute(contents, substitutions) })
  }
  return files
}

/**
 * Every placeholder, everywhere. Unreplaced ones are a test failure, not a
 * warning — which is also what catches a template asking for a hole that no
 * longer has a name.
 *
 * `split`/`join` rather than `replace`, because `replace` reads its second
 * argument as a replacement pattern and would expand `$&` in somebody's
 * currency.
 */
function substitute(contents: string, substitutions: Readonly<Record<string, string>>): string {
  let result = contents
  for (const [token, value] of Object.entries(substitutions)) {
    result = result.split(token).join(value)
  }
  return result
}

function rename(relative: string): string {
  const slash = relative.lastIndexOf(posix.sep)
  const directory = slash === -1 ? '' : relative.slice(0, slash + 1)
  const name = relative.slice(slash + 1)
  return `${directory}${RENAME_ON_WRITE[name] ?? name}`
}

/** Hand-rolled rather than `readdir({ recursive: true })`, whose result shape moved between Node 20 releases. */
async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(join(root, prefix.split(posix.sep).join(sep)))) {
    const relative = prefix === '' ? entry : `${prefix}${posix.sep}${entry}`
    const info = await stat(join(root, relative.split(posix.sep).join(sep)))
    if (info.isDirectory()) found.push(...(await listFiles(root, relative)))
    else found.push(relative)
  }
  return found
}
