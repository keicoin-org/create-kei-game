/**
 * The three things the model may actually do: look at the workspace, read a
 * file in it, write a file in it. Nothing else, and nothing outside it.
 *
 * Containment is checked against real paths rather than spelling. A path is
 * rejected before it is used if it is absolute or contains `..`, and it is
 * rejected again afterwards if the deepest part of it that exists resolves —
 * through however many symlinks — to somewhere outside the workspace. The
 * second check is the one that matters, because the first can be satisfied by a
 * link that was already there.
 *
 * A refusal is a *result*, not an exception. The model reads `{ ok: false }`,
 * learns what it did wrong, and corrects itself on the next round; a thrown
 * error would end the turn instead. `tool_error` stays reserved for a genuine
 * fault in this file or the disk under it.
 */

import type { EngineTool, ToolDefinition } from './runtime.js'

export const MAX_READ_BYTES = 32 * 1024
export const MAX_WRITE_BYTES = 64 * 1024
export const MAX_LIST_ENTRIES = 400
export const MAX_LIST_DEPTH = 8
export const MAX_PATH_SEGMENTS = 32
/** Directories that are somebody else's bookkeeping, not the game's source. */
export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
])

export interface ToolDirent {
  readonly name: string
  readonly isDirectory: boolean
  readonly isSymbolicLink: boolean
}

export interface ToolFs {
  /** `null` when the directory is not there. Entries do not follow links. */
  readdir(directory: string): Promise<readonly ToolDirent[] | null>
  /** `null` when nothing is at that path. */
  stat(target: string): Promise<{ readonly isDirectory: boolean; readonly size: number } | null>
  /** `null` when nothing is at that path; otherwise fully resolved. */
  realpath(target: string): Promise<string | null>
  readFile(file: string): Promise<string | null>
  writeFile(file: string, contents: string): Promise<void>
  mkdir(directory: string): Promise<void>
}

export interface ToolPath {
  resolve(...segments: string[]): string
  join(...segments: string[]): string
  dirname(target: string): string
  basename(target: string): string
  relative(from: string, to: string): string
  isAbsolute(target: string): boolean
  readonly sep: string
}

export interface WorkspaceToolOptions {
  readonly workspace: string
  readonly fs: ToolFs
  readonly path: ToolPath
  /**
   * The credential values that must never land in a project file, read fresh at
   * each write so nothing here holds key material between calls.
   */
  readonly secrets?: () => readonly string[]
}

export interface WorkspaceTools {
  readonly tools: readonly EngineTool[]
  /** Workspace-relative POSIX paths this session wrote, in order, deduplicated. */
  readonly written: readonly string[]
}

type Result = Record<string, unknown>

interface ResolvedTarget {
  readonly relative: string
  readonly absolute: string
}

function refused(error: string): Result {
  return { ok: false, error }
}

function isRefusal(value: ResolvedTarget | Result): value is Result {
  return (value as Result).ok === false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requestedPath(value: unknown, field: string): string | Result {
  if (typeof value !== 'string' || value.trim() === '') {
    return refused(`"${field}" must be a nonempty workspace-relative path.`)
  }
  const raw = value.trim().replace(/\\/g, '/')
  if (raw.includes('\0')) return refused(`"${field}" contains a character that is not allowed in a path.`)
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    return refused(`"${field}" must be relative to the workspace, not absolute.`)
  }
  const segments = raw.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.some((segment) => segment === '..')) {
    return refused(`"${field}" must stay inside the workspace, so it cannot contain "..".`)
  }
  if (segments.length > MAX_PATH_SEGMENTS) return refused(`"${field}" is nested too deeply.`)
  return segments.join('/')
}

