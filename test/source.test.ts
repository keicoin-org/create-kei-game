import { describe, expect, test } from 'bun:test'
import { posix, win32 } from 'node:path'

import { HarnessError } from '../src/errors.js'
import {
  KNOWN_TEMPLATES,
  PLAN_JSON_PATH,
  PLAN_MARKDOWN_PATH,
  destinationFor,
  parseRepositoryUrl,
  prepareSource,
  scaffoldWorkspace,
  templateNamed,
  type GitOptions,
  type GitResult,
  type SourceDeps,
  type SourceFs,
} from '../src/source.js'
import { SCAFFOLD_PLAN } from './fixtures.js'

class MemoryFs implements SourceFs {
  readonly entries = new Map<string, readonly string[] | null>()
  readonly stats = new Map<string, { readonly isDirectory: boolean } | null>()
  readonly made: string[] = []
  readonly writes = new Map<string, string>()

  async readdir(directory: string): Promise<readonly string[] | null> {
    return this.entries.get(directory) ?? null
  }

  async stat(target: string): Promise<{ readonly isDirectory: boolean } | null> {
    return this.stats.get(target) ?? null
  }

  async mkdir(directory: string): Promise<void> {
    this.made.push(directory)
  }

  async writeFile(file: string, contents: string): Promise<void> {
    this.writes.set(file, contents)
  }
}

interface GitCall {
  readonly command: 'git'
  readonly args: readonly string[]
  readonly options: GitOptions
}

function harness(result: GitResult = { code: 0, stderr: '' }): {
  readonly deps: SourceDeps
  readonly fs: MemoryFs
  readonly calls: GitCall[]
} {
  const fs = new MemoryFs()
  const calls: GitCall[] = []
  return {
    fs,
    calls,
    deps: {
      fs,
      path: posix,
      git: async (command, args, options) => {
        calls.push({ command, args, options })
        return result
      },
    },
  }
}

const project = { slug: 'my-game', title: 'My Game' }

describe('reference catalog', () => {
  test('is the three real projects and no embedded starter', () => {
    expect(KNOWN_TEMPLATES.map(({ id }) => id)).toEqual(['button', 'world-of-wonder', 'carpet-markets'])
    expect(JSON.stringify(KNOWN_TEMPLATES)).not.toContain('star-clicker')
  })

  test('accepts an id or display label and lists choices on error', () => {
    expect(templateNamed('world-of-wonder').label).toBe('World of Wonder')
    expect(templateNamed('Carpet Markets').id).toBe('carpet-markets')
    expect(() => templateNamed('missing')).toThrow(/Button, World of Wonder, Carpet Markets/)
  })
})

describe('parseRepositoryUrl', () => {
  test('normalizes GitHub and an optional www/.git spelling', () => {
    expect(parseRepositoryUrl('https://www.github.com/keicoin-org/button')).toEqual({
      url: 'https://github.com/keicoin-org/button.git',
      host: 'github.com',
      owner: 'keicoin-org',
      name: 'button',
    })
  })

  test('accepts deeply nested GitLab namespaces', () => {
    expect(parseRepositoryUrl('https://gitlab.com/company/games/teams/kei/my-game.git').url).toBe(
      'https://gitlab.com/company/games/teams/kei/my-game.git',
    )
  })

  test.each([
    'http://github.com/owner/repo',
    'ssh://git@github.com/owner/repo',
    'https://github.example/owner/repo',
    'https://user:secret@github.com/owner/repo',
    'https://github.com/owner/repo?token=nope',
    'https://github.com/owner/repo#readme',
    'https://github.com/owner',
    'https://github.com/owner/repo/extra',
    'https://gitlab.com/group/%2F/repo',
  ])('rejects unsafe or non-repository URL %s', (url) => {
    expect(() => parseRepositoryUrl(url)).toThrow(HarnessError)
  })
})

