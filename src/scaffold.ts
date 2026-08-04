/**
 * The files a scaffolded project is actually made of.
 *
 * This used to be four stubs and a `package.json` whose `dev` script printed
 * "wire this up" and exited 1. That was honest about being unfinished and
 * useless as a starting point: nothing installed, nothing built, nothing ran.
 *
 * What is here now is the smallest project that installs, builds, and serves
 * itself with no manual edit — a page, a client that draws, a static dev server,
 * a build script, and the shared simulation both sides import. Every one of
 * those files belongs to the project. None of them imports this harness, and
 * deleting the harness from the machine changes nothing about them.
 *
 * What is deliberately *not* here: networking, server authority, persistence,
 * the Kei ledger, and anything that could be called finished art. Those are the
 * plan's steps, and a scaffold that pre-wrote them would be guessing at the
 * design the plan exists to state.
 */

import { contentProjectFiles, CONTENT_CHECK_PATH } from './content-project.js'
import { PLAN_JSON_PATH, PLAN_MARKDOWN_PATH, type ImplementationPlan } from './plan.js'
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
export const SERVER_PATH = 'src/server/main.ts'
export const SIMULATION_PATH = 'src/shared/simulation.ts'
export const DEV_SERVER_PATH = 'src/server/dev-server.mjs'
export const BUILD_SCRIPT_PATH = 'scripts/build.mjs'
export const PAGE_PATH = 'static/index.html'

/** Where `bun run build` puts the client, and what the dev server serves. */
export const OUTPUT_DIRECTORY = 'dist'
/** The bundle path inside it, relative to the page. */
export const CLIENT_BUNDLE = 'client/main.js'

