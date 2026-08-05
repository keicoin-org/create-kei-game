/**
 * Which format a failure is printed in, decided by the parser.
 *
 * `--json` is the machine contract (SPEC §12), so the question "was JSON asked
 * for?" has exactly one right answer and `src/cli.ts` is the only thing that
 * knows it. This drives the real binary rather than `parseArgs`, because the
 * bug being pinned was in the top-level catch: the parser said one thing and
 * the catch, scanning `argv` for the string itself, said another.
 *
 * Nothing here is allowed to scaffold. Every invocation fails, and each runs in
 * its own empty directory so that a run which did write something is visible.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const harness = join(import.meta.dir, '..', 'src', 'index.ts')
const directory = join(import.meta.dir, '..', '.generated', 'failure-format')

interface Run {
  code: number
  stdout: string
  /** What the run left behind. Empty, for every invocation in this file. */
  wrote: string[]
}

/** The harness, run the way a caller runs it: as a program, with an exit code. */
async function run(...args: string[]): Promise<Run> {
  const child = Bun.spawn([process.execPath, harness, ...args], {
    cwd: directory,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = await new Response(child.stdout).text()
  const code = await child.exited
  return { code, stdout, wrote: await readdir(directory) }
}

beforeEach(async () => {
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('the format a failure is reported in', () => {
  test('--json --nope reports as JSON: the flag was read before the failure', async () => {
    const { code, stdout, wrote } = await run('--json', '--nope')

    expect(code).toBe(1)
    expect(JSON.parse(stdout)).toEqual({
      status: 'error',
      code: 'flag_unknown',
      stage: 'arguments',
      step: 'read-flag',
      retryable: false,
      remediation: expect.any(String),
      message: expect.stringContaining('"--nope" is not an option this understands'),
    })
    expect(wrote).toEqual([])
  })

  test('--currency --json reports as text: the parser took --json as a value and refused it', async () => {
    // The decision this pins: `--json` in a position `parseArgs` rejects has not
    // asked for anything, so it does not select the machine format. Before the
    // fix the catch scanned `argv` for the string and printed JSON here — the
    // one reachable case where the two disagreed.
    const { code, stdout, wrote } = await run('--currency', '--json')

    expect(code).toBe(1)
    expect(stdout).toContain('--currency needs a name after it')
    expect(() => JSON.parse(stdout)).toThrow()
    expect(wrote).toEqual([])
  })

  test('--nope alone reports as text', async () => {
    const { code, stdout, wrote } = await run('--nope')

    expect(code).toBe(1)
    expect(stdout).toContain('is not an option this understands')
    expect(() => JSON.parse(stdout)).toThrow()
    expect(wrote).toEqual([])
  })

  test('--currency=--json is a currency literally called --json, and its failure is text', async () => {
    const { code, stdout, wrote } = await run('my-game', '--currency=--json', '--yes')

    expect(code).toBe(1)
    // The currency was accepted as written and rejected downstream for its
    // ticker, which is the proof it was never read as the flag.
    expect(stdout).toContain('A currency called "--json"')
    expect(() => JSON.parse(stdout)).toThrow()
    expect(wrote).toEqual([])
  })

  test('a failure after a successful parse still honours --json', async () => {
    const { code, stdout, wrote } = await run('my-game', '--currency=!!!', '--json', '--yes')

    expect(code).toBe(1)
    expect(JSON.parse(stdout).message).toContain('A currency called "!!!"')
    expect(wrote).toEqual([])
  })

  test('the flag is spelled in one place, so renaming it cannot half-happen', async () => {
    const source = await readFile(join(import.meta.dir, '..', 'src', 'index.ts'), 'utf8')
    expect(source).not.toContain("'--json'")
    expect(source).not.toContain('"--json"')
  })
})