function within(path: ToolPath, root: string, target: string): boolean {
  const relative = path.relative(root, target)
  if (relative === '') return true
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

/**
 * The absolute path to use, or `null` when it resolves outside the workspace.
 * Walks up to the deepest ancestor that exists, resolves *that* through its
 * links, and checks containment there — which covers a file that does not exist
 * yet under a directory that is a link to somewhere else.
 */
async function containedPath(
  options: WorkspaceToolOptions,
  workspaceReal: string,
  relativePath: string,
): Promise<string | null> {
  const { fs, path } = options
  const absolute = relativePath === '' ? workspaceReal : path.resolve(workspaceReal, ...relativePath.split('/'))
  const tail: string[] = []
  let current = absolute
  for (let step = 0; step <= MAX_PATH_SEGMENTS + 1; step += 1) {
    const real = await fs.realpath(current)
    if (real !== null) {
      if (!within(path, workspaceReal, real)) return null
      return tail.length === 0 ? real : path.join(real, ...tail.reverse())
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    tail.push(path.basename(current))
    current = parent
  }
  return null
}

const LIST_SCHEMA: ToolDefinition['inputSchema'] = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Workspace-relative directory. Defaults to the workspace root.',
    },
  },
  additionalProperties: false,
}

const READ_SCHEMA: ToolDefinition['inputSchema'] = {
  type: 'object',
  properties: { path: { type: 'string', description: 'Workspace-relative file path.' } },
  required: ['path'],
  additionalProperties: false,
}

const WRITE_SCHEMA: ToolDefinition['inputSchema'] = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Workspace-relative file path. Parent directories are created.' },
    content: { type: 'string', description: 'The complete new contents of the file.' },
  },
  required: ['path', 'content'],
  additionalProperties: false,
}

