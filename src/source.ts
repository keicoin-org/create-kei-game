/**
 * Where the project comes from on disk, and what "prepare it" means.
 *
 * Nobody chooses between these any more. The planner decides whether the
 * project starts from a reference or from a scaffold, and this file carries the
 * decision out: make the directory, write the workspace, or clone the reference
 * the planner named — and in every case leave the plan itself in the project,
 * so the first thing in there is a written account of what is about to be built.
 *
 * The filesystem, the path rules, and the ability to run `git` all arrive as
 * arguments. That is not ceremony: it is what lets the tests check the exact
 * argv this hands to git, and check the refusals, without a network, a
 * temporary directory, or git installed at all.
 */

import { fail } from './errors.js'
import {
  PLAN_DIRECTORY,
  PLAN_JSON_PATH,
  PLAN_MARKDOWN_PATH,
  planJson,
  renderPlanMarkdown,
  type ImplementationPlan,
} from './plan.js'
import { REFERENCE_PROJECTS, type ReferenceProject } from './references.js'
import { projectFiles } from './scaffold.js'

export { PLAN_DIRECTORY, PLAN_JSON_PATH, PLAN_MARKDOWN_PATH }

// ── The data model ───────────────────────────────────────────────────────────

/**
 * All this step needs of a project: a directory name and something to put at the
 * top of a README.
 */
export interface ProjectIdentity {
  readonly slug: string
  readonly title: string
}

/**
 * The reference catalog, under the name the source layer has always used for
 * it. It is the planner's input now, not a menu.
 */
export const KNOWN_TEMPLATES: readonly ReferenceProject[] = REFERENCE_PROJECTS

/** Accepts the id and the human label, because both end up stored somewhere. */
export function templateNamed(name: string): ReferenceProject {
  const wanted = name.trim().toLowerCase()
  const found = KNOWN_TEMPLATES.find(
    (template) => template.id === wanted || template.label.toLowerCase() === wanted,
  )
  if (found) return found

  const known = KNOWN_TEMPLATES.map((template) => template.label).join(', ')
  fail(`There is no reference project called "${name}". The ones there are: ${known}.`)
}

export type SourceSelection =
  /** A scaffolded workspace: the MMO shape, the plan, and nothing borrowed. */
  | { readonly kind: 'blank' }
  /** A reference project the planner chose, cloned from its own repository. */
  | { readonly kind: 'template'; readonly template: string }
  /** A project already on this disk. Used where it lies. */
  | { readonly kind: 'existing'; readonly path: string }
  /** A GitHub or GitLab repository, over HTTPS. */
  | { readonly kind: 'repository'; readonly url: string }

export interface PreparedSource {
  readonly selection: SourceSelection
  /** Absolute, and where the game is from here on. */
  readonly directory: string
  /**
   * Whether this call put the contents there. False for an existing project,
   * which is the case where the directory was somebody else's already.
   */
  readonly created: boolean
  /** Relative POSIX paths written by this call. Empty for an existing project. */
  readonly written: readonly string[]
  /** What was cloned, when something was. */
  readonly remote: string | null
}

// ── The seams ────────────────────────────────────────────────────────────────

export interface SourceFs {
  /** The entries, or `null` when the directory is not there. */
  readdir(directory: string): Promise<readonly string[] | null>
  /** `null` when nothing is at that path. */
  stat(target: string): Promise<{ readonly isDirectory: boolean } | null>
  /** Recursive, and not an error when it already exists. */
  mkdir(directory: string): Promise<void>
  /**
   * A bounded, no-follow UTF-8 read of a regular file directly below `directory`.
   * The returned identity binds a later replacement to this exact directory
   * entry; implementations must reject links, reparse points, non-files, and
   * targets that resolve outside the directory.
   */
  readIdentityFile(directory: string, path: string, maxBytes: number): Promise<SourceTextRead>
  /**
   * Transactionally replaces the named directory entries only when every one
   * is still the regular file observed by `readIdentityFile`. It must never
   * follow an existing final entry while writing, and a false result must leave
   * every observed file unmodified.
   */
  replaceIdentityFiles(
    directory: string,
    files: readonly {
      readonly path: string
      readonly contents: string
      readonly identity: SourceFileIdentity
    }[],
  ): Promise<boolean>
  writeFile(file: string, contents: string): Promise<void>
}

