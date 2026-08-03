/**
 * Where the game comes from, and what "prepare it" means for each answer.
 *
 * Four answers, and only four: nothing, one of the games we publish, a project
 * already on this disk, or a repository somewhere. Everything downstream of the
 * first question needs a directory to work in, so this is the piece that decides
 * which directory that is and puts it in the state the rest can assume.
 *
 * The filesystem, the path rules, and the ability to run `git` all arrive as
 * arguments. That is not ceremony: it is what lets the tests below check the
 * exact argv this hands to git, and check the refusals, without a network, a
 * temporary directory, or git installed at all.
 */

import { fail } from './errors.js'

// ── The data model ───────────────────────────────────────────────────────────

/**
 * All this step needs of a project: a directory name and something to put at the
 * top of a README. A blank workspace has no currency, so it does not ask for one.
 */
export interface ProjectIdentity {
  readonly slug: string
  readonly title: string
}

export interface KnownTemplate {
  /** What `--template` takes. */
  readonly id: string
  /** What a human is shown and may type instead. */
  readonly label: string
  readonly summary: string
  /** Cloned over HTTPS. There is no packaged copy of any of these. */
  readonly url: string
}

export const KNOWN_TEMPLATES = [
  {
    id: 'button',
    label: 'Button',
    summary: 'One button, one currency, one item. The small one, and the one to read first.',
    url: 'https://github.com/keicoin-org/button.git',
  },
  {
    id: 'world-of-wonder',
    label: 'World of Wonder',
    summary: 'A multiplayer 3D RPG whose gold and items are on the chain.',
    url: 'https://github.com/keicoin-org/world-of-wonder.git',
  },
  {
    id: 'carpet-markets',
    label: 'Carpet Markets',
    summary: 'A coin launchpad where whether a coin can be rugged is a policy the chain enforces.',
    url: 'https://github.com/keicoin-org/carpet-markets.git',
  },
] as const satisfies readonly KnownTemplate[]

export type TemplateId = (typeof KNOWN_TEMPLATES)[number]['id']

/** Accepts the flag spelling and the spelling a human would type at a prompt. */
export function templateNamed(name: string): KnownTemplate {
  const wanted = name.trim().toLowerCase()
  const found = KNOWN_TEMPLATES.find(
    (template) => template.id === wanted || template.label.toLowerCase() === wanted,
  )
  if (found) return found

  const known = KNOWN_TEMPLATES.map((template) => template.label).join(', ')
  fail(`There is no template called "${name}". The ones there are: ${known}.`)
}

export type SourceSelection =
  /** Nothing to start from. A workspace you own and four files you can read. */
  | { readonly kind: 'blank' }
  /** One of the three above, cloned from its own repository. */
  | { readonly kind: 'template'; readonly template: string }
  /** A project already on this disk. Used where it lies, and never written to. */
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
  /** Relative POSIX paths written by this call. Empty unless the source is blank. */
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
  writeFile(file: string, contents: string): Promise<void>
}

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
   * Only ever means one thing: write the blank workspace into a directory that
   * already has files in it, overwriting files of the same name. It does not
   * delete anything, and it does not apply to a clone — git needs an empty
   * directory and this will not empty one for it.
   */
  readonly force?: boolean | undefined
}

export async function prepareSource(request: PrepareRequest, deps: SourceDeps): Promise<PreparedSource> {
  switch (request.selection.kind) {
    case 'existing':
      return useExisting(request, request.selection, deps)
    case 'blank':
      return writeBlank(request, request.selection, deps)
    case 'template': {
      const template = templateNamed(request.selection.template)
      return clone(request, request.selection, template.url, deps)
    }
    case 'repository':
      return clone(request, request.selection, parseRepositoryUrl(request.selection.url).url, deps)
  }
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

async function writeBlank(
  request: PrepareRequest,
  selection: SourceSelection & { kind: 'blank' },
  deps: SourceDeps,
): Promise<PreparedSource> {
  const directory = destinationFor(
    { baseDirectory: request.baseDirectory, slug: request.project.slug, destination: request.destination },
    deps.path,
  )

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

  const files = blankWorkspace(request.project)
  for (const file of files) {
    const target = deps.path.join(directory, ...file.path.split('/'))
    await deps.fs.mkdir(deps.path.dirname(target))
    await deps.fs.writeFile(target, file.contents)
  }

  return Object.freeze({
    selection,
    directory,
    created: true,
    written: Object.freeze(files.map((file) => file.path)),
    remote: null,
  })
}

async function clone(
  request: PrepareRequest,
  selection: SourceSelection,
  url: string,
  deps: SourceDeps,
): Promise<PreparedSource> {
  const directory = destinationFor(
    { baseDirectory: request.baseDirectory, slug: request.project.slug, destination: request.destination },
    deps.path,
  )

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
  await deps.fs.mkdir(base)

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

  return Object.freeze({ selection, directory, created: true, written: [], remote: url })
}

// ── The blank workspace ──────────────────────────────────────────────────────

interface WorkspaceFile {
  /** Relative, POSIX-separated. */
  readonly path: string
  readonly contents: string
}

/**
 * Deliberately almost nothing. This is not a template with the name filed off —
 * it is an empty room with the lights on, for somebody who knows what they are
 * building and does not want to delete a game first.
 */
export function blankWorkspace(project: ProjectIdentity): readonly WorkspaceFile[] {
  const manifest = {
    name: project.slug,
    version: '0.0.0',
    private: true,
    type: 'module',
    description: project.title,
  }

  return Object.freeze([
    { path: 'package.json', contents: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: 'README.md', contents: readme(project) },
    { path: '.gitignore', contents: 'node_modules/\ndist/\n.DS_Store\n' },
    { path: 'src/main.ts', contents: main(project) },
  ])
}

function readme(project: ProjectIdentity): string {
  return `# ${project.title}

An empty workspace. Nothing has been chosen for you: no renderer, no server, no
dependencies, and no currency. \`src/main.ts\` is the only line of code here and
it is yours to replace.

If you wanted something to read instead of a blank page, the games are:

${KNOWN_TEMPLATES.map((template) => `- **${template.label}** — ${template.summary}`).join('\n')}

\`\`\`sh
npm create kei-game ${project.slug} -- --template button
\`\`\`
`
}

function main(project: ProjectIdentity): string {
  return `/** Replace this file with the first piece of your game. */

export function start(): void {
  console.log(${JSON.stringify(project.title)})
}

start()
`
}