export function createWorkspaceTools(options: WorkspaceToolOptions): WorkspaceTools {
  const { fs, path } = options
  const written: string[] = []
  let workspaceReal: string | undefined

  const root = async (): Promise<string | Result> => {
    if (workspaceReal !== undefined) return workspaceReal
    const real = await fs.realpath(options.workspace)
    if (real === null) return refused('The project workspace no longer exists.')
    workspaceReal = real
    return real
  }

  /** Shared preamble: validate the argument object, then contain the path. */
  const target = async (
    argumentsValue: unknown,
    field: 'path',
    fallback?: string,
  ): Promise<ResolvedTarget | Result> => {
    if (!isRecord(argumentsValue)) return refused('Tool arguments must be a JSON object.')
    const raw = argumentsValue[field] === undefined && fallback !== undefined ? fallback : argumentsValue[field]
    const relative = requestedPath(raw, field)
    if (typeof relative !== 'string') return relative
    const workspace = await root()
    if (typeof workspace !== 'string') return workspace
    const absolute = await containedPath(options, workspace, relative)
    if (absolute === null) {
      return refused(`"${field}" resolves outside the project workspace, so it cannot be used.`)
    }
    return { relative, absolute }
  }

  const list: EngineTool = {
    definition: {
      name: 'list_files',
      description:
        'List the files and directories inside the project workspace. Build, dependency, and version-control directories are omitted.',
      inputSchema: LIST_SCHEMA,
    },
    async execute(argumentsValue, context) {
      const resolved = await target(argumentsValue, 'path', '.')
      if (isRefusal(resolved)) return resolved
      const info = await fs.stat(resolved.absolute)
      if (info === null) return refused(`Nothing exists at "${resolved.relative || '.'}".`)
      if (!info.isDirectory) return refused(`"${resolved.relative}" is a file, not a directory.`)

      const entries: Array<{ path: string; type: 'file' | 'directory'; bytes?: number }> = []
      let truncated = false
      const walk = async (absolute: string, relative: string, depth: number): Promise<void> => {
        if (truncated || context.signal.aborted) return
        const children = await fs.readdir(absolute)
        if (children === null) return
        for (const child of [...children].sort((left, right) => left.name.localeCompare(right.name))) {
          if (truncated || context.signal.aborted) return
          if (entries.length >= MAX_LIST_ENTRIES) { truncated = true; return }
          // A link is named but never followed: descending one is how a listing
          // walks out of the workspace it was asked about.
          if (child.isSymbolicLink) continue
          const childRelative = relative === '' ? child.name : `${relative}/${child.name}`
          const childAbsolute = path.join(absolute, child.name)
          if (child.isDirectory) {
            if (SKIPPED_DIRECTORIES.has(child.name)) continue
            entries.push({ path: `${childRelative}/`, type: 'directory' })
            if (depth + 1 < MAX_LIST_DEPTH) await walk(childAbsolute, childRelative, depth + 1)
            continue
          }
          const stat = await fs.stat(childAbsolute)
          entries.push({ path: childRelative, type: 'file', bytes: stat?.size ?? 0 })
        }
      }
      await walk(resolved.absolute, resolved.relative, 0)
      return { ok: true, path: resolved.relative || '.', entries, truncated }
    },
  }

  const read: EngineTool = {
    definition: {
      name: 'read_file',
      description: 'Read one UTF-8 text file from the project workspace.',
      inputSchema: READ_SCHEMA,
    },
    async execute(argumentsValue) {
      const resolved = await target(argumentsValue, 'path')
      if (isRefusal(resolved)) return resolved
      const info = await fs.stat(resolved.absolute)
      if (info === null) return refused(`Nothing exists at "${resolved.relative}".`)
      if (info.isDirectory) return refused(`"${resolved.relative}" is a directory. Use list_files for it.`)
      if (info.size > MAX_READ_BYTES) {
        return refused(`"${resolved.relative}" is ${info.size} bytes, over the ${MAX_READ_BYTES}-byte read limit.`)
      }
      const content = await fs.readFile(resolved.absolute)
      if (content === null) return refused(`"${resolved.relative}" could not be read as UTF-8 text.`)
      return { ok: true, path: resolved.relative, bytes: new TextEncoder().encode(content).byteLength, content }
    },
  }

  const write: EngineTool = {
    definition: {
      name: 'write_file',
      description:
        'Write one UTF-8 text file in the project workspace, creating parent directories. Sending the whole file replaces it.',
      inputSchema: WRITE_SCHEMA,
    },
    async execute(argumentsValue) {
      if (!isRecord(argumentsValue)) return refused('Tool arguments must be a JSON object.')
      const content = argumentsValue.content
      if (typeof content !== 'string') return refused('"content" must be the complete file text.')
      const bytes = new TextEncoder().encode(content).byteLength
      if (bytes > MAX_WRITE_BYTES) {
        return refused(`"content" is ${bytes} bytes, over the ${MAX_WRITE_BYTES}-byte write limit. Split the file.`)
      }
      const resolved = await target(argumentsValue, 'path')
      if (isRefusal(resolved)) return resolved

      // At every depth, not only the first segment. `list_files` already skips
      // these wherever it meets them, and the `.env` refusal below matches on
      // basename, so checking one segment here was the odd one out — a nested
      // `.git/hooks/pre-commit` is code that runs on the developer's next commit.
      const managed = resolved.relative.split('/').find((segment) => SKIPPED_DIRECTORIES.has(segment))
      if (managed !== undefined) {
        return refused(`"${managed}/" is managed outside the project source and cannot be written.`)
      }
      // SPEC §11.3: nothing the developer will one day commit may carry a
      // credential, and `.env` is the file a model reaches for to put one in.
      if (path.basename(resolved.relative) === '.env') {
        return refused('The harness keeps credentials in its own environment, so it does not write .env files.')
      }
      for (const secret of options.secrets?.() ?? []) {
        if (secret !== '' && content.includes(secret)) {
          return refused('That content contains a harness credential, which must never enter the project.')
        }
      }

      const existing = await fs.stat(resolved.absolute)
      if (existing?.isDirectory) return refused(`"${resolved.relative}" is a directory, not a file.`)
      const parent = path.dirname(resolved.absolute)
      if (parent !== resolved.absolute) await fs.mkdir(parent)
      await fs.writeFile(resolved.absolute, content)
      if (!written.includes(resolved.relative)) written.push(resolved.relative)
      return { ok: true, path: resolved.relative, bytes, created: existing === null }
    },
  }

  return { tools: Object.freeze([list, read, write]), written }
}
