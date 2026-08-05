/**
 * Which game gets written.
 *
 * The default is the one that fits in a file you can read in a sitting. The
 * other two are whole example projects that live in their own repositories,
 * because a 30MB tarball of `.glb` models has no business inside a scaffolder
 * that most people run to get a star and a button.
 *
 * That split is the only structural difference between them. A template is a set
 * of files plus the handful of places the developer's own two answers have to
 * land, and where the files come from is an implementation detail of `filesFor`.
 */

import { fail } from './errors.js'
import { literal, markdownText } from './escape.js'
import type { GameProject } from './naming.js'
import type { GeneratedFile } from './scaffold.js'
import { extractTarGz } from './tar.js'

export interface Template {
  name: string
  /** One line. Printed by `--help` and by the error that lists the options. */
  summary: string
  /**
   * Whether this game has a currency of its own to name. Carpet Markets does
   * not — every coin on it is launched by a player at runtime — so asking would
   * be asking for an answer that goes nowhere.
   */
  currency: boolean
  source: LocalSource | GitHubSource
}

interface LocalSource {
  kind: 'local'
}

interface GitHubSource {
  kind: 'github'
  /** `owner/repo`. */
  repo: string
  /**
   * The ref to fetch. `main` means a developer gets whatever is on it today,
   * which is honest for an example that is still moving and wrong for anything
   * anybody depends on. When these repositories start tagging releases this
   * becomes the tag, and that is the whole change.
   */
  ref: string
  /** Where the two answers have to land once the archive is unpacked. */
  rewrite(files: GeneratedFile[], project: GameProject): void
}

export const DEFAULT_TEMPLATE = 'star-clicker'

export const TEMPLATES: readonly Template[] = [
  {
    name: 'star-clicker',
    summary: 'A 3D scene, a currency, and an item you buy for a fraction of a cent. Ten files, single-player.',
    currency: true,
    source: { kind: 'local' },
  },
  {
    name: 'world-of-wonder',
    summary: 'A multiplayer 3D RPG whose gold and items are on the chain. Babylon.js + Colyseus, forked from t5c.',
    currency: true,
    source: {
      kind: 'github',
      repo: 'keicoin-org/world-of-wonder',
      ref: 'main',
      rewrite: rewriteWorldOfWonder,
    },
  },
  {
    name: 'carpet-markets',
    summary: 'A coin launchpad where whether a coin can be rugged is a transfer policy the chain enforces.',
    currency: false,
    source: {
      kind: 'github',
      repo: 'keicoin-org/carpet-markets',
      ref: 'main',
      rewrite: rewriteCarpetMarkets,
    },
  },
]

export function templateNamed(name: string): Template {
  const found = TEMPLATES.find((template) => template.name === name)
  if (found) return found

  const known = TEMPLATES.map((template) => template.name).join(', ')
  fail(`There is no template called "${name}". The ones there are: ${known}.`)
}

/**
 * Reads an archive over the network. Separated so the tests can hand the
 * scaffolder a tarball they built themselves and never touch GitHub — a test
 * suite that downloads 30MB to check a string substitution is a test suite that
 * fails on a train.
 */
export type Fetcher = (url: string) => Promise<Uint8Array>