export interface SourceFileIdentity {
  /** Adapter-owned and intentionally opaque to the source policy layer. */
  readonly token: string
}

export type SourceTextRead =
  | { readonly kind: 'text'; readonly contents: string; readonly identity: SourceFileIdentity }
  | { readonly kind: 'missing' | 'too_large' | 'invalid_utf8' | 'unsafe' }

export interface SourcePath {
  resolve(...segments: string[]): string
  join(...segments: string[]): string
  dirname(target: string): string
  relative(from: string, to: string): string
  isAbsolute(target: string): boolean
  readonly sep: string
}

export interface GitResult {
  /** `null` when git never ran — not installed, or not executable. */
  readonly code: number | null
  readonly stderr: string
}

/**
 * An argv array, always. There is no command string anywhere in this file and
 * no shell to interpret one, which is the only reason a URL out of a prompt is
 * safe to hand to a subprocess.
 */
export interface GitOptions {
  readonly cwd: string
  readonly shell: false
}

export type GitRunner = (
  command: 'git',
  args: readonly string[],
  options: GitOptions,
) => Promise<GitResult>

export interface SourceDeps {
  readonly fs: SourceFs
  readonly path: SourcePath
  readonly git: GitRunner
}

// ── Repository URLs ──────────────────────────────────────────────────────────

const ALLOWED_HOSTS = ['github.com', 'gitlab.com'] as const

export type RepositoryHost = (typeof ALLOWED_HOSTS)[number]

export interface RepositoryUrl {
  /** Normalised: `https://host/owner/name.git`, and what git is given. */
  readonly url: string
  readonly host: RepositoryHost
  readonly owner: string
  /** The last path segment, without `.git`. */
  readonly name: string
}

/** One path segment of a repository URL. No `..`, no separators, no surprises. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function parseRepositoryUrl(input: string): RepositoryUrl {
  const raw = input.trim()

  if (raw.length > 2048) fail('That repository URL is too long to be a repository address. Check what you pasted.')

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    fail(`"${input}" is not a URL. Give the whole thing, like https://github.com/keicoin-org/button.git.`)
  }

  if (parsed.protocol !== 'https:') {
    fail(`Only https:// repositories are cloned, and "${input}" is ${parsed.protocol}//. SSH and git:// are not accepted.`)
  }
  if (parsed.username !== '' || parsed.password !== '') {
    fail('That URL carries credentials in it. Remove them — this clones anonymously, and a password in a URL ends up in shell history.')
  }
  if (parsed.port !== '') fail(`That URL names a port (${parsed.port}), and these hosts are not served on one.`)
  if (parsed.search !== '') fail('That URL has a query string on it. A repository URL is just the path.')
  if (parsed.hash !== '') fail('That URL has a #fragment on it. A repository URL is just the path.')

  const host = normalizeHost(parsed.hostname)
  const segments = parsed.pathname.split('/').filter((segment) => segment !== '')

  if (segments.length < 2 || (host === 'github.com' && segments.length !== 2)) {
    fail(
      `${parsed.href} does not look like a repository. It should be https://${host}/owner/name — a path to a repository and nothing else.`,
    )
  }

  const last = segments.length - 1
  const bare = segments.map((segment, index) => (index === last ? stripDotGit(segment) : segment))

  for (const segment of bare) {
    if (!SEGMENT.test(segment) || segment.includes('..')) {
      fail(`"${segment}" is not something that can be part of a repository URL. Check the address you pasted.`)
    }
  }

  const path = bare.join('/')
  return Object.freeze({
    url: `https://${host}/${path}.git`,
    host,
    owner: bare[0]!,
    name: bare[last]!,
  })
}

/**
 * `www.github.com` is the same host and redirects there, so it is normalised
 * rather than refused. Nothing else is: a lookalike host is the whole attack.
 */
