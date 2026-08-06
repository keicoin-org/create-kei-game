/**
 * The dependency range every generated project actually gets, checked from
 * three directions so it cannot drift the way it did for #75, #73 and #68 —
 * a floating `^0.3.0` and a pinned `0.6.0` both reached generated projects
 * because nothing here compared what the CLI emitted to what this package
 * declares for itself, or to what is actually resolvable on npm.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { GENERATED_SDK_VERSION } from '../src/sdk-version.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const harness = join(root, 'src', 'index.ts')
const directory = join(root, '.generated', 'sdk-version')

beforeAll(async () => {
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('the kei-transaction range a generated project gets', () => {
  test('is a caret range naming a real, dotted version', () => {
    // Loose on purpose — this only guards the shape (`^X.Y.Z`), not the
    // number, which is a decision recorded in src/sdk-version.ts and updated
    // by hand against npm, not by a rule a test could encode.
    expect(GENERATED_SDK_VERSION).toMatch(/^\^\d+\.\d+\.\d+$/)
  })

  /**
   * This package's own devDependency is what CI actually installs and what
   * `bun test` actually runs the rest of the suite against — purchase,
   * restart, chain-rescan, earn, all of it. If that ever drifts from
   * `GENERATED_SDK_VERSION`, this suite stops being evidence that the range a
   * generated project gets works, without anything failing loudly. This is
   * the check that makes that loud.
   */
  test('is the version this harness tests itself against', async () => {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
    }
    expect(manifest.devDependencies['kei-transaction']).toBe(GENERATED_SDK_VERSION)
  })

  /**
   * The version actually resolved into `node_modules` right now — what every
   * test in this suite that imports `kei-transaction` is really running
   * against. If `GENERATED_SDK_VERSION` and this ever disagree, the install
   * that the test above says is "coherent" is not the one under test.
   */
  test('is satisfied by what is actually installed', async () => {
    const installed = JSON.parse(
      await readFile(join(root, 'node_modules', 'kei-transaction', 'package.json'), 'utf8'),
    ) as { version: string }
    expect(GENERATED_SDK_VERSION).toBe(`^${installed.version}`)
  })

  /**
   * The real CLI, run unattended end to end — not `scaffold()` handed a
   * version by the test, which only proves the substitution mechanism works.
   * This is the emitted range a developer running `npm create kei-game`
   * today would actually get.
   */
  test('is what the real CLI writes into a generated package.json', async () => {
    const child = Bun.spawn(
      [process.execPath, harness, 'sdk-version-check', '--currency', 'Gems', '--yes', '--force'],
      { cwd: directory, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    )
    const code = await child.exited
    expect(code).toBe(0)

    const manifest = JSON.parse(
      await readFile(join(directory, 'sdk-version-check', 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> }
    expect(manifest.dependencies['kei-transaction']).toBe(GENERATED_SDK_VERSION)
  })
})
