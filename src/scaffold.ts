/**
 * The files a scaffolded project is actually made of.
 *
 * This used to be four stubs and a `package.json` whose `dev` script printed
 * "wire this up" and exited 1. That was honest about being unfinished and
 * useless as a starting point: nothing installed, nothing built, nothing ran.
 *
 * What is here now is the smallest project that installs, builds, and serves
 * itself with no manual edit — a page, clients that draw and run headless, an
 * authoritative loopback game server, a build script, and the shared simulation
 * both sides import. Every one of those files belongs to the project. None of
 * them imports this harness, and
 * deleting the harness from the machine changes nothing about them.
 *
 * What is deliberately *not* here: account recovery, client
 * prediction/reconciliation, interest management, and finished art. The Kei
 * slice is a mock-chain proof owned by the generated project; it does not bind
 * a socket identity to a wallet or make the game server a custodian.
 */

import { contentProjectFiles, CONTENT_CHECK_PATH } from './content-project.js'
import {
  ECONOMY_TEST_PATH,
  economyProjectFiles,
  KEI_PACKAGE,
  KEI_RANGE,
} from './scaffold-economy.js'
import {
  CONNECTION_PATH,
  DEV_SERVER_PATH,
  DEV_SERVICE,
  GAME_PROTOCOL_VERSION,
  GAME_SOCKET_PATH,
  HEADLESS_CLIENT_BUNDLE,
  HEADLESS_CLIENT_PATH,
  RESTART_PROOF_PATH,
  networkProjectFiles,
  SERVER_PATH,
  WEBSOCKET_PACKAGE,
  WEBSOCKET_RANGE,
} from './scaffold-network.js'
import { PLAN_JSON_PATH, PLAN_MARKDOWN_PATH, type ImplementationPlan } from './plan.js'
import { POLISH_CHECK_PATH, polishProjectFiles } from './scaffold-polish.js'
import type { ProjectIdentity, WorkspaceFile } from './source.js'

/**
 * The renderer a 3D project installs, as a normal semver range against the
 * public registry. `@babylonjs/core` is the ES-module distribution: deep
 * imports, no exports map in the way, and a bundle that carries only what the
 * client actually named.
 */
export const RENDERER_PACKAGE = '@babylonjs/core'
export const RENDERER_RANGE = '^9.19.0'

export const CLIENT_PATH = 'src/client/main.ts'
export const SIMULATION_PATH = 'src/shared/simulation.ts'
export const BUILD_SCRIPT_PATH = 'scripts/build.mjs'
export const PAGE_PATH = 'static/index.html'

/** Where `bun run build` puts the client, and what the dev server serves. */
export const OUTPUT_DIRECTORY = 'dist'
/** The bundle path inside it, relative to the page. */
export const CLIENT_BUNDLE = 'client/main.js'

/** The one line a supervising process is allowed to depend on. */
export const DEV_READY_EVENT = 'ready'
export const DEFAULT_DEV_PORT = 5173

export {
  CONNECTION_PATH,
  DEV_SERVER_PATH,
  DEV_SERVICE,
  GAME_PROTOCOL_VERSION,
  GAME_SOCKET_PATH,
  HEADLESS_CLIENT_BUNDLE,
  HEADLESS_CLIENT_PATH,
  RESTART_PROOF_PATH,
  SERVER_PATH,
} from './scaffold-network.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Every file a scaffolded project gets, in the order they are written. The
 * dimension changes exactly two of them — the client and the page's caption —
 * plus whether a renderer is installed at all.
 */
export function projectFiles(
  project: ProjectIdentity,
  plan: ImplementationPlan,
): readonly WorkspaceFile[] {
  const solid = plan.engine.dimension === '3d'
  const contentFiles = contentProjectFiles(project, plan)
  const polishFiles = polishProjectFiles(plan)

  return Object.freeze([
    { path: 'package.json', contents: manifest(project, solid, contentFiles.length > 0) },
    { path: 'README.md', contents: readme(project, plan) },
    { path: '.gitignore', contents: 'node_modules/\ndist/\n.kei-world/\n*.sqlite*\n.DS_Store\n' },
    { path: 'tsconfig.json', contents: tsconfig() },
    { path: PAGE_PATH, contents: page(project, solid) },
    { path: BUILD_SCRIPT_PATH, contents: buildScript() },
    { path: SIMULATION_PATH, contents: simulation() },
    { path: CLIENT_PATH, contents: solid ? client3d(project) : client2d(project) },
    ...networkProjectFiles(project.slug),
    ...economyProjectFiles(),
    ...contentFiles,
    ...polishFiles,
  ])
}

