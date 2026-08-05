/**
 * What comes out, and the one property SPEC §11.3 makes a test:
 *
 *   "if deleting the harness from the machine breaks the generated game, it has
 *    become a framework and must be redesigned"
 *
 * So the generated project is read the way a bundler would read it — every
 * import of every file — and nothing may point back here.
 */

import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { projectFrom } from '../src/naming.js'
import { TEMPLATE_ROOT, scaffold, type TextFile } from '../src/scaffold.js'

const project = projectFrom({ name: 'Star Clicker', currency: 'Gold Pieces' })
const files = await scaffold(project, { sdkVersion: '^0.3.0' })

const at = (path: string): TextFile => {
  const file = files.find((candidate) => candidate.path === path)
  if (!file) throw new Error(`${path} was not generated. Generated: ${files.map((f) => f.path).join(', ')}`)
  return file
}

const sources = files.filter((file) => file.path.endsWith('.ts'))
const manifest = JSON.parse(at('package.json').contents) as {
  name: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  scripts: Record<string, string>
}

describe('what it writes', () => {
  test('a runnable project, not a fragment', () => {
    expect(files.map((file) => file.path).sort()).toEqual([
      '.gitignore',
      'README.md',
      'index.html',
      'package.json',
      'server/game.ts',
      'server/main.ts',
      'server/orders.ts',
      'shared/game.ts',
      'src/economy.ts',
      'src/main.ts',
      'src/world.ts',
      'tsconfig.json',
    ])
  })

  test('nothing is empty', () => {
    for (const file of files) expect(file.contents.trim().length).toBeGreaterThan(0)
  })

  /** npm strips a published `.gitignore`, so it ships under another name. */
  test('the ignore file arrives named correctly and covers node_modules', () => {
    expect(at('.gitignore').contents).toContain('node_modules/')
    expect(files.some((file) => file.path === 'gitignore')).toBe(false)
  })
})

describe('the two answers reach every corner', () => {
  test('no placeholder survives', () => {
    for (const file of files) {
      expect(file.contents).not.toMatch(/__[A-Z][A-Z_]*__/)
    }
  })

  test('the project name names the package, the page, and the README', () => {
    expect(manifest.name).toBe('star-clicker')
    expect(at('index.html').contents).toContain('<title>Star Clicker</title>')
    expect(at('README.md').contents).toContain('# Star Clicker')
    expect(at('server/main.ts').contents).toContain('Star Clicker')
  })

  test('the currency and its derived ticker land in the price list', () => {
    const shared = at('shared/game.ts').contents
    expect(shared).toContain('name: "Gold Pieces"')
    expect(shared).toContain('symbol: "GOLD"')
  })

  test('the SDK version it was built alongside is the one it asks for', () => {
    expect(manifest.dependencies['kei-transaction']).toBe('^0.3.0')
  })
})

describe('it is a scaffolder, not a framework (SPEC §11.3)', () => {
  test('nothing generated depends on create-kei-game', () => {
    // The README is allowed to name the tool that wrote it — it says the game
    // survives deleting it, which is this same property in prose. Code and
    // manifests are not allowed to mention it at all.
    const mentions = files
      .filter((file) => !file.path.endsWith('.md'))
      .filter((file) => file.contents.includes('create-kei-game'))
      .map((file) => file.path)

    expect(mentions).toEqual([])
    expect(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })).not.toContain('create-kei-game')
  })

  test('the generated project depends on the SDK and a renderer, and nothing else', () => {
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['@babylonjs/core', 'kei-transaction'])
  })

  test('every import resolves to a declared dependency or a file in the project', () => {
    const declared = new Set([...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)])
    const transpiler = new Bun.Transpiler({ loader: 'ts' })
    const undeclared: string[] = []

    for (const file of sources) {
      for (const imported of transpiler.scanImports(file.contents)) {
        if (imported.path.startsWith('.') || imported.path.startsWith('node:') || imported.path === 'bun') continue
        const [scope = '', name = ''] = imported.path.split('/')
        const packageName = scope.startsWith('@') ? `${scope}/${name}` : scope
        if (!declared.has(packageName)) undeclared.push(`${file.path} → ${imported.path}`)
      }
    }

    expect(undeclared).toEqual([])
  })
})

describe('the generated sources are sources', () => {
  test('every TypeScript file parses', () => {
    const transpiler = new Bun.Transpiler({ loader: 'ts' })
    for (const file of sources) {
      expect(() => transpiler.transformSync(file.contents)).not.toThrow()
    }
  })

  test('it can be run without reading anything else', () => {
    expect(manifest.scripts.dev).toBe('bun run server/main.ts')
    expect(at('README.md').contents).toContain('bun run dev')
  })

  /** SPEC §11.3: the harness picks the renderer and documents how to replace it. */
  test('the README says how to swap the renderer and how to add Colyseus', () => {
    const readme = at('README.md').contents
    expect(readme).toContain('Replace the renderer')
    expect(readme).toContain('Colyseus')
    expect(readme).toMatch(/never be the source of truth|must never own money|Do not let it own money/)
  })
})