describe('destinationFor', () => {
  test('uses the project slug under the base deterministically', () => {
    expect(destinationFor({ baseDirectory: '/work', slug: 'my-game' }, posix)).toBe('/work/my-game')
  })

  test('accepts a safe relative or explicit absolute destination', () => {
    expect(destinationFor({ baseDirectory: '/work', slug: 'ignored', destination: 'games/one' }, posix)).toBe(
      '/work/games/one',
    )
    expect(destinationFor({ baseDirectory: '/work', slug: 'ignored', destination: '/srv/one' }, posix)).toBe('/srv/one')
    expect(destinationFor({ baseDirectory: '/work', slug: 'ignored', destination: '..notes' }, posix)).toBe('/work/..notes')
  })

  test('rejects unsafe slug, traversal, and drive-relative destinations', () => {
    expect(() => destinationFor({ baseDirectory: '/work', slug: '../out' }, posix)).toThrow(HarnessError)
    expect(() => destinationFor({ baseDirectory: '/work', slug: 'ok', destination: '../out' }, posix)).toThrow(HarnessError)
    expect(() => destinationFor({ baseDirectory: 'C:\\work', slug: 'ok', destination: 'D:out' }, win32)).toThrow(HarnessError)
  })
})

describe('scaffolded source', () => {
  test('writes the client/server/shared shape and the plan, and spawns nothing', async () => {
    const { deps, fs, calls } = harness()
    const prepared = await prepareSource(
      { project, selection: { kind: 'blank' }, baseDirectory: '/work', plan: SCAFFOLD_PLAN },
      deps,
    )

    expect(prepared).toEqual({
      selection: { kind: 'blank' },
      directory: '/work/my-game',
      created: true,
      written: [
        'package.json',
        'README.md',
        '.gitignore',
        'src/shared/simulation.ts',
        'src/client/main.ts',
        'src/server/main.ts',
        PLAN_JSON_PATH,
        PLAN_MARKDOWN_PATH,
      ],
      remote: null,
    })
    expect(JSON.parse(fs.writes.get('/work/my-game/package.json')!)).toMatchObject({ name: 'my-game', private: true })
    const written = JSON.parse(fs.writes.get(`/work/my-game/${PLAN_JSON_PATH}`)!)
    expect(written.planVersion).toBe(1)
    expect(written.intent.name).toBe(SCAFFOLD_PLAN.intent.name)
    expect(fs.writes.get(`/work/my-game/${PLAN_MARKDOWN_PATH}`)).toContain('## Capability packets')
    expect(calls).toEqual([])
  })

  test('refuses a dirty destination unless force is explicit', async () => {
    const first = harness()
    first.fs.entries.set('/work/my-game', ['notes.txt'])
    await expect(
      prepareSource({ project, selection: { kind: 'blank' }, baseDirectory: '/work', plan: SCAFFOLD_PLAN }, first.deps),
    ).rejects.toThrow(/--force/)
    expect(first.fs.writes.size).toBe(0)

    const forced = harness()
    forced.fs.entries.set('/work/my-game', ['notes.txt'])
    const result = await prepareSource(
      { project, selection: { kind: 'blank' }, baseDirectory: '/work', force: true, plan: SCAFFOLD_PLAN },
      forced.deps,
    )
    expect(result.created).toBe(true)
    expect(forced.fs.entries.get('/work/my-game')).toEqual(['notes.txt'])
    expect(forced.fs.writes.size).toBe(8)
  })

  test('refuses to treat a file as a destination, including under force', async () => {
    const { deps, fs } = harness()
    fs.stats.set('/work/my-game', { isDirectory: false })
    await expect(
      prepareSource({ project, selection: { kind: 'blank' }, baseDirectory: '/work', force: true, plan: SCAFFOLD_PLAN }, deps),
    ).rejects.toThrow(/is a file, not a directory/)
    expect(fs.writes.size).toBe(0)
  })

  test('quotes the title as data rather than injecting it into TypeScript', () => {
    const title = `O'Brien\n*/ console.log('injected')`
    const files = scaffoldWorkspace({ slug: 'safe', title }, SCAFFOLD_PLAN)
    const client = files.find(({ path }) => path === 'src/client/main.ts')!.contents
    expect(client).toContain(`export const TITLE = ${JSON.stringify(title)}`)
    // The escape is the point: the raw newline and comment terminator that would
    // have closed the header comment never reach the file.
    expect(client).not.toContain(`\n*/ console.log`)
  })
})