function manifest(project: ProjectIdentity, solid: boolean, withContent: boolean): string {
  const value = {
    name: project.slug,
    version: '0.0.0',
    private: true,
    type: 'module',
    description: project.title,
    engines: { bun: '>=1.3.0', node: '>=20' },
    scripts: {
      build: `bun run ${BUILD_SCRIPT_PATH}`,
      dev: `bun run ${DEV_SERVER_PATH}`,
      headless: `bun run ${OUTPUT_DIRECTORY}/${HEADLESS_CLIENT_BUNDLE}`,
      'restart-proof': `bun run ${RESTART_PROOF_PATH}`,
      'economy:check': `bun test ${ECONOMY_TEST_PATH}`,
      'polish:check': `node ${POLISH_CHECK_PATH}`,
      ...(withContent ? { 'content:check': `node ${CONTENT_CHECK_PATH}` } : {}),
    },
    dependencies: {
      [WEBSOCKET_PACKAGE]: WEBSOCKET_RANGE,
      [KEI_PACKAGE]: KEI_RANGE,
      ...(solid ? { [RENDERER_PACKAGE]: RENDERER_RANGE } : {}),
    },
  }
  return `${JSON.stringify(value, null, 2)}\n`
}

function tsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'Preserve',
        moduleResolution: 'bundler',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        strict: true,
        noUncheckedIndexedAccess: true,
        verbatimModuleSyntax: true,
        allowImportingTsExtensions: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['src'],
    },
    null,
    2,
  )}\n`
}

function readme(project: ProjectIdentity, plan: ImplementationPlan): string {
  const solid = plan.engine.dimension === '3d'
  const start =
    plan.reference.strategy === 'clone' && plan.reference.reference
      ? `This started from the **${plan.reference.reference.label}** reference project, because the plan judged it a closer starting point than an empty directory.`
      : 'This started from a scaffold rather than a reference project. The plan says why.'

  const draws = solid
    ? `\`${CLIENT_PATH}\` is Babylon.js: an engine on the page's canvas, an arc-rotate
camera, one hemispheric light, a ground plane, and one box standing in for the
player. It is your code — the harness wrote it once and has no further claim on
it — and it is roughly two hundred readable lines, not a framework.`
    : `\`${CLIENT_PATH}\` is a **construction frame**, not a renderer. It opens a 2D
context, applies the camera transform once per frame, culls a grid to the view
rectangle, and draws every player in the server snapshot. That is the skeleton
the \`render-2d\` plan step fills in: there is no atlas, no sprite, no tile set,
and nothing here should be mistaken for finished 2D rendering.`

  return `# ${project.title}

A ${plan.engine.dimension.toUpperCase()} Kei MMORPG, planned by Create Kei MMO.

${start}

## Run it

\`\`\`sh
bun install
bun run dev
\`\`\`

\`bun run dev\` builds the client, starts the authoritative game transport, and
serves \`${OUTPUT_DIRECTORY}/\` on
http://127.0.0.1:${DEFAULT_DEV_PORT}. It prints one JSON line when it is listening —

\`\`\`json
{"event":"${DEV_READY_EVENT}","service":"${DEV_SERVICE}","url":"http://127.0.0.1:${DEFAULT_DEV_PORT}/","socketUrl":"ws://127.0.0.1:${DEFAULT_DEV_PORT}${GAME_SOCKET_PATH}?protocol=${GAME_PROTOCOL_VERSION}","protocol":${GAME_PROTOCOL_VERSION},"port":${DEFAULT_DEV_PORT}}
\`\`\`

— so a script can wait for the server instead of sleeping and hoping. Set
\`PORT=0\` to take whatever port is free and read the real one back off that line.
The server accepts only numeric loopback hosts: \`127.0.0.1\` (the default) or
\`::1\`. An inherited \`HOST\` cannot accidentally publish this development server.

Exercise the browser's connection path without rendering a frame:

\`\`\`sh
bun run headless -- ws://127.0.0.1:${DEFAULT_DEV_PORT}${GAME_SOCKET_PATH}
\`\`\`

The headless client and browser both use \`${CONNECTION_PATH}\`. A successful
connection receives a versioned authoritative snapshot before reporting success.

Prove a character survives clean server restarts without keeping a token on disk:

\`\`\`sh
bun run restart-proof
\`\`\`

The browser keeps its opaque resume capability under a project-namespaced
\`localStorage\` key. Press **E** to request the fixed server-authored progression
interaction. Losing the token starts a new character; account recovery is not
part of this construction slice.

\`bun run build\` produces the same bundle without serving it, and prints one JSON
line of its own.

## What is here, and what is not

${draws}

\`${SIMULATION_PATH}\` is the pure fixed-step rule set. The authoritative server
runs its accumulator; browsers only render accepted snapshots, so frame rate and
simulation rate are separate without giving the renderer authority.

\`${SERVER_PATH}\` owns the tick and world. \`${DEV_SERVER_PATH}\` exposes it over a
versioned loopback WebSocket; browsers render every server-assigned player, and
the generated headless scenario proves two clients observe each other's movement.
Stale input and attempts to author position, progression, or economic state are
refused without changing memory, disk, or player-custodied assets.

The project also owns a player-custodied Kei proof. Run \`bun run economy:check\`:
it creates one private \`Kei.mock()\` chain, provisions open-transfer,
one-way-purchase GOLD and a Founder's Sword directly to two player wallets,
refuses mismatched displayed terms before signing, then atomically settles a
reserved item-for-GOLD offer. \`transfer: 'open'\` permits that player trade;
\`swap: 'one-way'\` is the separate issuer-desk promise that GOLD can be bought
from its issuer but not redeemed there.
The authoritative game server has no Kei import, key, balance, inventory, or
settlement path. The mock provisioner is a separate test fixture; production
provisioning accepts an injected issuer context and contains no seed.

The project also owns the version-1 contract for a future recordable first
encounter. Its recipe, semantic action/effect timelines, quality tiers, asset
requirements, and source registry live under \`kei-mmo/polish/\`. No production
asset is admitted in this contract-only slice, and the primitive construction
renderer is not wired to the recipe. Consequently \`bun run polish:check\`
deliberately exits nonzero with \`polish_assets_pending\`; this is not criterion 9.

\`src/server/persistence.ts\` stores only
hashed resume capabilities, position, XP, level, and update time in the versioned
WAL database at \`.kei-world/world.sqlite\` (override with \`KEI_WORLD_DB\`). It
stores no Kei balance, item, wallet seed, or plaintext token. Account recovery,
socket-to-wallet proof of control, chunk streaming, prediction/reconciliation,
and interest management remain separate work.

## The plan

\`${PLAN_MARKDOWN_PATH}\` is the readable version and \`${PLAN_JSON_PATH}\` is the
machine-readable original. Between them they hold the engine decision, the
reference decision, the constraints, the acceptance criteria, the build order,
and one capability packet per piece of work — each naming its prerequisites,
its tools, and the calls that do the job.

Disagree with it. It was derived from what you asked for, and it is a file in
your repository, not a contract.

## Shape

| Path | What lives here |
|---|---|
| \`src/shared/\` | The simulation and versioned snapshot protocol. Imported by both sides. |
| \`src/client/\` | Rendering plus one shared browser/headless connection path. Owns no authority. |
| \`src/server/\` | Authoritative tick plus versioned SQLite character persistence. No Kei import, wallet, balance, item, or settlement path. |
| \`src/economy/\` | Currency/item declarations, separate issuer provisioning, and player-signed atomic trade helpers. |
| \`${ECONOMY_TEST_PATH}\` | The private mock-chain custody, mismatch, and settlement proof. |
| \`${DEV_SERVER_PATH}\` | The Bun WebSocket and static development server. |
| \`${BUILD_SCRIPT_PATH}\` | The build. Bundles the client and copies \`static/\`. |
| \`${PAGE_PATH}\` | The page and the canvas the client takes over. |
| \`kei-mmo/polish/\` | Versioned encounter and source-admission contracts. The check remains blocked until real licensed assets are admitted. |

Planned renderer direction: ${plan.engine.renderer}

Planned server direction: ${plan.engine.server}
${contentReadme(plan)}`
}