export const fetchTarball: Fetcher = async (url) => {
  let response: Response
  try {
    response = await fetch(url)
  } catch (cause) {
    fail(
      `Could not reach ${url} to download the template. Check the connection — this template lives in its own repository and is not shipped inside this package.`,
    )
  }
  if (!response.ok) {
    fail(`${url} answered ${response.status}. If that is a 404 the template's branch has moved; report it as a bug.`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export interface FilesOptions {
  /** The `kei-transaction` range written into a local template's `package.json`. */
  sdkVersion: string
  /** Overridden by the tests. */
  fetcher?: Fetcher
  /** Overridden by the tests, and only used by the local template. */
  templates?: string
}

/**
 * Everything the project directory should contain, from whichever template.
 *
 * `scaffold` is imported lazily because it reaches for the template directory on
 * disk, and a remote template has no business paying for that.
 */
export async function filesFor(
  template: Template,
  project: GameProject,
  options: FilesOptions,
): Promise<GeneratedFile[]> {
  if (template.source.kind === 'local') {
    const { scaffold } = await import('./scaffold.js')
    return scaffold(project, {
      sdkVersion: options.sdkVersion,
      ...(options.templates === undefined ? {} : { templates: options.templates }),
    })
  }

  const { repo, ref } = template.source
  const fetcher = options.fetcher ?? fetchTarball
  const archive = await fetcher(`https://codeload.github.com/${repo}/tar.gz/refs/heads/${ref}`)

  let files: GeneratedFile[]
  try {
    files = extractTarGz(archive).map((entry) => ({ path: entry.path, contents: entry.contents }))
  } catch (cause) {
    fail(`The template downloaded from ${repo} could not be unpacked: ${(cause as Error).message}`)
  }

  template.source.rewrite(files, project)
  return files
}

// ── Making a downloaded project the developer's own ──────────────────────────
//
// These are deliberately strict. A rewrite that silently matches nothing emits a
// project still carrying the example's name and the example's currency, and the
// developer finds out when their game says "Gold" in a language they do not
// speak. So every one of them fails loudly instead, which turns a drift in one
// of those repositories into a failing test here rather than a bad scaffold.

function find(files: readonly GeneratedFile[], path: string): GeneratedFile {
  const file = files.find((candidate) => candidate.path === path)
  if (!file) {
    fail(`The downloaded template has no ${path}, so it is not the project this knows how to rename. Report it as a bug.`)
  }
  return file
}

function text(file: GeneratedFile): string {
  return typeof file.contents === 'string' ? file.contents : Buffer.from(file.contents).toString('utf8')
}

/**
 * Replaces `find` once, and refuses to pretend it worked when it is not there.
 *
 * The replacement goes in through a function, because the string form of
 * `replace` reads `$&` and `$'` as instructions, and a currency is allowed to
 * contain both.
 */
function substitute(file: GeneratedFile, find: string, replace: string): void {
  const before = text(file)
  if (!before.includes(find)) {
    fail(`Expected to find ${JSON.stringify(find)} in the downloaded ${file.path} and did not. Report it as a bug.`)
  }
  file.contents = before.replace(find, () => replace)
}

/**
 * The generated project is the developer's, so it loses the example's name, the
 * example's git remote, and the notice pointing back at the scaffolder.
 */
function claimPackageJson(files: GeneratedFile[], project: GameProject, description: string): void {
  const file = find(files, 'package.json')
  const manifest = JSON.parse(text(file)) as Record<string, unknown>
  const was = String(manifest.name)

  manifest.name = project.slug
  manifest.description = description
  delete manifest.repository
  delete manifest.bugs
  delete manifest.homepage
  // The examples are `private` so nobody publishes one by accident. A project
  // somebody just created should not inherit that decision.
  delete manifest.private

  // Four spaces is what both of these repositories use, and a scaffolder has no
  // business reformatting a file on its way past.
  file.contents = `${JSON.stringify(manifest, null, 4)}\n`

  claimLockfile(files, was, project.slug)
}

/**
 * The lockfile records the project's own name twice, at the root and again under
 * `packages[""]`. `npm ci` tolerates the disagreement, so this is tidiness
 * rather than a fix — but a lockfile that calls the project by the example's
 * name is a lie the developer has to notice and correct themselves.
 *
 * Rewritten as text rather than through `JSON.parse`, because these files run to
 * thousands of lines and reserialising one would produce a diff against npm's
 * own formatting on the developer's first install.
 */
function claimLockfile(files: readonly GeneratedFile[], from: string, to: string): void {
  const lockfile = files.find((candidate) => candidate.path === 'package-lock.json')
  if (!lockfile) return

  lockfile.contents = text(lockfile).replaceAll(`"name": ${JSON.stringify(from)}`, `"name": ${JSON.stringify(to)}`)
}

function rewriteWorldOfWonder(files: GeneratedFile[], project: GameProject): void {
  claimPackageJson(
    files,
    project,
    `${project.title} — a multiplayer RPG whose ${project.currency} and items live on the Kei chain.`,
  )

  // The whole currency is one `as const` in one file, which is why this is two
  // lines rather than a sweep over the source.
  const economy = find(files, 'src/server/kei/Economy.ts')
  substitute(economy, `  name: 'Gold',`, `  name: ${literal(project.currency)},`)
  substitute(economy, `  symbol: 'GOLD',`, `  symbol: ${literal(project.symbol)},`)

  find(files, 'README.md').contents = worldOfWonderReadme(project)
}

function rewriteCarpetMarkets(files: GeneratedFile[], project: GameProject): void {
  claimPackageJson(files, project, `${project.title} — a coin launchpad on Kei, where the rug is a transfer policy.`)
  find(files, 'README.md').contents = carpetMarketsReadme(project)
}

/**
 * The prose is escaped and the fenced block is not, which is the difference
 * between the two and the reason the escaped values are named separately here:
 * a backslash is syntax in one and a backslash in the other.
 */
function worldOfWonderReadme(project: GameProject): string {
  const title = markdownText(project.title)
  const currency = markdownText(project.currency)
  const symbol = markdownText(project.symbol)

  return `# ${title}

A multiplayer 3D top-down RPG whose **${currency} and items live on a chain
instead of in the game's database**. A player's sword is theirs, rather than a
row you could delete.

Scaffolded from [world-of-wonder](https://github.com/keicoin-org/world-of-wonder),
itself a fork of [orion3dgames/t5c](https://github.com/orion3dgames/t5c) — the
movement, combat, quests, navmesh, and UI are upstream's work. What Kei replaces
is the economy.

Node 20.17 or newer.

\`\`\`sh
npm ci
cp .env.example .env                            # optional — everything has a default
npm run server-build && npm run server-start    # http://localhost:3000
npm run client-dev                              # http://localhost:8080
\`\`\`

Your currency is **${currency}**, and the chain knows it as **${symbol}**.
It is declared in one place, \`src/server/kei/Economy.ts\`, as the \`COIN\` constant.

## Where the chain is

\`\`\`
src/server/kei/Economy.ts    the issuer: ${project.currency}, items, the shop. Read this one first.
src/server/kei/api.ts        the HTTP surface. Nothing here can move a player's money.
src/server/kei/node.ts       which chain, and which account issues the money
src/client/Controllers/Wallet.ts   the player's key, and the only thing that spends their ${project.currency}
\`\`\`

By default this settles on the public Kei testnet, which is a real network with
no uptime promise and no value on it. \`KEI_NETWORK=mock\` runs an in-process
chain instead, which is right when you are offline. Set \`KEI_GAME_SEED\` before
you play twice — without one the issuer changes every restart, and every balance
from the last run becomes unreachable.

The full documentation, including how the economy is set up and how loot works,
is in the upstream repository's \`docs/\`.

## The rule worth keeping

The database holds accounts, characters, and where they were standing. Colyseus
is authoritative over presence and position. **Neither is authoritative over
money** — that is the whole point, and the thing to preserve as you build on it.
`
}

function carpetMarketsReadme(project: GameProject): string {
  return `# ${markdownText(project.title)}

A coin launchpad, in the pump.fun shape: anybody can launch a token in one click,
is minted the whole supply, and from there it is worth whatever the next person
will pay.

There is no bonding curve and no house. Every trade is an offer one player wrote
and another accepted — \`swap_offer\` and \`swap_accept\`, settled in one block by
consensus (SPEC §9.2). This is what \`@keicoin/market\` is for.

\`\`\`sh
bun install
bun run dev          # client on :3000, chain and registry on :7788
bun run seed         # six coins and a market between them, so there is something to look at
\`\`\`

Scaffolded from [carpet-markets](https://github.com/keicoin-org/carpet-markets).

## The point

There is no mechanic here called "rug". A creator is minted the whole supply and
can sell it, in whatever size they choose, whenever they choose. That is selling,
which is the only thing anybody on this market can do.

What the chain decides is whether that market can exist at all. A coin's
\`transfer\` policy is chosen at issuance, enforced by consensus, and immutable
afterwards (SPEC §5.4):

| | \`transfer\` | What it means |
|---|---|---|
| **Open** | \`'open'\` | Anybody can send it to anybody, so there is a real order book — and the creator is holding a million of them. |
| **Issuer only** | \`'issuer-only'\` | Units move only to or from the issuing account. An offer between two holders is an invalid block, so no player-to-player market exists or can. |
| **Soulbound** | \`'none'\` | Nothing moves, ever. It cannot be sold, by anybody, including whoever made it. |

A database can hold the same flag, and a developer can edit the row. That is the
whole difference.

This template asks for no currency of its own, because it does not have one:
every coin on it is launched by a player at runtime. Read \`server/registry.ts\`
first — it is the launchpad.
`
}