describe('the shape of the game itself', () => {
  test('the issuer seed stays on the server', () => {
    expect(at('server/game.ts').contents).toContain('Kei.server(')
    expect(at('src/economy.ts').contents).toContain('Kei.start(')
    expect(at('src/economy.ts').contents).not.toContain('Kei.server(')
  })

  test('it exercises a currency, an item, and a payment', () => {
    const game = at('server/game.ts').contents
    expect(game).toContain('kei.token.issue(')
    expect(game).toContain('kei.items.create(')
    expect(game).toContain('kei.items.mint(')
    expect(game).toContain('.commit(')
    expect(at('src/economy.ts').contents).toContain('kei.pay(')

    // Watching for payments lives in `server/orders.ts` rather than next to the
    // delivery, because what a payment arriving means is "file this hash", and
    // what it is answered with has to be written down before it is answered.
    expect(at('server/orders.ts').contents).toContain('kei.onPayment(')
  })

  test('the renderer knows nothing about Kei', () => {
    const world = at('src/world.ts').contents
    expect(world).not.toContain('kei-transaction')
    expect(world).not.toContain('Kei.start')
  })
})

// ── Answers that would be code somewhere ─────────────────────────────────────
//
// The two answers land in a template literal, a string literal, an HTML
// element, a JSON string and a Markdown heading, and those five disagree about
// what a quote, a backslash and a `<` mean. Each answer below is syntax in at
// least one of them, and one of them — `Miner's Gold` — is what an ordinary
// person types when asked what their currency is called.
//
// The property is the same in every destination: what comes out is the text
// that was typed, as data, and the file it is in is still the kind of file it
// was.

const HOSTILE = [
  '${process.env.GAME_SEED}',
  "Miner's Gold",
  "Gold'; process.exit(1); //",
  'Back`tick',
  'Back\\slash',
  '</title><script>alert(1)</script>',
  'A "quoted" name',
  'A$&B',
] as const

// One project per answer, with the same string given as both — every
// placeholder in the package is fed by one or the other, so this reaches all of
// them.
const hostile = await Promise.all(
  HOSTILE.map(async (answer) => ({
    answer,
    written: await scaffold(projectFrom({ name: answer, currency: answer }), { sdkVersion: '^0.3.0' }),
  })),
)

const temporary: string[] = []

afterAll(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** The inverse of each escape, so the assertion is a round trip rather than the escape restated. */
const unescapeMarkdown = (text: string): string => text.replace(/\\(.)/gs, '$1')

const unescapeHtml = (text: string): string =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')

/** The one template literal in the generated project, and the only place `${` is live. */
const banner = (source: string): string => /console\.log\(`([\s\S]*?)`\)/.exec(source)?.[1] ?? ''

const interpolations = (source: string): string[] => [...source.matchAll(/\$\{[^}]*\}/g)].map(([match]) => match)

describe('an answer is data in every file it reaches', () => {
  test('no placeholder pastes a value in unescaped', async () => {
    const found: string[] = []
    for await (const relative of new Bun.Glob('**/*').scan(TEMPLATE_ROOT)) {
      const contents = await Bun.file(join(TEMPLATE_ROOT, relative)).text()
      found.push(...(contents.match(/__[A-Z][A-Z0-9_]*__/g) ?? []))
    }

    expect(found.length).toBeGreaterThan(0)
    expect(found.filter((token) => !/_(LITERAL|JSON|HTML|MD)__$/.test(token))).toEqual([])
  })

  for (const { answer, written } of hostile) {
    const label = JSON.stringify(answer)
    const file = (path: string): TextFile => {
      const found = written.find((candidate) => candidate.path === path)
      if (!found) throw new Error(`${path} was not generated for ${label}`)
      return found
    }

    test(`${label}: every generated TypeScript file still parses`, () => {
      const transpiler = new Bun.Transpiler({ loader: 'ts' })
      for (const source of written.filter((candidate) => candidate.path.endsWith('.ts'))) {
        expect(() => transpiler.transformSync(source.contents)).not.toThrow()
      }
    })

    test(`${label}: the price list is a module that runs, holding what was typed`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'create-kei-game-'))
      temporary.push(directory)

      // `shared/game.ts` imports nothing, so this is the generated file itself
      // rather than a copy of it with the imports stubbed out.
      const path = join(directory, 'game.ts')
      await writeFile(path, file('shared/game.ts').contents, 'utf8')

      const module = (await import(pathToFileURL(path).href)) as { CURRENCY: { name: string } }
      expect(module.CURRENCY.name).toBe(answer)
    })

    test(`${label}: the dev server banner prints a value rather than running one`, () => {
      const source = file('server/main.ts').contents
      const [, declared = ''] = /\nconst title = (.*)\r?\n/.exec(source) ?? []

      expect(JSON.parse(declared)).toBe(answer)
      expect(interpolations(banner(source))).toEqual(interpolations(banner(at('server/main.ts').contents)))
    })

    test(`${label}: package.json is still JSON, and says the name`, () => {
      const parsed = JSON.parse(file('package.json').contents) as { description: string }
      expect(parsed.description.startsWith(answer)).toBe(true)
    })

    test(`${label}: the page title is text rather than markup`, () => {
      const html = file('index.html').contents
      const [, encoded = ''] = /<title>(.*)<\/title>/.exec(html) ?? []
      expect(unescapeHtml(encoded)).toBe(answer)
      expect(html).not.toContain('<script>alert')
    })

    test(`${label}: the README heading is escaped rather than obeyed`, () => {
      const readme = file('README.md').contents
      const [heading = ''] = readme.split(/\r?\n/)
      expect(unescapeMarkdown(heading)).toBe(`# ${answer}`)
      expect(readme).not.toContain('<script>')
    })
  }
})