function contentReadme(plan: ImplementationPlan): string {
  if (plan.content === undefined) return ''
  const style = plan.content.style
  return `
## Content

Style: **${style.setting}**, ${style.finish} finish — read from what you described,
recorded in the plan, and assumed nowhere else.

| Path | What lives here |
|---|---|
| \`kei-mmo/content/manifest.json\` | Every asset as a versioned record: prop specs, the rig, motion clips${plan.content.selections.some((selection) => selection.area === 'audio') ? ', audio cues' : ''}. |
| \`kei-mmo/content/pipelines.json\` | The pipeline workflows, and the external generators with their honest statuses. |
| \`kei-mmo/content/check.mjs\` | Your admission gate: \`bun run content:check\` (or \`node kei-mmo/content/check.mjs\`). A declared file that is missing, unlicensed, or empty fails the check — so does a cut-scene referencing a clip that is not admitted. |
${plan.content.selections.some((selection) => selection.area === 'cutscene') ? '| `kei-mmo/content/cutscenes/` | Assembled cut-scene documents. Played by `src/shared/cutscene.ts`, which is yours and imports nothing. |\n' : ''}
Starter content is previs grade on purpose: primitive props, blocking clips,
synthesized cue voices. Nothing in the manifest is loaded by the client yet —
the \`content-pipeline\` plan step is where that lands. Replace records as real
assets arrive; the check script holds every replacement to the same bar.
`
}
// ── The page ─────────────────────────────────────────────────────────────────

