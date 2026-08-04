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
 */

import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

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

let done = false

export function ensureBuilt(): void {
  if (done) return
  done = true

  // `tsc --build` is itself incremental, so this only skips the process spawn —
  // which is the part that was costing the memory.
  if (newestMtime(join(root, 'dist')) > newestMtime(join(root, 'src'))) return

  const built = spawnSync(process.execPath, ['run', 'build'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (built.error) throw built.error
  if (built.status !== 0) throw new Error(`Test build failed: ${built.stderr}`)
}