describe('existing local source', () => {
  test('uses a directory in place without writing or spawning', async () => {
    const { deps, fs, calls } = harness()
    fs.stats.set('/work/already-here', { isDirectory: true })
    const result = await prepareSource(
      { project, selection: { kind: 'existing', path: 'already-here' }, baseDirectory: '/work', plan: SCAFFOLD_PLAN },
      deps,
    )
    expect(result).toMatchObject({ directory: '/work/already-here', created: false, written: [], remote: null })
    expect(fs.writes.size).toBe(0)
    expect(fs.made).toEqual([])
    expect(calls).toEqual([])
  })

  test('refuses a missing path or a file', async () => {
    const missing = harness()
    await expect(
      prepareSource({ project, selection: { kind: 'existing', path: 'nope' }, baseDirectory: '/work', plan: SCAFFOLD_PLAN }, missing.deps),
    ).rejects.toThrow(/nothing/)

    const file = harness()
    file.fs.stats.set('/work/readme.md', { isDirectory: false })
    await expect(
      prepareSource({ project, selection: { kind: 'existing', path: 'readme.md' }, baseDirectory: '/work', plan: SCAFFOLD_PLAN }, file.deps),
    ).rejects.toThrow(/file/)
  })
})

describe('cloned reference', () => {
  test('clones with exact argv and no shell, then leaves the plan beside it', async () => {
    const { deps, fs, calls } = harness()
    const result = await prepareSource(
      { project, selection: { kind: 'template', template: 'button' }, baseDirectory: '/work', plan: SCAFFOLD_PLAN },
      deps,
    )
    expect(result.remote).toBe('https://github.com/keicoin-org/button.git')
    expect(result.written).toEqual([PLAN_JSON_PATH, PLAN_MARKDOWN_PATH])
    expect(fs.writes.has(`/work/my-game/${PLAN_JSON_PATH}`)).toBeTrue()
    expect(calls).toEqual([
      {
        command: 'git',
        args: ['clone', '--depth', '1', '--', 'https://github.com/keicoin-org/button.git', '/work/my-game'],
        options: { cwd: '/work', shell: false },
      },
    ])
  })

  test('creates a nested destination parent, not the clone destination', async () => {
    const { deps, fs, calls } = harness()
    await prepareSource(
      {
        project,
        selection: { kind: 'template', template: 'button' },
        baseDirectory: '/work',
        destination: 'games/one',
        plan: SCAFFOLD_PLAN,
      },
      deps,
    )

    // The parent, and afterwards only the plan directory inside the clone.
    expect(fs.made[0]).toBe('/work/games')
    expect(fs.made).not.toContain('/work/games/one')
    expect(calls[0]).toEqual({
      command: 'git',
      args: ['clone', '--depth', '1', '--', 'https://github.com/keicoin-org/button.git', '/work/games/one'],
      options: { cwd: '/work', shell: false },
    })
  })

  test('normalizes a repository URL before cloning', async () => {
    const { deps, calls } = harness()
    await prepareSource(
      {
        project,
        selection: { kind: 'repository', url: 'https://gitlab.com/group/team/game' },
        baseDirectory: '/work',
        plan: SCAFFOLD_PLAN,
      },
      deps,
    )
    expect(calls[0]!.args).toContain('https://gitlab.com/group/team/game.git')
  })

  test('never merges or deletes a nonempty clone destination, even with force', async () => {
    const { deps, fs, calls } = harness()
    fs.entries.set('/work/my-game', ['keep.txt'])
    await expect(
      prepareSource(
        { project, selection: { kind: 'template', template: 'button' }, baseDirectory: '/work', force: true, plan: SCAFFOLD_PLAN },
        deps,
      ),
    ).rejects.toThrow(/will empty it/)
    expect(calls).toEqual([])
    expect(fs.entries.get('/work/my-game')).toEqual(['keep.txt'])
  })

  test('does not spawn git when the clone destination is a file', async () => {
    const { deps, fs, calls } = harness()
    fs.stats.set('/work/my-game', { isDirectory: false })
    await expect(
      prepareSource({ project, selection: { kind: 'template', template: 'button' }, baseDirectory: '/work', plan: SCAFFOLD_PLAN }, deps),
    ).rejects.toThrow(/is a file, not a directory/)
    expect(calls).toEqual([])
  })

  test('reports an unavailable git and a nonzero clone without claiming success', async () => {
    const unavailable = harness({ code: null, stderr: '' })
    await expect(
      prepareSource({ project, selection: { kind: 'template', template: 'button' }, baseDirectory: '/work', plan: SCAFFOLD_PLAN }, unavailable.deps),
    ).rejects.toThrow(/Could not run git/)

    const failed = harness({ code: 128, stderr: 'repository not found' })
    await expect(
      prepareSource({ project, selection: { kind: 'template', template: 'button' }, baseDirectory: '/work', plan: SCAFFOLD_PLAN }, failed.deps),
    ).rejects.toThrow(/exit 128.*repository not found/s)
  })
})