function normalizeHost(hostname: string): RepositoryHost {
  const lowered = hostname.toLowerCase()
  const bare = lowered.startsWith('www.') ? lowered.slice('www.'.length) : lowered

  const allowed = ALLOWED_HOSTS.find((host) => host === bare)
  if (!allowed) {
    fail(`${hostname} is not a host this clones from. It clones from ${ALLOWED_HOSTS.join(' and ')}, and nowhere else.`)
  }
  return allowed
}

function stripDotGit(segment: string): string {
  return segment.endsWith('.git') ? segment.slice(0, -'.git'.length) : segment
}

// ── Where it lands ───────────────────────────────────────────────────────────

/** What a directory name derived from a project name is allowed to be. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface DestinationRequest {
  /** Absolute. Usually the working directory. */
  readonly baseDirectory: string
  /** Used when no destination is given. */
  readonly slug: string
  /** Given by `--into`. Absolute is allowed; escaping the base by `..` is not. */
  readonly destination?: string | undefined
}

export function destinationFor(request: DestinationRequest, path: SourcePath): string {
  const base = path.resolve(request.baseDirectory)
  const given = request.destination?.trim()

  if (given === undefined || given === '') {
    const slug = request.slug.trim()
    if (!SAFE_SEGMENT.test(slug)) {
      fail(`"${request.slug}" cannot be a directory name. Pass --into to say where this should go instead.`)
    }
    return path.join(base, slug)
  }

  // An absolute path is somebody saying exactly where, which is theirs to say.
  if (path.isAbsolute(given)) return path.resolve(given)

  // `C:foo` is neither absolute nor relative to the base — it is relative to
  // whatever directory that drive happens to be sitting on. Nobody means that.
  if (/^[A-Za-z]:/.test(given)) {
    fail(`"${given}" names a drive without being an absolute path, which does not mean what it looks like. Give a full path or a plain relative one.`)
  }

  const resolved = path.resolve(base, given)
  const inside = path.relative(base, resolved)
  if (inside === '' || inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
    fail(`"${given}" points outside ${base}. A relative destination cannot climb out with "..".`)
  }
  return resolved
}

// ── Preparing it ─────────────────────────────────────────────────────────────

/** In a directory that is otherwise empty, and not worth stopping for. */
export const IGNORED_WHEN_EMPTY: ReadonlySet<string> = new Set(['.git', '.gitkeep', '.DS_Store', 'Thumbs.db'])

/** What is in the way. Separated from the filesystem so the rule can be read. */
export function blockingEntries(entries: readonly string[]): string[] {
  return entries.filter((entry) => !IGNORED_WHEN_EMPTY.has(entry))
}

export interface PrepareRequest {
  readonly project: ProjectIdentity
  readonly selection: SourceSelection
  /** Absolute. Usually the working directory. */
  readonly baseDirectory: string
  readonly destination?: string | undefined
  /**
   * Only ever means one thing: write the scaffold into a directory that already
   * has files in it, overwriting files of the same name. It does not delete
   * anything, and it does not apply to a clone — git needs an empty directory
   * and this will not empty one for it.
   */
  readonly force?: boolean | undefined
  /**
   * What is about to be built. It lands in the project as `kei-mmo/plan.json`
   * and `kei-mmo/PLAN.md` in every case where this call created the directory,
   * so a cloned reference arrives with the reasoning for cloning it attached.
   */
  readonly plan: ImplementationPlan
}

export async function prepareSource(request: PrepareRequest, deps: SourceDeps): Promise<PreparedSource> {
  switch (request.selection.kind) {
    case 'existing':
      return useExisting(request, request.selection, deps)
    case 'blank':
      return writeScaffold(request, request.selection, deps)
    case 'template': {
      const template = templateNamed(request.selection.template)
      return clone(request, request.selection, template.url, deps, template)
    }
    case 'repository':
      return clone(request, request.selection, parseRepositoryUrl(request.selection.url).url, deps)
  }
}

async function writeFiles(
  directory: string,
  files: readonly WorkspaceFile[],
  deps: SourceDeps,
): Promise<readonly string[]> {
  for (const file of files) {
    const target = deps.path.join(directory, ...file.path.split('/'))
    await deps.fs.mkdir(deps.path.dirname(target))
    await deps.fs.writeFile(target, file.contents)
  }
  return Object.freeze(files.map((file) => file.path))
}

