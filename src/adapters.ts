/**
 * The real filesystem, the real path rules, the real `git`.
 *
 * `src/source.ts` takes all three as arguments and never imports Node. This is
 * the file that closes that seam for the actual program, and it is the only
 * place in the package that touches a disk or starts a process.
 */

import { spawn } from 'node:child_process'
import { mkdir, open, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { GitOptions, GitResult, GitRunner, SourceFs, SourcePath } from './source.js'
import type { ToolFs, ToolPath } from './tools.js'

/** "Not there" is an answer, not a failure. Anything else is a real failure. */
const ABSENT = new Set(['ENOENT', 'ENOTDIR'])

function absent(error: unknown): boolean {
  return typeof (error as { code?: unknown }).code === 'string' && ABSENT.has((error as { code: string }).code)
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

  async readTextFile(file, maxBytes) {
    let handle
    try {
      handle = await open(file, 'r')
    } catch (error) {
      if (absent(error)) return { kind: 'missing' }
      throw error
    }
    try {
      const bytes = Buffer.alloc(maxBytes + 1)
      let offset = 0
      while (offset < bytes.byteLength) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
        if (bytesRead === 0) break
        offset += bytesRead
      }
      if (offset > maxBytes) return { kind: 'too_large' }
      try {
        return { kind: 'text', contents: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset)) }
      } catch {
        return { kind: 'invalid_utf8' }
      }
    } finally {
      await handle.close()
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