function page(project: ProjectIdentity, solid: boolean): string {
  const title = escapeHtml(project.title)
  const caption = solid
    ? 'Babylon.js scene — the plan’s first frame'
    : 'Canvas construction frame — not a renderer yet'

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: dark; }
      html, body { margin: 0; height: 100%; background: #0b0d12; color: #d7dce5; }
      body { font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      #game { display: block; width: 100vw; height: 100vh; touch-action: none; outline: none; }
      #hud {
        position: fixed; left: 14px; top: 14px; pointer-events: none;
        padding: 9px 12px; background: rgba(11, 13, 18, 0.74); border: 1px solid #232936;
      }
      #hud strong { font-weight: 600; letter-spacing: 0.02em; }
      #hud span { display: block; color: #8b95a7; }
    </style>
  </head>
  <body>
    <canvas id="game" tabindex="0"></canvas>
    <div id="hud">
      <strong>${title}</strong>
      <span>${caption}</span>
      <span id="status">starting</span>
    </div>
    <script type="module" src="./${CLIENT_BUNDLE}"></script>
  </body>
</html>
`
}
// ── The build ────────────────────────────────────────────────────────────────

function buildScript(): string {
  return `#!/usr/bin/env bun
/**
 * The build. Bundles the client into ${OUTPUT_DIRECTORY}/${CLIENT_BUNDLE} and copies
 * static/ over the top of it, so the output directory is the whole site.
 *
 * Run it directly (\`bun run build\`) and it prints one JSON line on success and
 * one on failure, each with a code — this is meant to be read by a script as
 * often as by a person. The dev server imports \`build()\` from here rather than
 * shelling out, so there is exactly one definition of what building means.
 *
 * This file is yours. Its only dependency is Bun's bundler.
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const OUT_DIR = join(ROOT, '${OUTPUT_DIRECTORY}')
export const ENTRY = join(ROOT, '${CLIENT_PATH}')
export const HEADLESS_ENTRY = join(ROOT, '${HEADLESS_CLIENT_PATH}')

/**
 * A failure with a code on it. Every exit path in this project reports one, so
 * a supervising script never has to match on English.
 */
export class BuildFailure extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'BuildFailure'
    this.code = code
  }
}