/** The one line a supervising process is allowed to depend on. */
export const DEV_READY_EVENT = 'ready'
export const DEV_SERVICE = 'kei-dev-server'
export const DEFAULT_DEV_PORT = 5173

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

  return Object.freeze([
    { path: 'package.json', contents: manifest(project, solid, contentFiles.length > 0) },
    { path: 'README.md', contents: readme(project, plan) },
    { path: '.gitignore', contents: 'node_modules/\ndist/\n*.sqlite*\n.DS_Store\n' },
    { path: 'tsconfig.json', contents: tsconfig() },
    { path: PAGE_PATH, contents: page(project, solid) },
    { path: BUILD_SCRIPT_PATH, contents: buildScript() },
    { path: SIMULATION_PATH, contents: simulation() },
    { path: CLIENT_PATH, contents: solid ? client3d(project) : client2d(project) },
    { path: SERVER_PATH, contents: server() },
    { path: DEV_SERVER_PATH, contents: devServer() },
    ...contentFiles,
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
      ...(withContent ? { 'content:check': `node ${CONTENT_CHECK_PATH}` } : {}),
    },
    ...(solid ? { dependencies: { [RENDERER_PACKAGE]: RENDERER_RANGE } } : {}),
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
rectangle, and draws one marker where the local player is. That is the skeleton
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

\`bun run dev\` builds the client and serves \`${OUTPUT_DIRECTORY}/\` on
http://127.0.0.1:${DEFAULT_DEV_PORT}. It prints one JSON line when it is listening —

\`\`\`json
{"event":"${DEV_READY_EVENT}","service":"${DEV_SERVICE}","url":"http://127.0.0.1:${DEFAULT_DEV_PORT}/","port":${DEFAULT_DEV_PORT}}
\`\`\`

— so a script can wait for the server instead of sleeping and hoping. Set
\`PORT=0\` to take whatever port is free and read the real one back off that line.

\`bun run build\` produces the same bundle without serving it, and prints one JSON
line of its own.

## What is here, and what is not

${draws}

\`${SIMULATION_PATH}\` is the fixed-step \`step()\` both sides import, and the
client already runs it on an accumulator, so the frame rate and the simulation
rate are separate from the first commit.

Nothing here is networked. \`${SERVER_PATH}\` owns a tick and a world and listens
on no socket; there is no session, no replication, no persistence, and no
economy. Those are plan steps, not omissions the scaffold is hiding.

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
| \`src/shared/\` | The simulation, and the wire schema. Imported by both sides. |
| \`src/client/\` | Rendering, input, and prediction. Owns no authority. |
| \`src/server/\` | A local fixed-tick construction seam. No socket, authority, persistence, or settlement yet. |
| \`${DEV_SERVER_PATH}\` | The static dev server. Plain \`node:http\`, no dependency. |
| \`${BUILD_SCRIPT_PATH}\` | The build. Bundles the client and copies \`static/\`. |
| \`${PAGE_PATH}\` | The page and the canvas the client takes over. |

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

  // static/ last: it owns index.html, and the page is what ties the bundle to a
  // canvas. Copying it over the bundle directory keeps the output one tree.
  await cp(join(ROOT, 'static'), OUT_DIR, { recursive: true })

  const bundle = join(OUT_DIR, '${CLIENT_BUNDLE}')
  const info = await stat(bundle).catch(() => null)
  if (info === null || info.size === 0) {
    throw new BuildFailure('bundle_missing', \`the bundler reported success but \${bundle} is missing or empty\`)
  }

  return {
    outDir: '${OUTPUT_DIRECTORY}',
    entry: '${CLIENT_BUNDLE}',
    bytes: info.size,
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

// ── The dev server ───────────────────────────────────────────────────────────

function devServer(): string {
  return `#!/usr/bin/env bun
/**
 * The dev server: build once, then serve ${OUTPUT_DIRECTORY}/ over plain node:http.
 *
 * It prints exactly one machine-readable line when it is listening —
 *
 *   {"event":"${DEV_READY_EVENT}","service":"${DEV_SERVICE}","url":"...","host":"...","port":N,"pid":N}
 *
 * — and nothing else on stdout. A supervising script waits for that line rather
 * than sleeping for a guessed number of seconds, and with PORT=0 it learns the
 * port it actually got. Failures go to stderr as one JSON object with a code.
 *
 * PORT and HOST are read from the environment. This binds to 127.0.0.1 by
 * default and is a development server: no caching, no compression, no TLS, and
 * nothing here is meant to face the internet.
 *
 * This file is yours. It imports the project's own build and nothing else.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'

import { build, OUT_DIR } from '../../scripts/build.mjs'

const HOST = process.env.HOST ?? '127.0.0.1'
const PORT = Number.parseInt(process.env.PORT ?? '${DEFAULT_DEV_PORT}', 10)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
}

function fail(code, message) {
  process.stderr.write(JSON.stringify({ event: 'error', code, message }) + '\\n')
  process.exit(1)
}

/**
 * A URL path to a file inside the output directory, or null. The check is on
 * the resolved path, because that is the only form in which \`..\`, a percent
 * escape, and a backslash all mean the same thing.
 */
function fileFor(urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const wanted = decoded.endsWith('/') ? decoded + 'index.html' : decoded
  const target = resolve(OUT_DIR, '.' + wanted)
  if (target !== OUT_DIR && !target.startsWith(OUT_DIR + sep)) return null
  return target
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://' + (request.headers.host ?? HOST))

  if (url.pathname === '/__dev/status') {
    response.writeHead(200, { 'content-type': TYPES['.json'] })
    response.end(JSON.stringify({ service: '${DEV_SERVICE}', root: '${OUTPUT_DIRECTORY}', entry: '${CLIENT_BUNDLE}' }))
    return
  }

  const target = fileFor(url.pathname)
  if (target === null) {
    response.writeHead(400, { 'content-type': TYPES['.json'] })
    response.end(JSON.stringify({ event: 'error', code: 'bad_path', path: url.pathname }))
    return
  }

  stat(target)
    .then((info) => (info.isDirectory() ? readFile(join(target, 'index.html')) : readFile(target)))
    .then((body) => {
      response.writeHead(200, {
        'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
        'content-length': body.byteLength,
        'cache-control': 'no-store',
      })
      response.end(body)
    })
    .catch(() => {
      response.writeHead(404, { 'content-type': TYPES['.json'] })
      response.end(JSON.stringify({ event: 'error', code: 'not_found', path: url.pathname }))
    })
})

