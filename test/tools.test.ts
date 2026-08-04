import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { posix } from 'node:path'

import { nodeToolFs, nodeToolPath } from '../src/adapters.js'
import {
  createWorkspaceTools,
  MAX_LIST_ENTRIES,
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
  type ToolDirent,
  type ToolFs,
  type ToolPath,
} from '../src/tools.js'
import type { EngineTool } from '../src/runtime.js'

const secret = 'sk-tool-secret-never-written'
const context = { workspace: '/workspace/game', signal: new AbortController().signal }

/**
 * A disk in memory, with real symlink semantics, so containment is tested the
 * same way on every platform and without needing the privilege to make a link.
 */
class FakeFs implements ToolFs {
  readonly files = new Map<string, string>()
  readonly directories = new Set<string>(['/'])
  readonly links = new Map<string, string>()
  readonly unreadable = new Set<string>()

  directory(path: string): this {
    let current = ''
    for (const segment of path.split('/').filter(Boolean)) {
      current += `/${segment}`
      this.directories.add(current)
    }
    return this
  }

  file(path: string, contents: string): this {
    this.directory(posix.dirname(path))
    this.files.set(path, contents)
    return this
  }

  link(path: string, target: string): this {
    this.directory(posix.dirname(path))
    this.links.set(path, target)
    return this
  }

  #resolve(path: string): string | null {
    let real = ''
    for (const segment of path.split('/').filter(Boolean)) {
      const candidate = `${real}/${segment}`
      const target = this.links.get(candidate)
      real = target ?? candidate
    }
    const resolved = real === '' ? '/' : real
    return this.directories.has(resolved) || this.files.has(resolved) ? resolved : null
  }

  async realpath(target: string): Promise<string | null> {
    return this.#resolve(target)
  }

  async stat(target: string): Promise<{ isDirectory: boolean; size: number } | null> {
    const real = this.#resolve(target)
    if (real === null) return null
    if (this.directories.has(real)) return { isDirectory: true, size: 0 }
    return { isDirectory: false, size: new TextEncoder().encode(this.files.get(real) ?? '').byteLength }
  }

  async readdir(directory: string): Promise<readonly ToolDirent[] | null> {
    const real = this.#resolve(directory)
    if (real === null || !this.directories.has(real)) return null
    const prefix = real === '/' ? '/' : `${real}/`
    const names = new Map<string, ToolDirent>()
    const add = (path: string, isDirectory: boolean, isSymbolicLink: boolean): void => {
      if (!path.startsWith(prefix) || path === real) return
      const rest = path.slice(prefix.length)
      if (rest.includes('/')) {
        const name = rest.split('/')[0]!
        if (!names.has(name)) names.set(name, { name, isDirectory: true, isSymbolicLink: false })
        return
      }
      names.set(rest, { name: rest, isDirectory, isSymbolicLink })
    }
    for (const path of this.directories) add(path, true, false)
    for (const path of this.files.keys()) add(path, false, false)
    for (const path of this.links.keys()) add(path, false, true)
    return [...names.values()]
  }

  async readFile(file: string): Promise<string | null> {
    const real = this.#resolve(file)
    if (real === null || this.unreadable.has(real)) return null
    return this.files.get(real) ?? null
  }

  async writeFile(file: string, contents: string): Promise<void> {
    this.files.set(file, contents)
  }

  async mkdir(directory: string): Promise<void> {
    this.directory(directory)
  }
}

const fakePath: ToolPath = {
  resolve: posix.resolve,
  join: posix.join,
  dirname: posix.dirname,
  basename: posix.basename,
  relative: posix.relative,
  isAbsolute: posix.isAbsolute,
  sep: posix.sep,
}

function harness(fs: FakeFs, secrets: readonly string[] = [secret]) {
  const workspace = createWorkspaceTools({
    workspace: '/workspace/game',
    fs,
    path: fakePath,
    secrets: () => secrets,
  })
  const named = (name: string): EngineTool => {
    const tool = workspace.tools.find((candidate) => candidate.definition.name === name)
    if (!tool) throw new Error(`missing tool ${name}`)
    return tool
  }
  return {
    workspace,
    list: (args: unknown) => named('list_files').execute(args, context),
    read: (args: unknown) => named('read_file').execute(args, context),
    write: (args: unknown) => named('write_file').execute(args, context),
  }
}

function populated(): FakeFs {
  return new FakeFs()
    .directory('/workspace/game')
    .file('/workspace/game/package.json', '{"name":"game"}')
    .file('/workspace/game/src/main.ts', 'export function start() {}')
    .file('/workspace/game/node_modules/left-pad/index.js', 'module.exports = 1')
    .file('/workspace/game/.git/config', '[core]')
    .file('/outside/private.txt', secret)
}

