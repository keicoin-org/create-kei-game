/**
 * The production seams, against a real disk and a real subprocess — but never a
 * network and never a clone. The subprocess is this runtime running a script
 * this test wrote, which is enough to prove the two things that matter: what
 * arrives in argv is exactly what was passed, and both ways a process can end
 * come back as a value rather than a rejection.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execPath } from 'node:process'
import { join } from 'node:path'

import { nodeFs, nodePath, nodeGit, runCommand } from '../src/adapters.js'
import { HarnessError } from '../src/errors.js'
import {
  PLAN_JSON_PATH,
  PLAN_MARKDOWN_PATH,
  prepareSource,
  type GitOptions,
  type SourceDeps,
} from '../src/source.js'
import { SCAFFOLD_PLAN } from './fixtures.js'

let root: string
/** Prints its own argv to stderr and exits 3. Stands in for a git that failed. */
let echo: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'create-kei-mmo-'))
  echo = join(root, 'echo-argv.mjs')
  await writeFile(
    echo,
    'process.stderr.write(JSON.stringify({argv: process.argv.slice(2), cwd: process.cwd()}));process.exit(3)\n',
    'utf8',
  )
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('nodeFs', () => {
  test('readdir lists a directory and answers null for one that is not there', async () => {
    const directory = join(root, 'listed')
    await nodeFs.mkdir(directory)
    await nodeFs.writeFile(join(directory, 'a.txt'), 'a')

    expect(await nodeFs.readdir(directory)).toEqual(['a.txt'])
    expect(await nodeFs.readdir(join(root, 'never-made'))).toBeNull()
  })

  test('readdir answers null rather than throwing when the path is a file', async () => {
    const file = join(root, 'not-a-directory')
    await nodeFs.writeFile(file, 'x')
    expect(await nodeFs.readdir(file)).toBeNull()
  })

  test('stat distinguishes a directory, a file, and nothing at all', async () => {
    const directory = join(root, 'stat-me')
    await nodeFs.mkdir(directory)
    const file = join(directory, 'f.txt')
    await nodeFs.writeFile(file, 'f')

    expect(await nodeFs.stat(directory)).toEqual({ isDirectory: true })
    expect(await nodeFs.stat(file)).toEqual({ isDirectory: false })
    expect(await nodeFs.stat(join(directory, 'absent'))).toBeNull()
    expect(await nodeFs.stat(join(file, 'under-a-file'))).toBeNull()
  })

  test('mkdir is recursive and does not mind existing', async () => {
    const deep = join(root, 'a', 'b', 'c')
    await nodeFs.mkdir(deep)
    await nodeFs.mkdir(deep)
    expect(await nodeFs.stat(deep)).toEqual({ isDirectory: true })
  })

  test('writeFile writes utf8 and overwrites', async () => {
    const file = join(root, 'written.txt')
    await nodeFs.writeFile(file, 'first — ok')
    await nodeFs.writeFile(file, 'second — ok')
    expect(await readFile(file, 'utf8')).toBe('second — ok')
  })
})

describe('nodePath', () => {
  test('is the real path module, joined at the seam', () => {
    expect(nodePath.isAbsolute(nodePath.resolve('x'))).toBe(true)
    expect(nodePath.relative(nodePath.resolve('a'), nodePath.resolve('a', 'b'))).toBe('b')
    expect(nodePath.dirname(nodePath.join('a', 'b'))).toBe('a')
    expect(nodePath.sep.length).toBe(1)
  })
})

