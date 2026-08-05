/**
 * The real filesystem, the real path rules, the real `git`.
 *
 * `src/source.ts` takes all three as arguments and never imports Node. This is
 * the file that closes that seam for the actual program, and it is the only
 * place in the package that touches a disk or starts a process.
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { GitOptions, GitResult, GitRunner, SourceFs, SourcePath } from './source.js'
import type { ToolFs, ToolPath } from './tools.js'

/** "Not there" is an answer, not a failure. Anything else is a real failure. */
const ABSENT = new Set(['ENOENT', 'ENOTDIR'])

function absent(error: unknown): boolean {
  return typeof (error as { code?: unknown }).code === 'string' && ABSENT.has((error as { code: string }).code)
}

function identityPart(info: Awaited<ReturnType<typeof lstat>>): string {
  // ctime changes when Windows renames the validated entry to its private
  // backup name. Device/inode bind the object; size+mtime bind its contents.
  return [info.dev, info.ino, info.mode, info.nlink, info.size, info.mtimeMs].join(':')
}

function directoryIdentityPart(info: Awaited<ReturnType<typeof lstat>>): string {
  // Child entry creation/removal legitimately changes directory timestamps and
  // sometimes size; device/inode/mode bind the directory object itself.
  return [info.dev, info.ino, info.mode].join(':')
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right)
}

async function regularIdentity(directory: string, path: string): Promise<string | null> {
  const root = resolve(directory)
  const target = resolve(root, path)
  // Adoption declarations are top-level today. Keeping this check in the real
  // adapter means a future bad declaration cannot turn policy validation into
  // a path traversal, even if the policy layer is accidentally weakened.
  if (!samePath(dirname(target), root)) return null

  try {
    const [rootInfo, targetInfo, realRoot, realTarget] = await Promise.all([
      lstat(root),
      lstat(target),
      realpath(root),
      realpath(target),
    ])
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return null
    if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) return null
    if (!samePath(dirname(realTarget), realRoot)) return null
    return `${realRoot}\n${directoryIdentityPart(rootInfo)}\n${identityPart(targetInfo)}`
  } catch {
    return null
  }
}