describe('the tool surface itself', () => {
  test('is exactly three tools with closed schemas', () => {
    const { workspace } = harness(populated())
    expect(workspace.tools.map((tool) => tool.definition.name)).toEqual(['list_files', 'read_file', 'write_file'])
    for (const tool of workspace.tools) {
      expect(tool.definition.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
      expect(tool.definition.description.length).toBeGreaterThan(0)
    }
  })
})

describe('list_files', () => {
  test('walks the workspace and omits dependency and version-control directories', async () => {
    const result = await harness(populated()).list({}) as { ok: boolean; entries: Array<{ path: string }> }
    const paths = result.entries.map((entry) => entry.path)
    expect(result.ok).toBeTrue()
    expect(paths).toContain('package.json')
    expect(paths).toContain('src/')
    expect(paths).toContain('src/main.ts')
    expect(paths.some((path) => path.startsWith('node_modules'))).toBeFalse()
    expect(paths.some((path) => path.startsWith('.git'))).toBeFalse()
  })

  test('reports file sizes and does not follow a symlink out of the workspace', async () => {
    const fs = populated().link('/workspace/game/escape', '/outside')
    const result = await harness(fs).list({}) as {
      entries: Array<{ path: string; type: string; bytes?: number }>
    }
    expect(result.entries.some((entry) => entry.path.startsWith('escape'))).toBeFalse()
    expect(result.entries.find((entry) => entry.path === 'package.json')?.bytes).toBe(15)
  })

  test('stops at the entry cap and says so instead of truncating silently', async () => {
    const fs = populated()
    for (let index = 0; index < MAX_LIST_ENTRIES + 50; index += 1) {
      fs.file(`/workspace/game/many/file-${index}.ts`, 'x')
    }
    const result = await harness(fs).list({}) as { entries: unknown[]; truncated: boolean }
    expect(result.truncated).toBeTrue()
    expect(result.entries.length).toBeLessThanOrEqual(MAX_LIST_ENTRIES)
  })

  test('refuses a directory that is a file, or is not there', async () => {
    const tools = harness(populated())
    expect(await tools.list({ path: 'package.json' })).toMatchObject({ ok: false })
    expect(await tools.list({ path: 'nowhere' })).toMatchObject({ ok: false })
  })
})

describe('read_file', () => {
  test('returns the text and its byte count', async () => {
    expect(await harness(populated()).read({ path: 'src/main.ts' })).toEqual({
      ok: true,
      path: 'src/main.ts',
      bytes: 26,
      content: 'export function start() {}',
    })
  })

  test('refuses a directory, a missing file, and a file over the read cap', async () => {
    const fs = populated().file('/workspace/game/huge.txt', 'x'.repeat(MAX_READ_BYTES + 1))
    const tools = harness(fs)
    expect(await tools.read({ path: 'src' })).toMatchObject({ ok: false })
    expect(await tools.read({ path: 'missing.ts' })).toMatchObject({ ok: false })
    expect(await tools.read({ path: 'huge.txt' })).toMatchObject({ ok: false })
  })

  test('refuses a file that is not UTF-8 text rather than returning replacements', async () => {
    const fs = populated()
    fs.unreadable.add('/workspace/game/sprite.png')
    fs.file('/workspace/game/sprite.png', 'binary')
    expect(await harness(fs).read({ path: 'sprite.png' })).toMatchObject({ ok: false })
  })
})

describe('containment', () => {
  const escapes = [
    '../private.txt',
    'src/../../private.txt',
    '/outside/private.txt',
    'C:\\outside\\private.txt',
    '..\\private.txt',
    'src/./../../outside/private.txt',
  ]

  test('refuses every spelling of leaving the workspace, on read and on write', async () => {
    const tools = harness(populated())
    for (const path of escapes) {
      expect(await tools.read({ path })).toMatchObject({ ok: false })
      expect(await tools.write({ path, content: 'x' })).toMatchObject({ ok: false })
    }
    expect(await tools.read({ path: 'private\0.txt' })).toMatchObject({ ok: false })
  })

  test('refuses a path that only escapes once its symlinks are resolved', async () => {
    const fs = populated().link('/workspace/game/escape', '/outside')
    const tools = harness(fs)
    // Spelled entirely inside the workspace; the link is what leaves it.
    expect(await tools.read({ path: 'escape/private.txt' })).toMatchObject({ ok: false })
    expect(await tools.write({ path: 'escape/planted.txt', content: 'x' })).toMatchObject({ ok: false })
    expect(fs.files.has('/outside/planted.txt')).toBeFalse()
  })

  test('refuses a missing or non-object argument rather than guessing', async () => {
    const tools = harness(populated())
    for (const args of [undefined, null, 'src/main.ts', [], {}, { path: '' }, { path: 42 }]) {
      expect(await tools.read(args)).toMatchObject({ ok: false })
    }
  })
})

describe('write_file', () => {
  test('creates a file, records it, and reports whether it existed', async () => {
    const fs = populated()
    const tools = harness(fs)
    expect(await tools.write({ path: 'src/door.ts', content: 'export const door = true' })).toEqual({
      ok: true, path: 'src/door.ts', bytes: 24, created: true,
    })
    expect(fs.files.get('/workspace/game/src/door.ts')).toBe('export const door = true')
    expect(await tools.write({ path: 'src/door.ts', content: 'export const door = false' })).toMatchObject({
      created: false,
    })
    expect(tools.workspace.written).toEqual(['src/door.ts'])
  })

  test('refuses content carrying a harness credential', async () => {
    const fs = populated()
    const tools = harness(fs)
    const result = await tools.write({ path: 'src/config.ts', content: `export const key = '${secret}'` })
    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(fs.files.has('/workspace/game/src/config.ts')).toBeFalse()
    expect(tools.workspace.written).toEqual([])
  })

  test('refuses a .env file, which is where a credential would go', async () => {
    const fs = populated()
    expect(await harness(fs).write({ path: '.env', content: 'API_KEY=x' })).toMatchObject({ ok: false })
    expect(await harness(fs).write({ path: 'config/.env', content: 'API_KEY=x' })).toMatchObject({ ok: false })
    expect(fs.files.has('/workspace/game/.env')).toBeFalse()
    // The example file carries no value and is the thing a project should commit.
    expect(await harness(fs).write({ path: '.env.example', content: 'API_KEY=' })).toMatchObject({ ok: true })
  })

  test('refuses to write into version-control or dependency directories', async () => {
    const fs = populated()
    for (const path of ['.git/config', 'node_modules/left-pad/index.js', 'dist/main.js']) {
      expect(await harness(fs).write({ path, content: 'x' })).toMatchObject({ ok: false })
    }
    expect(fs.files.get('/workspace/game/.git/config')).toBe('[core]')
  })

  test('refuses them at any depth, not only at the workspace root', async () => {
    const fs = populated()
    // A nested repository is ordinary in a monorepo or a cloned template, and a
    // hook written into one runs on the developer's machine at their next commit.
    for (const path of [
      'packages/engine/.git/hooks/pre-commit',
      'packages/engine/node_modules/left-pad/index.js',
      'apps/web/dist/main.js',
    ]) {
      expect(await harness(fs).write({ path, content: 'x' })).toMatchObject({ ok: false })
      expect(fs.files.has(`/workspace/game/${path}`)).toBeFalse()
    }
  })

  test('refuses content over the write cap and a non-string content', async () => {
    const tools = harness(populated())
    expect(await tools.write({ path: 'big.ts', content: 'x'.repeat(MAX_WRITE_BYTES + 1) })).toMatchObject({ ok: false })
    expect(await tools.write({ path: 'a.ts', content: 42 })).toMatchObject({ ok: false })
    expect(await tools.write({ path: 'a.ts' })).toMatchObject({ ok: false })
  })

  test('refuses to overwrite a directory with a file', async () => {
    expect(await harness(populated()).write({ path: 'src', content: 'x' })).toMatchObject({ ok: false })
  })
})

describe('against the real filesystem adapter', () => {
  const roots: string[] = []
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  })

  test('reads, writes, and lists a real directory through nodeToolFs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kei-mmo-tools-'))
    roots.push(root)
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'main.ts'), 'export const start = 1\n', 'utf8')
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'node_modules', 'ignored.js'), 'x', 'utf8')

    const workspace = createWorkspaceTools({ workspace: root, fs: nodeToolFs, path: nodeToolPath })
    const tools = Object.fromEntries(workspace.tools.map((tool) => [tool.definition.name, tool]))
    const signal = new AbortController().signal

    expect(await tools.read_file!.execute({ path: 'src/main.ts' }, { workspace: root, signal })).toMatchObject({
      ok: true, content: 'export const start = 1\n',
    })
    expect(await tools.write_file!.execute(
      { path: 'src/nested/deep.ts', content: 'export const deep = 2\n' },
      { workspace: root, signal },
    )).toMatchObject({ ok: true, created: true })

    const listed = await tools.list_files!.execute({}, { workspace: root, signal }) as {
      entries: Array<{ path: string }>
    }
    const paths = listed.entries.map((entry) => entry.path)
    expect(paths).toContain('src/nested/deep.ts')
    expect(paths.some((path) => path.startsWith('node_modules'))).toBeFalse()
    expect(workspace.written).toEqual(['src/nested/deep.ts'])
  })

  test('refuses to escape a real workspace with ..', async () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kei-mmo-tools-'))
    roots.push(root)
    writeFileSync(join(root, 'inside.txt'), 'ok', 'utf8')
    const workspace = createWorkspaceTools({ workspace: root, fs: nodeToolFs, path: nodeToolPath })
    const read = workspace.tools.find((tool) => tool.definition.name === 'read_file')!
    expect(await read.execute({ path: '../../../etc/hosts' }, { workspace: root, signal: new AbortController().signal }))
      .toMatchObject({ ok: false })
  })
})