/**
 * The one case that writes nothing, spawns nothing, and moves nothing. A
 * project somebody already has is theirs; all this does is agree where it is.
 */
async function useExisting(
  request: PrepareRequest,
  selection: SourceSelection & { kind: 'existing' },
  deps: SourceDeps,
): Promise<PreparedSource> {
  const given = selection.path.trim()
  if (given === '') fail('An existing project needs a path to it.')

  const directory = deps.path.resolve(request.baseDirectory, given)
  const info = await deps.fs.stat(directory)

  if (!info) fail(`There is nothing at ${directory}. An existing project has to exist.`)
  if (!info.isDirectory) fail(`${directory} is a file, not a project directory.`)

  return Object.freeze({ selection, directory, created: false, written: [], remote: null })
}

async function writeScaffold(
  request: PrepareRequest,
  selection: SourceSelection & { kind: 'blank' },
  deps: SourceDeps,
): Promise<PreparedSource> {
  const directory = destinationFor(
    { baseDirectory: request.baseDirectory, slug: request.project.slug, destination: request.destination },
    deps.path,
  )

  const info = await deps.fs.stat(directory)
  if (info && !info.isDirectory) {
    fail(`${directory} is a file, not a directory. Pick a different project name or --into destination.`)
  }

  const entries = await deps.fs.readdir(directory)
  if (entries) {
    const blocking = blockingEntries([...entries])
    if (blocking.length > 0 && request.force !== true) {
      const sample = blocking.slice(0, 3).join(', ')
      const rest = blocking.length > 3 ? `, and ${blocking.length - 3} more` : ''
      fail(
        `${directory} already has files in it (${sample}${rest}). Pick a different name, or pass --force to write these files in alongside them — --force overwrites files with the same name and deletes nothing.`,
      )
    }
  }

  const written = await writeFiles(
    directory,
    [...scaffoldWorkspace(request.project, request.plan), ...planFiles(request.plan)],
    deps,
  )

  return Object.freeze({ selection, directory, created: true, written, remote: null })
}

async function clone(
  request: PrepareRequest,
  selection: SourceSelection,
  url: string,
  deps: SourceDeps,
  adoptedReference?: ReferenceProject,
): Promise<PreparedSource> {
  const directory = destinationFor(
    { baseDirectory: request.baseDirectory, slug: request.project.slug, destination: request.destination },
    deps.path,
  )

  const info = await deps.fs.stat(directory)
  if (info && !info.isDirectory) {
    fail(`${directory} is a file, not a directory. Pick a different project name or --into destination.`)
  }

  // git wants the destination empty and this does not empty it for git. Saying
  // so is better than a --force that quietly means `rm -rf`, which is what
  // somebody reading the flag would have to assume it did.
  const entries = await deps.fs.readdir(directory)
  if (entries && entries.length > 0) {
    fail(
      `${directory} is not empty, and a clone needs an empty directory. Nothing here will empty it for you: pick another name, or move what is there yourself.`,
    )
  }

  const base = deps.path.resolve(request.baseDirectory)
  // `git clone URL parent/child` creates `child`, but not a missing `parent`.
  // Make only the parent: precreating the destination itself changes git's
  // empty-directory checks and would make the no-overwrite rule harder to see.
  await deps.fs.mkdir(deps.path.dirname(directory))

  // `--` so that nothing after it can be read as an option, argv so that
  // nothing in it can be read as shell.
  const result = await deps.git('git', ['clone', '--depth', '1', '--', url, directory], {
    cwd: base,
    shell: false,
  })

  if (result.code === null) {
    fail(`Could not run git, which is what clones ${url}. Install git, or pick the blank source, which needs nothing.`)
  }
  if (result.code !== 0) {
    const said = result.stderr.trim()
    fail(`git clone ${url} failed (exit ${result.code}).${said === '' ? '' : `\n\n  ${said}`}`)
  }

  // A clone arrives with `origin` pointing at the reference, and `origin` is a
  // push target. This directory was handed to somebody as their project, so the
  // first `git push` in it must not aim at a repository that is not theirs.
  // Detaching it is not tidying: the reference's history is a fine place to
  // start from, and a remote nobody chose is not.
  const detached = await deps.git('git', ['remote', 'remove', 'origin'], {
    cwd: directory,
    shell: false,
  })
  if (detached.code !== 0) {
    const said = detached.stderr.trim()
    fail(
      `The clone of ${url} worked, but its "origin" remote could not be removed (exit ${String(detached.code)}), so ${directory} still pushes to somebody else's repository. Remove it before you commit: git -C ${directory} remote remove origin.${said === '' ? '' : `\n\n  ${said}`}`,
    )
  }

  // A planner-selected reference is adopted as this project, rather than
  // merely copied under a different directory. Validate every declared target
  // before writing any of them. An arbitrary repository selection is an
  // existing project and is deliberately not renamed.
  const identity = adoptedReference === undefined
    ? []
    : await adoptedIdentityFiles(directory, request.project, adoptedReference, deps)

  // The reference arrives with the case for cloning it sitting beside it. A
  // clone with no note in it is a directory of somebody else's decisions.
  if (identity.length > 0 && !await deps.fs.replaceIdentityFiles(directory, identity)) {
    return failIdentity(adoptedReference!, 'identity files')
  }
  const planWritten = await writeFiles(directory, planFiles(request.plan), deps)
  const written = Object.freeze([...identity.map(({ path }) => path), ...planWritten])
  return Object.freeze({ selection, directory, created: true, written, remote: url })
}