server.on('error', (error) => fail('listen_failed', String(error && error.message ? error.message : error)))

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    // A held-open keep-alive socket must not outlive the signal.
    server.closeAllConnections?.()
  })
}

try {
  await build({ minify: false })
} catch (error) {
  fail(
    error && error.code ? error.code : 'build_failed',
    String(error && error.message ? error.message : error),
  )
}

server.listen(PORT, HOST, () => {
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : PORT
  const url = 'http://' + HOST + ':' + port + '/'
  process.stdout.write(
    JSON.stringify({
      event: '${DEV_READY_EVENT}',
      service: '${DEV_SERVICE}',
      url,
      host: HOST,
      port,
      root: '${OUTPUT_DIRECTORY}',
      pid: process.pid,
    }) + '\\n',
  )
})
`
}

// ── The shared simulation ────────────────────────────────────────────────────

function simulation(): string {
  return `/**
 * The simulation both sides run.
 *
 * Client and server import this same function. That is what makes prediction
 * possible and what keeps the server the only authority: the client guesses
 * with the same rules, then accepts a correction.
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
}

export interface WorldState {
  readonly tick: number
  readonly players: Readonly<Record<string, PlayerState>>
}

export const TICK_HZ = 20
export const STEP_MS = 1000 / TICK_HZ

/** The id the client gives the one avatar it draws before there is a session. */
export const LOCAL_PLAYER = 'local'

/** Metres per second. A placeholder, and the first number the plan will argue with. */
export const MOVE_SPEED = 4

export function emptyWorld(): WorldState {
  return { tick: 0, players: { [LOCAL_PLAYER]: { x: 0, y: 0, z: 0 } } }
}

/**
 * One fixed step. Movement is the only rule here, and it is deliberately the
 * dumbest one that can be wrong in a visible way: no collision, no validation,
 * no authority. Plan step "Project shape" is where this becomes the real thing.
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
    players[id] = {
      x: player.x + input.moveX * MOVE_SPEED * dtSeconds,
      y: player.y,
      z: player.z + input.moveY * MOVE_SPEED * dtSeconds,
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
 * player, drawn from a world the shared step() advances on a fixed accumulator.
 * The render loop never mutates simulation state and the simulation never reads
 * a frame time — that separation is the whole point of doing it this early.
 *
 * What is not here: no asset is loaded, no clip plays, nothing is networked,
 * and the box is a box. The plan's "First frame" and "A player you can move"
 * steps are where this stops being scaffolding.
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

import { emptyWorld, LOCAL_PLAYER, STEP_MS, step, type WorldState } from '../shared/simulation.js'

export const TITLE = ${JSON.stringify(project.title)}

export interface Client {
  /** Disposes the engine and unhooks the resize listener. */
  readonly stop: () => void
  /** The current world. Read it; the loop owns writing it. */
  readonly world: () => WorldState
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

  const avatar = CreateBox('avatar', { width: 0.7, height: 1.7, depth: 0.7 }, scene)
  avatar.position.set(0, 0.85, 0)
  avatar.material = flat(scene, 'avatar-material', new Color3(0.55, 0.72, 0.85))

  let world = emptyWorld()
  let accumulator = 0

  engine.runRenderLoop(() => {
    // getDeltaTime() is wall-clock milliseconds since the last frame. It feeds
    // the accumulator and never the simulation, so a slow frame costs frames
    // and not ticks.
    accumulator += Math.min(engine.getDeltaTime(), 250)
    let advanced = false
    while (accumulator >= STEP_MS) {
      world = step(world, {}, STEP_MS / 1000)
      accumulator -= STEP_MS
      advanced = true
    }

    const player = world.players[LOCAL_PLAYER]
    if (player !== undefined) avatar.position.set(player.x, 0.85 + player.y, player.z)
    if (advanced && onTick !== undefined) onTick(world)

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
  }
}