describe('runCommand', () => {
  const options: GitOptions = { cwd: '', shell: false }

  test('resolves the exit code and the captured stderr', async () => {
    const result = await runCommand(execPath, [echo, 'clone', '--depth', '1'], { ...options, cwd: root })

    expect(result.code).toBe(3)
    expect(JSON.parse(result.stderr).argv).toEqual(['clone', '--depth', '1'])
  })

  test('runs in the cwd it was given', async () => {
    const cwd = join(root, 'elsewhere')
    await nodeFs.mkdir(cwd)
    const result = await runCommand(execPath, [echo], { ...options, cwd })

    expect(JSON.parse(result.stderr).cwd.toLowerCase()).toContain('elsewhere')
  })

  test('never forms a shell command: metacharacters arrive as one literal argument', async () => {
    const nasty = 'https://github.com/a/b.git; rm -rf / & echo $HOME `whoami` | cat'
    const result = await runCommand(execPath, [echo, nasty], { ...options, cwd: root })

    expect(JSON.parse(result.stderr).argv).toEqual([nasty])
  })

  test('a command that cannot be spawned resolves with a null code, not a rejection', async () => {
    const result = await runCommand(join(root, 'no-such-binary-at-all'), ['clone'], { ...options, cwd: root })

    expect(result.code).toBeNull()
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  test('resolves exactly once, and zero is a code like any other', async () => {
    const zero = join(root, 'zero.mjs')
    await writeFile(zero, 'process.stderr.write("nothing wrong\\n")\n', 'utf8')
    const result = await runCommand(execPath, [zero], { ...options, cwd: root })

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('nothing wrong\n')
  })
})

describe('the whole seam, wired up', () => {
  test('a blank workspace is written to a real disk through the real adapters', async () => {
    const base = join(root, 'real-blank')
    const deps: SourceDeps = { fs: nodeFs, path: nodePath, git: nodeGit }

    const prepared = await prepareSource(
      { project: { slug: 'my-game', title: 'My Game' }, selection: { kind: 'blank' }, baseDirectory: base, plan: SCAFFOLD_PLAN },
      deps,
    )

    expect(prepared.directory).toBe(join(base, 'my-game'))
    expect([...prepared.written].sort()).toEqual([
      '.gitignore',
      'README.md',
      PLAN_MARKDOWN_PATH,
      PLAN_JSON_PATH,
      'kei-mmo/content/check.mjs',
      'kei-mmo/content/manifest.json',
      'kei-mmo/content/pipelines.json',
      'package.json',
      'tsconfig.json',
      'static/index.html',
      'scripts/build.mjs',
      'src/client/connection.ts',
      'src/client/headless.ts',
      'src/client/main.ts',
      'src/economy/definitions.ts',
      'src/economy/player-trade.ts',
      'src/economy/provision.ts',
      'src/client/restart-proof.ts',
      'src/server/persistence.ts',
      'src/server/main.ts',
      'src/server/dev-server.mjs',
      'src/shared/simulation.ts',
      'src/shared/protocol.ts',
      'test/economy.test.ts',
    ].sort())
    expect(JSON.parse(await readFile(join(prepared.directory, 'package.json'), 'utf8')).name).toBe('my-game')
    // Nested, so this proves the recursive mkdir rather than assuming it.
    expect(await readFile(join(prepared.directory, 'src', 'client', 'main.ts'), 'utf8')).toContain('My Game')
    expect(
      JSON.parse(await readFile(join(prepared.directory, ...PLAN_JSON_PATH.split('/')), 'utf8')).planVersion,
    ).toBe(2)
  })

  test('a directory with files in it stops a blank workspace, and --force writes in', async () => {
    const base = join(root, 'occupied')
    const deps: SourceDeps = { fs: nodeFs, path: nodePath, git: nodeGit }
    const request = {
      project: { slug: 'taken', title: 'Taken' },
      selection: { kind: 'blank' as const },
      baseDirectory: base,
      plan: SCAFFOLD_PLAN,
    }

    await nodeFs.mkdir(join(base, 'taken'))
    await nodeFs.writeFile(join(base, 'taken', 'mine.txt'), 'mine')

    await expect(prepareSource(request, deps)).rejects.toThrow(HarnessError)
    const forced = await prepareSource({ ...request, force: true }, deps)
    expect(forced.created).toBe(true)
    expect(await readFile(join(base, 'taken', 'mine.txt'), 'utf8')).toBe('mine')
  })

  test('a failing clone becomes a sentence, with git’s own stderr in it', async () => {
    const base = join(root, 'clone-failure')
    await nodeFs.mkdir(base)
    // The runner under test, pointed at a script instead of git: nothing is
    // fetched, and the failure path is the real one.
    const deps: SourceDeps = {
      fs: nodeFs,
      path: nodePath,
      git: (_command, args, gitOptions) => runCommand(execPath, [echo, ...args], gitOptions),
    }

    const failed = prepareSource(
      {
        project: { slug: 'nope', title: 'Nope' },
        selection: { kind: 'repository', url: 'https://github.com/keicoin-org/button.git' },
        baseDirectory: base,
        plan: SCAFFOLD_PLAN,
      },
      deps,
    )

    await expect(failed).rejects.toThrow(HarnessError)
    await expect(failed).rejects.toThrow(/exit 3/)
  })

  test('a git that will not spawn says so instead of blaming the repository', async () => {
    const base = join(root, 'no-git')
    await nodeFs.mkdir(base)
    const missing = join(root, 'no-such-git')
    const deps: SourceDeps = {
      fs: nodeFs,
      path: nodePath,
      git: (_command, args, gitOptions) => runCommand(missing, args, gitOptions),
    }

    const failed = prepareSource(
      {
        project: { slug: 'nope', title: 'Nope' },
        selection: { kind: 'template', template: 'button' },
        baseDirectory: base,
        plan: SCAFFOLD_PLAN,
      },
      deps,
    )

    await expect(failed).rejects.toThrow(/Could not run git/)
  })
})