export async function build({ minify = true } = {}) {
  const started = Date.now()
  if (typeof Bun === 'undefined') {
    throw new BuildFailure(
      'bun_required',
      'This build uses Bun\\'s bundler. Install Bun 1.3.0 or later and run: bun run build',
    )
  }

  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(join(OUT_DIR, 'client'), { recursive: true })

  const bundled = await Bun.build({
    entrypoints: [ENTRY],
    outdir: join(OUT_DIR, 'client'),
    target: 'browser',
    format: 'esm',
    minify,
    sourcemap: 'linked',
  })
  if (!bundled.success) {
    throw new BuildFailure('client_bundle_failed', bundled.logs.map((log) => String(log)).join('\\n'))
  }

  const server = await Bun.build({
    entrypoints: [join(ROOT, '${SERVER_PATH}')],
    outdir: join(OUT_DIR, 'server'),
    target: 'bun',
    format: 'esm',
    minify,
    sourcemap: 'linked',
  })
  if (!server.success) {
    throw new BuildFailure('server_bundle_failed', server.logs.map((log) => String(log)).join('\\n'))
  }

  const headless = await Bun.build({
    entrypoints: [HEADLESS_ENTRY],
    outdir: join(OUT_DIR, 'headless'),
    target: 'bun',
    format: 'esm',
    minify,
    sourcemap: 'linked',
  })
  if (!headless.success) {
    throw new BuildFailure('headless_bundle_failed', headless.logs.map((log) => String(log)).join('\\n'))
  }

  // static/ last: it owns index.html, and the page is what ties the bundle to a
  // canvas. Copying it over the bundle directory keeps the output one tree.
  await cp(join(ROOT, 'static'), OUT_DIR, { recursive: true })

  const bundle = join(OUT_DIR, '${CLIENT_BUNDLE}')
  const info = await stat(bundle).catch(() => null)
  if (info === null || info.size === 0) {
    throw new BuildFailure('bundle_missing', \`the bundler reported success but \${bundle} is missing or empty\`)
  }

  const headlessBundle = join(OUT_DIR, '${HEADLESS_CLIENT_BUNDLE}')
  const headlessInfo = await stat(headlessBundle).catch(() => null)
  if (headlessInfo === null || headlessInfo.size === 0) {
    throw new BuildFailure(
      'headless_bundle_missing',
      \`the bundler reported success but \${headlessBundle} is missing or empty\`,
    )
  }

  return {
    outDir: '${OUTPUT_DIRECTORY}',
    entry: '${CLIENT_BUNDLE}',
    bytes: info.size,
    headlessEntry: '${HEADLESS_CLIENT_BUNDLE}',
    headlessBytes: headlessInfo.size,
    ms: Date.now() - started,
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url

if (invokedDirectly) {
  try {
    const result = await build()
    process.stdout.write(JSON.stringify({ event: 'built', ...result }) + '\\n')
  } catch (error) {
    const code = error instanceof BuildFailure ? error.code : 'build_failed'
    process.stderr.write(
      JSON.stringify({ event: 'error', code, message: String(error && error.message ? error.message : error) }) + '\\n',
    )
    process.exit(1)
  }
}
`
}
// ── The shared simulation ────────────────────────────────────────────────────

function simulation(): string {
  return `/**
 * Pure movement rules shared by the authoritative shard and renderer.
 *
 * The browser currently renders server snapshots; prediction and reconciliation
 * are deliberately deferred. Sharing this pure function keeps that later path
 * possible without making the browser authoritative today.
 *
 * Keep it pure. No fetch, no Date.now(), no Math.random() — a seeded generator
 * passed in, or the replay tests stop meaning anything.
 */

export interface PlayerInput {
  /** Monotonic per player. The server echoes the last one it applied. */
  readonly seq: number
  readonly moveX: number
  readonly moveY: number
  readonly buttons: number
}

export interface PlayerState {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly xp: number
  readonly level: number
}

export interface WorldState {
  readonly tick: number
  readonly players: Readonly<Record<string, PlayerState>>
}

export const TICK_HZ = 20
export const STEP_MS = 1000 / TICK_HZ

/** The offline construction avatar. Network identities are always server-assigned. */
export const LOCAL_PLAYER = 'local'

/** Metres per second. A placeholder, and the first number the plan will argue with. */
export const MOVE_SPEED = 4
export const INTERACT_BUTTON = 1
export const XP_PER_INTERACTION = 10
export const XP_PER_LEVEL = 10

/** Progression is derived by the server; clients never submit XP or levels. */
export function levelForXp(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1
}

export function emptyWorld(withLocal = true): WorldState {
  return { tick: 0, players: withLocal ? { [LOCAL_PLAYER]: { x: 0, y: 0, z: 0, xp: 0, level: 1 } } : {} }
}

/** Add one server-assigned or durably resumed player without mutating a prior snapshot. */
export function joinWorld(state: WorldState, playerId: string, restored?: PlayerState): WorldState {
  if (state.players[playerId] !== undefined) return state
  const slot = Object.keys(state.players).length
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: restored ?? { x: slot * 1.5, y: 0, z: 0, xp: 0, level: 1 },
    },
  }
}

/** Remove a disconnected player without trusting a client to name anybody. */
export function leaveWorld(state: WorldState, playerId: string): WorldState {
  if (state.players[playerId] === undefined) return state
  const players = { ...state.players }
  delete players[playerId]
  return { ...state, players }
}

/**
 * One fixed step. Movement is the only rule here, and it is deliberately the
 * smallest one that can be wrong in a visible way. The shard alone calls it
 * with accepted player intent; collision remains deliberately deferred.
 */
export function step(
  state: WorldState,
  inputs: Readonly<Record<string, PlayerInput>>,
  dtSeconds: number,
): WorldState {
  const players: Record<string, PlayerState> = {}
  for (const [id, player] of Object.entries(state.players)) {
    const input = inputs[id]
    if (input === undefined) {
      players[id] = player
      continue
    }
    const length = Math.hypot(input.moveX, input.moveY)
    const scale = length > 1 ? 1 / length : 1
    const xp = player.xp + ((input.buttons & INTERACT_BUTTON) !== 0 ? XP_PER_INTERACTION : 0)
    players[id] = {
      x: player.x + input.moveX * scale * MOVE_SPEED * dtSeconds,
      y: player.y,
      z: player.z + input.moveY * scale * MOVE_SPEED * dtSeconds,
      xp,
      level: levelForXp(xp),
    }
  }
  return { tick: state.tick + 1, players }
}
`
}
// ── The clients ──────────────────────────────────────────────────────────────

function client3d(project: ProjectIdentity): string {
  // The title is data, not source. A name with `*/` in it would otherwise close
  // the comment above and put whatever follows into the file as code.
  return `/**
 * Client entry: the first frame, in Babylon.js.
 *
 * A ground plane, one light, an orbit camera, and a box standing in for the
 * players, drawn from server-authored snapshots. The render loop never mutates
 * simulation state; it only projects the latest accepted snapshot.
 *
 * Assets, animation, prediction, and reconciliation remain deferred. Durable
 * identity/position/progression live behind the server, not in this renderer.
 *
 * This file is yours. It imports Babylon and the project's own simulation.
 */

import { Engine } from '@babylonjs/core/Engines/engine.js'
import { Scene } from '@babylonjs/core/scene.js'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js'
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js'
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js'

import { connectGame, RESUME_STORAGE_KEY } from './connection.js'
import { emptyWorld, STEP_MS, type WorldState } from '../shared/simulation.js'

export const TITLE = ${JSON.stringify(project.title)}

export interface Client {
  /** Disposes the engine and unhooks the resize listener. */
  readonly stop: () => void
  /** The current world. Read it; the loop owns writing it. */
  readonly world: () => WorldState
  /** Replace the rendered world with the latest server-authored snapshot. */
  readonly replaceWorld: (next: WorldState) => void
}

function flat(scene: Scene, name: string, colour: Color3): StandardMaterial {
  const material = new StandardMaterial(name, scene)
  material.diffuseColor = colour
  // Zero specular: one hemispheric light plus a specular highlight reads as
  // wet plastic, and nothing here has earned a highlight yet.
  material.specularColor = new Color3(0, 0, 0)
  return material
}

export function start(canvas: HTMLCanvasElement, onTick?: (world: WorldState) => void): Client {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false }, false)
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.043, 0.051, 0.071, 1)

  const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3.2, 22, new Vector3(0, 1, 0), scene)
  camera.lowerRadiusLimit = 6
  camera.upperRadiusLimit = 60
  camera.wheelDeltaPercentage = 0.02
  camera.attachControl(canvas, true)

  const sun = new HemisphericLight('sun', new Vector3(0.35, 1, 0.2), scene)
  sun.intensity = 0.95

  const ground = CreateGround('ground', { width: 48, height: 48, subdivisions: 2 }, scene)
  ground.material = flat(scene, 'ground-material', new Color3(0.16, 0.18, 0.22))

  // Four posts, purely so the camera has something to orbit against and a
  // rotation is visible. Replace them with admitted props from the manifest.
  const postMaterial = flat(scene, 'post-material', new Color3(0.29, 0.33, 0.4))
  for (const [x, z] of [[8, 8], [-8, 8], [8, -8], [-8, -8]] as const) {
    const post = CreateCylinder('post', { height: 3.2, diameter: 0.34 }, scene)
    post.position.set(x, 1.6, z)
    post.material = postMaterial
  }

  const avatarMaterial = flat(scene, 'avatar-material', new Color3(0.55, 0.72, 0.85))
  const avatars = new Map<string, ReturnType<typeof CreateBox>>()

  const syncAvatars = (): void => {
    for (const [id, player] of Object.entries(world.players)) {
      let avatar = avatars.get(id)
      if (avatar === undefined) {
        avatar = CreateBox('avatar-' + id, { width: 0.7, height: 1.7, depth: 0.7 }, scene)
        avatar.material = avatarMaterial
        avatars.set(id, avatar)
      }
      avatar.position.set(player.x, 0.85 + player.y, player.z)
    }
    for (const [id, avatar] of avatars) {
      if (world.players[id] !== undefined) continue
      avatar.dispose()
      avatars.delete(id)
    }
  }

  let world = emptyWorld()

  engine.runRenderLoop(() => {
    syncAvatars()
    scene.render()
  })

  const onResize = (): void => engine.resize()
  window.addEventListener('resize', onResize)

  return {
    stop: () => {
      window.removeEventListener('resize', onResize)
      engine.stopRenderLoop()
      engine.dispose()
    },
    world: () => world,
    replaceWorld: (next) => {
      world = next
      if (onTick !== undefined) onTick(world)
    },
  }
}

const canvas = document.getElementById('game')
const status = document.getElementById('status')

if (canvas instanceof HTMLCanvasElement) {
  let networked = false
  let shown = -1
  let ownPlayerId: string | undefined
  const client = start(canvas, (world) => {
    // The dirty check, from the first line of HUD code: writing textContent
    // every frame is layout work every frame.
    if (status === null || world.tick === shown) return
    shown = world.tick
    const own = ownPlayerId === undefined ? undefined : world.players[ownPlayerId]
    status.textContent = Object.keys(world.players).length + ' players · ' + (networked ? 'connected' : 'offline') +
      ' · level ' + (own?.level ?? 1) + ' · XP ' + (own?.xp ?? 0) + ' · tick ' + world.tick
  })
  let savedToken: string | undefined
  try { savedToken = localStorage.getItem(RESUME_STORAGE_KEY) ?? undefined } catch { /* storage can be disabled */ }
  void connectGame(window.location.href, savedToken).then((connection) => {
    networked = true
    ownPlayerId = connection.playerId
    try { localStorage.setItem(RESUME_STORAGE_KEY, connection.resumeToken) } catch { /* the live session still works */ }
    connection.onSnapshot((world) => client.replaceWorld(world))
    const keys = new Set<string>()
    let sequence = 0
    let interact = false
    const onKeyDown = (event: KeyboardEvent): void => {
      keys.add(event.code)
      if (event.code === 'KeyE' && !event.repeat) interact = true
    }
    const onKeyUp = (event: KeyboardEvent): void => { keys.delete(event.code) }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    const input = setInterval(() => {
      connection.sendInput({
        seq: sequence += 1,
        moveX: Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')),
        moveY: Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp')),
        buttons: Number(interact),
      })
      interact = false
    }, STEP_MS)
    window.addEventListener('beforeunload', () => {
      clearInterval(input)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      connection.close()
    }, { once: true })
  }).catch(() => { if (status !== null) status.textContent = 'game server unavailable' })
} else if (status !== null) {
  status.textContent = 'no <canvas id="game"> on the page'
}
`
}
function client2d(project: ProjectIdentity): string {
  return `/**
 * Client entry: a construction frame, not a renderer.
 *
 * Read that literally. What this draws is a grid culled to the view rectangle,
 * a camera transform applied once per frame, and one marker for every player
 * in the server snapshot. There is no atlas, sprite, tile set, or frame table —
 * the \`render-2d\` capability packet in the plan describes all of those, and
 * every one of them is work this scaffold has not done.
 *
 * What it does establish is the shape the rest hangs on: one place that
 * converts server-authored world units to screen, with rendering kept separate
 * from the authoritative tick.
 *
 * This file is yours, and it imports only project-owned networking and
 * simulation modules.
 */

import { connectGame, RESUME_STORAGE_KEY } from './connection.js'
import { emptyWorld, STEP_MS, type WorldState } from '../shared/simulation.js'

export const TITLE = ${JSON.stringify(project.title)}

/** World units per tile. The one number the grid and the camera both read. */
export const TILE = 32

export interface Camera {
  x: number
  y: number
  zoom: number
}

export interface Client {
  readonly stop: () => void
  readonly world: () => WorldState
  readonly replaceWorld: (next: WorldState) => void
}

export function start(canvas: HTMLCanvasElement, onTick?: (world: WorldState) => void): Client {
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true })
  if (context === null) throw new Error('This browser gave no 2D context for the canvas.')

  const camera: Camera = { x: 0, y: 0, zoom: 1 }
  let world = emptyWorld()
  let frame = 0
  let running = true

  function resize(): void {
    const ratio = Math.min(window.devicePixelRatio, 2)
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * ratio))
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * ratio))
  }

  function draw(): void {
    const width = canvas.width
    const height = canvas.height
    const zoom = camera.zoom * Math.min(window.devicePixelRatio, 2)

    context.setTransform(1, 0, 0, 1, 0, 0)
    context.fillStyle = '#0b0d12'
    context.fillRect(0, 0, width, height)

    // The camera, applied once per frame rather than once per drawn thing.
    context.setTransform(zoom, 0, 0, zoom, -camera.x * zoom + width / 2, -camera.y * zoom + height / 2)

    // Culled to the view rectangle. A loop over the whole map is the other way
    // a 2D MMO stops being cheap to run, and it is not worth learning twice.
    const halfWidth = width / (2 * zoom)
    const halfHeight = height / (2 * zoom)
    const firstX = Math.floor((camera.x - halfWidth) / TILE) - 1
    const lastX = Math.ceil((camera.x + halfWidth) / TILE) + 1
    const firstY = Math.floor((camera.y - halfHeight) / TILE) - 1
    const lastY = Math.ceil((camera.y + halfHeight) / TILE) + 1

    context.lineWidth = 1 / zoom
    context.strokeStyle = '#1b2030'
    context.beginPath()
    for (let x = firstX; x <= lastX; x += 1) {
      context.moveTo(x * TILE, firstY * TILE)
      context.lineTo(x * TILE, lastY * TILE)
    }
    for (let y = firstY; y <= lastY; y += 1) {
      context.moveTo(firstX * TILE, y * TILE)
      context.lineTo(lastX * TILE, y * TILE)
    }
    context.stroke()

    for (const player of Object.values(world.players)) {
      context.fillStyle = '#8cb8d9'
      context.fillRect(player.x * TILE - 8, player.z * TILE - 8, 16, 16)
    }
  }

  function tick(): void {
    if (!running) return
    frame = requestAnimationFrame(tick)

    resize()
    draw()
  }

  frame = requestAnimationFrame(tick)
  const onResize = (): void => resize()
  window.addEventListener('resize', onResize)

  return {
    stop: () => {
      running = false
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    },
    world: () => world,
    replaceWorld: (next) => {
      world = next
      if (onTick !== undefined) onTick(world)
    },
  }
}

const canvas = document.getElementById('game')
const status = document.getElementById('status')

if (canvas instanceof HTMLCanvasElement) {
  let networked = false
  let shown = -1
  let ownPlayerId: string | undefined
  const client = start(canvas, (world) => {
    if (status === null || world.tick === shown) return
    shown = world.tick
    const own = ownPlayerId === undefined ? undefined : world.players[ownPlayerId]
    status.textContent = Object.keys(world.players).length + ' players · ' + (networked ? 'connected' : 'offline') +
      ' · level ' + (own?.level ?? 1) + ' · XP ' + (own?.xp ?? 0) + ' · tick ' + world.tick
  })
  let savedToken: string | undefined
  try { savedToken = localStorage.getItem(RESUME_STORAGE_KEY) ?? undefined } catch { /* storage can be disabled */ }
  void connectGame(window.location.href, savedToken).then((connection) => {
    networked = true
    ownPlayerId = connection.playerId
    try { localStorage.setItem(RESUME_STORAGE_KEY, connection.resumeToken) } catch { /* the live session still works */ }
    connection.onSnapshot((world) => client.replaceWorld(world))
    const keys = new Set<string>()
    let sequence = 0
    let interact = false
    const onKeyDown = (event: KeyboardEvent): void => {
      keys.add(event.code)
      if (event.code === 'KeyE' && !event.repeat) interact = true
    }
    const onKeyUp = (event: KeyboardEvent): void => { keys.delete(event.code) }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    const input = setInterval(() => {
      connection.sendInput({
        seq: sequence += 1,
        moveX: Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')),
        moveY: Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp')),
        buttons: Number(interact),
      })
      interact = false
    }, STEP_MS)
    window.addEventListener('beforeunload', () => {
      clearInterval(input)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      connection.close()
    }, { once: true })
  }).catch(() => { if (status !== null) status.textContent = 'game server unavailable' })
} else if (status !== null) {
  status.textContent = 'no <canvas id="game"> on the page'
}
`
}