export const nodeFs: SourceFs = {
  async readdir(directory) {
    try {
      return await readdir(directory)
    } catch (error) {
      // A permission error is not "the directory is empty", and treating it as
      // one would have this write into somewhere it cannot read.
      if (absent(error)) return null
      throw error
    }
  },

  async stat(target) {
    try {
      const info = await stat(target)
      return { isDirectory: info.isDirectory() }
    } catch (error) {
      if (absent(error)) return null
      throw error
    }
  },

  async mkdir(directory) {
    await mkdir(directory, { recursive: true })
  },

  async readIdentityFile(directory, path, maxBytes) {
    const root = resolve(directory)
    const file = resolve(root, path)
    if (!samePath(dirname(file), root)) return { kind: 'unsafe' }
    const before = await regularIdentity(root, path)
    if (before === null) {
      try { await lstat(file) } catch (error) { if (absent(error)) return { kind: 'missing' } }
      return { kind: 'unsafe' }
    }

    let handle
    try {
      // O_NOFOLLOW is authoritative on POSIX. Windows rejects some numeric
      // flag combinations, so lstat/realpath plus handle identity below is the
      // no-reparse check there.
      const flags = process.platform === 'win32'
        ? constants.O_RDONLY
        : constants.O_RDONLY | constants.O_NOFOLLOW
      handle = await open(file, flags)
    } catch (error) {
      if (absent(error)) return { kind: 'missing' }
      return { kind: 'unsafe' }
    }
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || !before.endsWith(identityPart(opened))) return { kind: 'unsafe' }
      const bytes = Buffer.alloc(maxBytes + 1)
      let offset = 0
      while (offset < bytes.byteLength) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
        if (bytesRead === 0) break
        offset += bytesRead
      }
      if (offset > maxBytes) return { kind: 'too_large' }
      const after = await regularIdentity(root, path)
      if (after !== before) return { kind: 'unsafe' }
      try {
        return {
          kind: 'text',
          contents: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset)),
          identity: Object.freeze({ token: before }),
        }
      } catch {
        return { kind: 'invalid_utf8' }
      }
    } finally {
      await handle.close()
    }
  },

  async replaceIdentityFiles(directory, files) {
    const root = resolve(directory)
    const paths = files.map(({ path }) => path)
    if (new Set(paths).size !== paths.length) return false
    const entries = files.map((file) => ({
      ...file,
      target: resolve(root, file.path),
      temporary: join(root, `.kei-adopt-${process.pid}-${randomUUID()}.tmp`),
      backup: join(root, `.kei-adopt-${process.pid}-${randomUUID()}.old`),
      staged: false,
      backedUp: false,
      installed: false,
      mode: 0o600,
    }))
    for (const entry of entries) {
      if (!samePath(dirname(entry.target), root)) return false
      if (await regularIdentity(root, entry.path) !== entry.identity.token) return false
      entry.mode = (await lstat(entry.target)).mode & 0o777
    }

    let committed = false
    try {
      for (const entry of entries) {
        const handle = await open(entry.temporary, 'wx', entry.mode)
        entry.staged = true
        try {
          await handle.writeFile(entry.contents, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
      }

      // Validate the complete set before moving even one original. Then retain
      // every original under a private sibling name until every replacement is
      // installed, so a second-file failure can restore the first exactly.
      for (const entry of entries) {
        if (await regularIdentity(root, entry.path) !== entry.identity.token) return false
      }
      for (const entry of entries) {
        await rename(entry.target, entry.backup)
        entry.backedUp = true
        if (await regularIdentity(root, basename(entry.backup)) !== entry.identity.token) {
          throw new Error('identity entry changed while it was being retained')
        }
      }
      for (const entry of entries) {
        await rename(entry.temporary, entry.target)
        entry.staged = false
        entry.installed = true
      }
      committed = true

      // Cleanup is not part of commit: if an OS refuses to remove a private
      // backup, keep the original safely rather than reporting false after the
      // requested identities already landed or deleting ambiguous state.
      for (const entry of entries) {
        try {
          await unlink(entry.backup)
          entry.backedUp = false
        } catch { /* preserved private backup */ }
      }
      return true
    } catch {
      let restored = true
      for (const entry of [...entries].reverse()) {
        if (entry.installed) {
          try { await unlink(entry.target) } catch { restored = false }
          entry.installed = false
        }
        if (entry.backedUp) {
          try {
            await rename(entry.backup, entry.target)
            entry.backedUp = false
          } catch { restored = false }
        }
      }
      if (!restored) throw new Error('The cloned reference identity transaction could not be restored safely.')
      return false
    } finally {
      for (const entry of entries) {
        if (entry.staged) await unlink(entry.temporary).catch(() => {})
        // On a committed transaction a failed backup cleanup is intentionally
        // preserved. On a failed transaction, preserve any backup that could
        // not be restored; deleting it would destroy the last original copy.
        if (!committed && entry.backedUp) continue
      }
    }
  },

  async writeFile(file, contents) {
    await writeFile(file, contents, 'utf8')
  },
}

export const nodePath: SourcePath = { resolve, join, dirname, relative, isAbsolute, sep }

/**
 * The same disk again, with the three extra operations the workspace tools need
 * and `prepareSource` does not: reading a file back, resolving links, and
 * telling a link apart from what it points at.
 */
export const nodeToolFs: ToolFs = {
  async readdir(directory) {
    try {
      const entries = await readdir(directory, { withFileTypes: true })
      // withFileTypes does not follow links, so a link to a directory reports as
      // a link here rather than as the directory it aims at.
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isSymbolicLink: entry.isSymbolicLink(),
      }))
    } catch (error) {
      if (absent(error)) return null
      throw error
    }
  },

  async stat(target) {
    try {
      const info = await stat(target)
      return { isDirectory: info.isDirectory(), size: info.size }
    } catch (error) {
      if (absent(error)) return null
      throw error
    }
  },

  async realpath(target) {
    try {
      return await realpath(target)
    } catch (error) {
      if (absent(error)) return null
      throw error
    }
  },

  async readFile(file) {
    let bytes: Buffer
    try {
      bytes = await readFile(file)
    } catch (error) {
      if (absent(error)) return null
      throw error
    }
    try {
      // A binary file is not something the model can edit, and decoding it
      // loosely would put replacement characters into the transcript instead.
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return null
    }
  },

  async writeFile(file, contents) {
    await writeFile(file, contents, 'utf8')
  },

  async mkdir(directory) {
    await mkdir(directory, { recursive: true })
  },
}

export const nodeToolPath: ToolPath = { resolve, join, dirname, basename, relative, isAbsolute, sep }

/** More than anything git says on the way to failing, and short of a memory leak. */
const MAX_STDERR = 64 * 1024

/**
 * `spawn` with an argv array and `shell: false`, which is the whole point: a URL
 * that came out of a prompt is an argument here and can never be a command. The
 * two ways this can end — the process ran, or it never started — are the two
 * shapes of `GitResult`, and both resolve rather than reject so that the caller
 * writes the message instead of a stack.
 */
export function runCommand(command: string, args: readonly string[], options: GitOptions): Promise<GitResult> {
  return new Promise((settle) => {
    let done = false
    const finish = (result: GitResult): void => {
      if (done) return
      done = true
      settle(result)
    }

    let child
    try {
      child = spawn(command, [...args], {
        cwd: options.cwd,
        shell: false,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      // Some spawn failures are thrown rather than emitted, depending on what
      // was wrong with the arguments.
      finish({ code: null, stderr: error instanceof Error ? error.message : String(error) })
      return
    }

    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < MAX_STDERR) stderr += chunk
    })
    // A pipe can break after the process is gone; that is not an error worth
    // crashing an otherwise finished clone over.
    child.stderr?.on('error', () => {})

    child.on('error', (error: Error) => finish({ code: null, stderr: error.message }))
    child.on('close', (code) => finish({ code: code ?? null, stderr: stderr.slice(0, MAX_STDERR) }))
  })
}

export const nodeGit: GitRunner = (command, args, options) => runCommand(command, args, options)
