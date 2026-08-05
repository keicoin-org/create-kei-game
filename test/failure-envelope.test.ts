/**
 * What a failed run says to a program, as opposed to a person.
 *
 * `failure-format.test.ts` next door pins *which* format a failure comes out in.
 * This pins what is inside the machine one. The two questions an unattended
 * caller has are what kind of failure this was and whether running the same
 * command again is worth a run, and until now the envelope answered neither: it
 * carried `code: 'harness_error'` and `stage: 'execution'` on every failure
 * there is, which is a constant wearing the clothes of a field.
 *
 * So these drive the real binary and assert on the fields rather than on the
 * prose. The messages are allowed to be reworded — that is what `message` is
 * for — and a rewording that changes a `code` is the regression.
 *
 * Nothing here is allowed to scaffold or to reach the network. Every invocation
 * fails before either, and each runs in its own empty directory so that a run
 * which did write something is visible.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const harness = join(import.meta.dir, '..', 'src', 'index.ts')
const directory = join(import.meta.dir, '..', '.generated', 'failure-envelope')

interface Envelope {
  status: string
  code: string
  stage: string
  step: string
  retryable: boolean
  remediation: string
  message: string
}

interface Run {
  code: number
  envelope: Envelope
  stderr: string
  /** What the run left behind. */
  wrote: string[]
}

/** The harness, run as a program, answering in the machine format. */
async function run(...args: string[]): Promise<Run> {
  const child = Bun.spawn([process.execPath, harness, '--json', ...args], {
    cwd: directory,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderrText] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  const code = await child.exited
  return { code, envelope: JSON.parse(stdout) as Envelope, stderr: stderrText, wrote: await readdir(directory) }
}

beforeEach(async () => {
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('the failure envelope', () => {
  test('names the failure and the step it stopped at, not just that there was one', async () => {
    const { code, envelope, wrote } = await run('--nope')

    expect(code).toBe(1)
    expect(envelope.status).toBe('error')
    expect(envelope.code).toBe('flag_unknown')
    expect(envelope.stage).toBe('arguments')
    expect(envelope.step).toBe('read-flag')
    expect(wrote).toEqual([])
  })

  test('an unusable answer is a different code from an unusable flag', async () => {
    // The distinction the old constant could not make: both are exit 1 and both
    // are the caller's fault, and only one of them is about the command line.
    const { envelope } = await run('my-game', '--currency=!!!', '--yes')

    expect(envelope.code).toBe('currency_unusable')
    expect(envelope.stage).toBe('answers')
    expect(envelope.step).toBe('derive-symbol')
    expect(envelope.message).toContain('!!!')
  })

  test('a directory in the way is its own code, and names the flag that overrides it', async () => {
    await mkdir(join(directory, 'my-game'), { recursive: true })
    await writeFile(join(directory, 'my-game', 'notes.txt'), 'mine\n')

    const { envelope, code } = await run('my-game', '--yes')

    expect(code).toBe(1)
    expect(envelope.code).toBe('target_not_empty')
    expect(envelope.stage).toBe('target')
    expect(envelope.step).toBe('check-target-directory')
    expect(envelope.remediation).toContain('--force')
  })

  test('an unknown template stops at the template stage, before anything is fetched', async () => {
    const { envelope, wrote } = await run('my-game', '--template', 'mmo', '--yes')

    expect(envelope.code).toBe('template_unknown')
    expect(envelope.stage).toBe('template')
    expect(envelope.step).toBe('resolve-template')
    expect(wrote).toEqual([])
  })

  test('nothing reachable from the command line is retryable', async () => {
    // The field earns its place by being false here. Only the download of a
    // template that lives in another repository is ever marked true, and a
    // caller that retries everything learns nothing from a flag that is always
    // set.
    for (const args of [['--nope'], ['my-game', '--currency=!!!', '--yes'], ['my-game', '--template', 'mmo', '--yes']]) {
      const { envelope } = await run(...args)
      expect(envelope.retryable).toBe(false)
    }
  })

  test('every field is present and populated, because a consumer reads them positionally', async () => {
    const { envelope } = await run('--nope')

    expect(Object.keys(envelope).sort()).toEqual(
      ['code', 'message', 'remediation', 'retryable', 'stage', 'status', 'step'].sort(),
    )
    for (const field of ['code', 'stage', 'step', 'remediation', 'message'] as const) {
      expect(envelope[field].length).toBeGreaterThan(0)
    }
  })

  test('remediation is a sentence of its own, not the message again', async () => {
    const { envelope } = await run('--nope')

    expect(envelope.remediation).not.toBe(envelope.message)
    expect(envelope.remediation).toMatch(/\.$/)
  })
})

describe('a failure that is this package s own bug', () => {
  /**
   * A crash rather than a refusal, from a state nothing here has a message for:
   * the project's directory name is taken by a *file*. `assertWritable` reads
   * that as "nothing there yet" — `readdir` of a file fails the same way a
   * missing directory does — and the `mkdir` underneath `writeFiles` is then the
   * one that finds out, with an errno rather than a sentence.
   *
   * This is the path that used to put a stack on stdout and hand a caller
   * expecting JSON something it could not parse.
   */
  async function crash(): Promise<Run> {
    await writeFile(join(directory, 'my-game'), 'not a directory\n')
    return run('my-game', '--yes')
  }

  test('is still an envelope, and still says which kind it is', async () => {
    const { code, envelope } = await crash()

    expect(code).toBe(1)
    expect(envelope.code).toBe('internal_error')
    expect(envelope.stage).toBe('internal')
    expect(envelope.step).toBe('unhandled')
    expect(envelope.retryable).toBe(false)
  })

  test('and what the runtime said still goes to stderr, where it was already fine', async () => {
    // Backwards compatibility runs the other way here: stdout under `--json` was
    // never allowed to be a stack, and stderr is not the contract — so the
    // detail is moved rather than dropped. The envelope carries the summary and
    // stderr carries whatever the runtime raised, stack included when there is
    // one (an errno from an async syscall often has no frames worth printing).
    const { stderr, envelope } = await crash()

    expect(stderr.trim()).not.toBe('')
    expect(stderr).toContain(envelope.message)
  })
})