const canvas = document.getElementById('game')
const status = document.getElementById('status')

if (canvas instanceof HTMLCanvasElement) {
  let shown = -1
  start(canvas, (world) => {
    // The dirty check, from the first line of HUD code: writing textContent
    // every frame is layout work every frame.
    if (status === null || world.tick === shown) return
    shown = world.tick
    status.textContent = 'tick ' + world.tick
  })
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
 * a camera transform applied once per frame, and one marker where the local
 * player is. There is no atlas, no sprite, no tile set, and no frame table —
 * the \`render-2d\` capability packet in the plan describes all of those, and
 * every one of them is work this scaffold has not done.
 *
 * What it does establish is the shape the rest hangs on: one place that
 * converts world units to screen, a fixed-step accumulator separate from the
 * frame, and a clamped delta so a backgrounded tab does not fast-forward the
 * world on return.
 *
 * This file is yours, and it imports nothing but the project's own simulation.
 */

import { emptyWorld, LOCAL_PLAYER, STEP_MS, step, type WorldState } from '../shared/simulation.js'

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
}

export function start(canvas: HTMLCanvasElement, onTick?: (world: WorldState) => void): Client {
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true })
  if (context === null) throw new Error('This browser gave no 2D context for the canvas.')

  const camera: Camera = { x: 0, y: 0, zoom: 1 }
  let world = emptyWorld()
  let accumulator = 0
  let last = performance.now()
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

    const player = world.players[LOCAL_PLAYER]
    if (player !== undefined) {
      context.fillStyle = '#8cb8d9'
      context.fillRect(player.x * TILE - 8, player.z * TILE - 8, 16, 16)
    }
  }

  function tick(now: number): void {
    if (!running) return
    frame = requestAnimationFrame(tick)

    // Clamped: an unclamped tab-restore delta would run hundreds of steps in
    // one frame, which reads as the world teleporting.
    accumulator += Math.min(now - last, 250)
    last = now
    let advanced = false
    while (accumulator >= STEP_MS) {
      world = step(world, {}, STEP_MS / 1000)
      accumulator -= STEP_MS
      advanced = true
    }

    resize()
    draw()
    if (advanced && onTick !== undefined) onTick(world)
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
  }
}

const canvas = document.getElementById('game')
const status = document.getElementById('status')

if (canvas instanceof HTMLCanvasElement) {
  let shown = -1
  start(canvas, (world) => {
    if (status === null || world.tick === shown) return
    shown = world.tick
    status.textContent = 'tick ' + world.tick
  })
} else if (status !== null) {
  status.textContent = 'no <canvas id="game"> on the page'
}
`
}

function server(): string {
  return `/**
 * Shard entry. Owns the tick, and — once the plan's networking step lands — the
 * truth and every economic action.
 *
 * It listens on nothing. There is no socket, no session, no validation, and no
 * persistence in this file yet, and it does not pretend otherwise: what it has
 * is the accumulator loop that the authoritative server is built out of.
 *
 * This file is yours.
 */

import { emptyWorld, STEP_MS, step, type PlayerInput, type WorldState } from '../shared/simulation.js'

export interface Shard {
  readonly state: WorldState
  /** Advances by whole steps, keeping the remainder for the next call. */
  readonly advance: (elapsedMs: number) => void
  /** Queues one input for the next step. Validation belongs here, later. */
  readonly enqueue: (playerId: string, input: PlayerInput) => void
}

export function createShard(): Shard {
  let state: WorldState = emptyWorld()
  let accumulator = 0
  let pending: Record<string, PlayerInput> = {}

  return {
    get state() {
      return state
    },
    advance(elapsedMs: number) {
      accumulator += elapsedMs
      while (accumulator >= STEP_MS) {
        state = step(state, pending, STEP_MS / 1000)
        pending = {}
        accumulator -= STEP_MS
      }
    },
    enqueue(playerId: string, input: PlayerInput) {
      pending[playerId] = input
    },
  }
}
`
}
