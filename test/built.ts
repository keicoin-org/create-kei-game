/**
 * The two test files that exercise the real binaries need `dist/` to exist.
 * Each used to spawn a whole `bun run build` of its own in `beforeAll`, which
 * cost a second `tsc` for no benefit and failed on the Windows CI runner with
 * `RangeError: Out of memory` — a failure that names no test, because the file
 * dies before it registers one.
 *
 * Build at most once per process, and only when `dist/` is actually behind the
 * sources. In CI it never runs at all: the workflow does `bun run typecheck`
 * before `bun test`, and `tsc --build` has already emitted everything.
 *
 * Awaited at module scope rather than from `beforeAll`: Bun caps a hook at five
 * seconds, so a real build there could only ever report an unnamed hook timeout
 * while the `tsc` it started ran on. The deadline belongs to the bounded process
 * harness, which kills the tree and names the phase.
 */

import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { requireProcessSuccess, runProcess } from './process.js'

const root = fileURLToPath(new URL('..', import.meta.url))

/** Wide enough for a cold `tsc --build`; the harness kills the tree past it. */
const BUILD_TIMEOUT_MS = 180_000

/** Newest mtime under a directory, or 0 when it is not there. */
function newestMtime(directory: string): number {
  let newest = 0
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const target = join(directory, entry.name)
    const mtime = entry.isDirectory() ? newestMtime(target) : statSync(target).mtimeMs
    if (mtime > newest) newest = mtime
  }
  return newest
}

let started: Promise<void> | undefined

async function build(): Promise<void> {
  // `tsc --build` is itself incremental, so this only skips the process spawn —
  // which is the part that was costing the memory.
  if (newestMtime(join(root, 'dist')) > newestMtime(join(root, 'src'))) return

  // Past that point the build has to actually emit, and `tsc --build` will not:
  // its stamp lives beside the config rather than inside `dist`, so a removed
  // `dist` leaves the stamp claiming everything is written and the build is a
  // no-op. The fallback then reports success while every test that spawns a real
  // binary fails against a directory that is not there.
  rmSync(join(root, 'tsconfig.tsbuildinfo'), { force: true })

  // The last synchronous spawn in the suite was this one, and it was the
  // heaviest: a whole `tsc` held inside the test process. Through the bounded
  // async harness the build cannot block the loop, its output cannot grow
  // without limit, and a failure names its phase instead of dying as an
  // unnamed hook.
  requireProcessSuccess('test-build', await runProcess(process.execPath, ['run', 'build'], {
    cwd: root,
    timeoutMs: BUILD_TIMEOUT_MS,
  }))
}

export async function ensureBuilt(): Promise<void> {
  started ??= build()
  await started
}