const MAX_ADOPTED_PACKAGE_BYTES = 256 * 1024
const MAX_ADOPTED_README_BYTES = 512 * 1024
const MAX_ADOPTED_SLUG_LENGTH = 214
const MAX_ADOPTED_TITLE_LENGTH = 200

function failIdentity(reference: ReferenceProject, target: string): never {
  fail(`The cloned ${reference.id} reference does not have the declared identity at ${target}, so it was not adopted.`)
}

function exactRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactly(value: unknown, expected: unknown): boolean {
  if (Object.is(value, expected)) return true
  if (Array.isArray(value) || Array.isArray(expected)) {
    return Array.isArray(value) && Array.isArray(expected) &&
      value.length === expected.length && value.every((item, index) => exactly(item, expected[index]))
  }
  if (!exactRecord(value) || !exactRecord(expected)) return false
  const left = Object.keys(value).sort()
  const right = Object.keys(expected).sort()
  return left.length === right.length && left.every((key, index) =>
    key === right[index] && exactly(value[key], expected[key]),
  )
}

/** Counts top-level JSON object keys without treating strings or nested keys as targets. */
function topLevelKeyCounts(text: string): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  let depth = 0
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!
    if (character === '{' || character === '[') { depth += 1; continue }
    if (character === '}' || character === ']') { depth -= 1; continue }
    if (character !== '"') continue

    const start = index
    let escaped = false
    for (index += 1; index < text.length; index += 1) {
      const inner = text[index]!
      if (escaped) { escaped = false; continue }
      if (inner === '\\') { escaped = true; continue }
      if (inner === '"') break
    }
    if (depth !== 1 || index >= text.length) continue
    let after = index + 1
    while (/\s/.test(text[after] ?? '')) after += 1
    if (text[after] !== ':') continue
    const key = JSON.parse(text.slice(start, index + 1)) as string
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function formattedPackage(value: Record<string, unknown>, original: string): string {
  const indentation = /^\{\r?\n([ \t]+)"/.exec(original)?.[1] ?? '  '
  const newline = original.includes('\r\n') ? '\r\n' : '\n'
  const ended = /\r?\n$/.test(original)
  return JSON.stringify(value, null, indentation).replaceAll('\n', newline) + (ended ? newline : '')
}

function validAdoptionIdentity(project: ProjectIdentity): boolean {
  return project.slug.length > 0 && project.slug.length <= MAX_ADOPTED_SLUG_LENGTH &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(project.slug) &&
    project.title.length > 0 && project.title.length <= MAX_ADOPTED_TITLE_LENGTH &&
    project.title.trim() === project.title && !/[\r\n\u0000-\u001f\u007f]/.test(project.title)
}

async function requiredText(
  directory: string,
  path: string,
  maxBytes: number,
  reference: ReferenceProject,
  deps: SourceDeps,
): Promise<{ readonly contents: string; readonly identity: SourceFileIdentity }> {
  if (path.length > 128 || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    return failIdentity(reference, path)
  }
  const read = await deps.fs.readIdentityFile(directory, path, maxBytes)
  return read.kind === 'text'
    ? { contents: read.contents, identity: read.identity }
    : failIdentity(reference, path)
}

interface IdentityRewrite extends WorkspaceFile {
  readonly identity: SourceFileIdentity
}

async function adoptedIdentityFiles(
  directory: string,
  project: ProjectIdentity,
  reference: ReferenceProject,
  deps: SourceDeps,
): Promise<readonly IdentityRewrite[]> {
  if (!validAdoptionIdentity(project)) fail('The requested project identity is not safe to adopt into a cloned reference.')

  const declaration = reference.adoption
  const packageRead = await requiredText(directory, declaration.packagePath, MAX_ADOPTED_PACKAGE_BYTES, reference, deps)
  const readmeRead = await requiredText(directory, declaration.readmePath, MAX_ADOPTED_README_BYTES, reference, deps)
  const packageText = packageRead.contents
  const readmeText = readmeRead.contents

  let manifest: unknown
  try { manifest = JSON.parse(packageText) as unknown } catch { return failIdentity(reference, declaration.packagePath) }
  if (!exactRecord(manifest)) return failIdentity(reference, declaration.packagePath)

  const keys = topLevelKeyCounts(packageText)
  if (keys.get('name') !== 1 || manifest.name !== declaration.packageName) {
    return failIdentity(reference, `${declaration.packagePath}#name`)
  }
  const repositoryCount = keys.get('repository') ?? 0
  if (declaration.repository === null) {
    if (repositoryCount !== 0 || Object.hasOwn(manifest, 'repository')) {
      return failIdentity(reference, `${declaration.packagePath}#repository`)
    }
  } else if (
    repositoryCount !== 1 ||
    !Object.hasOwn(manifest, 'repository') ||
    !exactly(manifest.repository, declaration.repository)
  ) {
    return failIdentity(reference, `${declaration.packagePath}#repository`)
  }

  const lines = readmeText.split(/\r?\n/)
  if (lines[0] !== declaration.readmeHeading || lines.filter((line) => line === declaration.readmeHeading).length !== 1) {
    return failIdentity(reference, `${declaration.readmePath}#heading`)
  }

  manifest.name = project.slug
  // There is no requested destination repository in ProjectIdentity. Keeping
  // the reference URL is false, and inventing a new remote is worse, so an
  // exactly matched stale repository field is deliberately removed.
  if (declaration.repository !== null) delete manifest.repository
  const readme = `# ${project.title}${readmeText.slice(declaration.readmeHeading.length)}`

  return Object.freeze([
    { path: declaration.packagePath, contents: formattedPackage(manifest, packageText), identity: packageRead.identity },
    { path: declaration.readmePath, contents: readme, identity: readmeRead.identity },
  ])
}

// ── The scaffolded workspace ─────────────────────────────────────────────────

export interface WorkspaceFile {
  /** Relative, POSIX-separated. */
  readonly path: string
  readonly contents: string
}

/** The plan as two files: the one a model reads, and the one a person argues with. */
export function planFiles(plan: ImplementationPlan): readonly WorkspaceFile[] {
  return Object.freeze([
    { path: PLAN_JSON_PATH, contents: planJson(plan) },
    { path: PLAN_MARKDOWN_PATH, contents: renderPlanMarkdown(plan) },
  ])
}

/**
 * The project itself. `scaffold.ts` holds every file and every opinion in them;
 * this stays the layer that decides *where* things land and what is refused,
 * which is the only reason it can be tested without a disk.
 */
export function scaffoldWorkspace(
  project: ProjectIdentity,
  plan: ImplementationPlan,
): readonly WorkspaceFile[] {
  return projectFiles(project, plan)
}
