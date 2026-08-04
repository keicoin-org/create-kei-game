/**
 * The catalog of things this harness knows how to have built, written so that a
 * model can act on a packet without going looking for the API first.
 *
 * A packet is not a topic. "Animation" is a topic and it is useless in a plan:
 * it names a subject and leaves the model to invent an approach, which is where
 * plausible-looking nonsense comes from. A packet states what must already
 * exist before the work can start, which library or platform API does it, the
 * exact calls that do it, and how the developer will know it worked. That is
 * the difference between a table of contents and something that can be
 * executed.
 *
 * Everything named below is either a real, stable API of the named dependency,
 * or — where no library owns the problem — a function signature this harness
 * requires the project to define itself. The second kind is marked as such in
 * the packet's tools, because inventing an SDK that does not exist is the exact
 * failure this file is shaped to avoid.
 */

export const CAPABILITY_DOMAINS = [
  'rendering',
  'animation',
  'shaders',
  'post-processing',
  'networking',
  'persistence',
  'economy',
  'ui',
  'audio',
  'content',
  'testing',
  'deployment',
] as const

export type CapabilityDomain = (typeof CAPABILITY_DOMAINS)[number]

/** `2d` and `3d` packets are mutually exclusive; `any` applies to both. */
export type CapabilityDimension = '2d' | '3d' | 'any'

/**
 * What a packet actually is, per SPEC §11.3: `available` is implemented and
 * exercised by a test; `planned` is specified and not implemented; `absent` is
 * not offered, with the reason. Only `available` may ever enter a plan — the
 * other two appear in the deferred list, naming their status, so the plan says
 * out loud what it is not promising.
 */
export type CapabilityStatus = 'available' | 'planned' | 'absent'

export interface CapabilityMethod {
  /** The call itself, spelled the way it is written in a source file. */
  readonly call: string
  /** What that call is for, in one line. */
  readonly does: string
}

export interface CapabilityPacket {
  readonly id: string
  readonly domain: CapabilityDomain
  readonly title: string
  readonly summary: string
  readonly dimension: CapabilityDimension
  readonly status: CapabilityStatus
  /** Required whenever the status is not `available`: why not, honestly. */
  readonly statusReason?: string
  /**
   * Whether every plan of the matching dimension gets this packet. When false,
   * one of `signals` has to appear in the intent, and the plan records both the
   * hit and the miss.
   */
  readonly core: boolean
  /** Lowercase substrings that pull an optional packet into a plan. */
  readonly signals: readonly string[]
  /** What has to be true before this work can start. */
  readonly prerequisites: readonly string[]
  /** Packages, platform APIs, and harness tools this uses by name. */
  readonly tools: readonly string[]
  readonly methods: readonly CapabilityMethod[]
  /** Observable outcomes. Each one is a thing somebody can go and check. */
  readonly acceptance: readonly string[]
}

export const CAPABILITY_PACKETS: readonly CapabilityPacket[] = Object.freeze([
  {
    id: 'render-3d',
    domain: 'rendering',
    title: 'Three-dimensional scene, camera, and frame loop',
    summary:
      'A project-owned Babylon.js construction scene driven beside a fixed-step simulation clock; crowd rendering remains a later plan step.',
    dimension: '3d',
    status: 'available',
    core: true,
    signals: [],
    prerequisites: [
      'A browser entry module served over HTTP with one <canvas> element it owns.',
      '`@babylonjs/core` installed as a project dependency; the harness does not vendor it.',
      'The generated shared simulation, updated on a fixed step separately from the render callback.',
    ],
    tools: ['@babylonjs/core (Engine, Scene, ArcRotateCamera)', 'engine.runRenderLoop', 'harness write_file'],
    methods: [
      { call: "new Engine(canvas, true, { powerPreference: 'high-performance' })", does: 'Binds a GL context to the canvas the page already has.' },
      { call: "window.addEventListener('resize', () => engine.resize())", does: 'Resizes the drawing buffer when the canvas size changes.' },
      { call: "new ArcRotateCamera('camera', alpha, beta, radius, target, scene)", does: 'A readable orbit camera for inspecting the construction scene.' },
      { call: "CreateBox('avatar', { width: 0.7, height: 1.7, depth: 0.7 }, scene)", does: 'An explicit previs stand-in, not an authored character.' },
      { call: 'engine.getDeltaTime()', does: 'The frame delta fed to the accumulator, not to the simulation directly.' },
      { call: 'engine.runRenderLoop(() => scene.render())', does: 'Draws each frame, from the state the fixed step already settled.' },
    ],
    acceptance: [
      'The generated Babylon client and its project-owned shared simulation bundle with no harness import.',
      'The served page owns one canvas and the client wires a render loop plus resize handling.',
      'The generated README calls the scene construction-grade and does not claim admitted assets or presentation polish.',
    ],
  },
  {
    id: 'render-2d',
    domain: 'rendering',
    title: 'Two-dimensional construction frame',
    summary:
      'A project-owned Canvas2D grid and local marker, deliberately short of tile, sprite, atlas, and animation support.',
    dimension: '2d',
    status: 'available',
    core: true,
    signals: [],
    prerequisites: [
      'A browser entry module served over HTTP with one <canvas> element it owns.',
      'The generated shared simulation and one local placeholder player.',
      'A camera in world units and a single place that converts world to screen.',
    ],
    tools: ['CanvasRenderingContext2D', 'requestAnimationFrame', 'harness write_file'],
    methods: [
      { call: "canvas.getContext('2d', { alpha: false, desynchronized: true })", does: 'An opaque context; alpha: false removes a per-frame compositing pass.' },
      { call: 'ctx.setTransform(zoom, 0, 0, zoom, -camera.x * zoom + width / 2, -camera.y * zoom + height / 2)', does: 'Applies the camera once per frame instead of per sprite.' },
      { call: 'const firstX = Math.floor((camera.x - halfWidth) / TILE) - 1', does: 'Culls the grid loop to the view rectangle instead of an imagined whole map.' },
      { call: 'context.fillRect(player.x * TILE - 8, player.z * TILE - 8, 16, 16)', does: 'Draws one obvious placeholder marker; it is not passed off as a sprite.' },
      { call: 'accumulator += Math.min(now - last, 250)', does: 'Clamps a restored-tab delta before advancing fixed simulation steps.' },
    ],
    acceptance: [
      'The generated Canvas client and shared simulation bundle with no renderer dependency or harness import.',
      'The served page owns one canvas and the construction frame culls its grid to the view rectangle.',
      'The generated README explicitly says no atlas, sprite, tile set, or finished 2D renderer exists yet.',
    ],
  },
  {
    id: 'animation-3d',
    domain: 'animation',
    title: 'Skeletal animation and blending',
    summary:
      'Named glTF clips driven by one mixer per character, cross-faded on state changes, updated from the same delta the renderer uses.',
    dimension: '3d',
    status: 'available',
    core: true,
    signals: [],
    prerequisites: [
      'glTF/GLB characters whose animation groups are named by the state machine that plays them (Idle, Run, Attack).',
      'A character state machine that owns transitions; the animation group plays what it is told and decides nothing.',
      'Rigged characters instantiated from an AssetContainer — a container instantiation gives each copy its own skeleton and its own animation groups, and re-adding the loaded meshes does not.',
    ],
    tools: [
      '@babylonjs/core (AnimationGroup, Animation, AssetContainer)',
      '@babylonjs/loaders/glTF, for the glTF/GLB registration',
      '@babylonjs/core/Loading/sceneLoader.js (LoadAssetContainerAsync)',
    ],
    methods: [
      { call: 'const container = await LoadAssetContainerAsync(url, scene)', does: 'Loads once into a container rather than straight into the scene, so every character after the first is an instantiation.' },
      { call: 'const entries = container.instantiateModelsToScene((name) => name, false, { doNotInstantiate: true })', does: 'Clones a rigged mesh with its own skeleton and its own animation groups, so instances animate independently.' },
      { call: "entries.animationGroups.find((group) => group.name === 'Run')", does: 'Looks a clip up by name rather than by array index, which reorders when the artist re-exports.' },
      { call: 'Animation.AllowMatricesInterpolation = true', does: 'Set once at boot; without it a skeletal blend snaps instead of interpolating.' },
      { call: 'group.enableBlending(0.05); group.play(true)', does: 'Starts a looping clip that blends in rather than popping.' },
      { call: 'current.setWeightForAllAnimatables(1 - t); next.setWeightForAllAnimatables(t)', does: 'The cross-fade itself: two groups playing, weights summing to one.' },
      { call: 'group.play(false)', does: 'One-shot actions such as an attack; false is the loop flag, not a speed.' },
      { call: 'group.onAnimationGroupEndObservable.add(onActionFinished)', does: 'Returns the state machine to idle exactly when the clip ends.' },
      { call: 'group.goToFrame(frame); group.pause()', does: 'Holds a one-shot on its last frame, which Babylon does not clamp for you.' },
    ],
    acceptance: [
      'Walking and stopping blends both ways with no visible snap.',
      'Two characters of the same model can be in different animation states at once.',
      'A one-shot action returns to idle on its own, without a timer that guesses the clip length.',
    ],
  },
  {
    id: 'animation-2d',
    domain: 'animation',
    title: 'Sprite-sheet animation and state',
    summary:
      'Frame tables advanced by accumulated time, with per-state loops and a transition rule that does not restart a running state.',
    dimension: '2d',
    status: 'available',
    core: true,
    signals: [],
    prerequisites: [
      'An atlas frame table giving each state its frames and per-frame duration in milliseconds.',
      'A delta clamp, so a backgrounded tab does not fast-forward every animation on return.',
    ],
    tools: ['performance.now()', 'the atlas frame table from the content pipeline', 'harness write_file'],
    methods: [
      { call: 'const dt = Math.min(now - last, 100)', does: 'Clamps the frame delta; an unclamped tab-restore delta skips whole animations.' },
      { call: 'elapsed += dt; while (elapsed >= frame.durationMs) { elapsed -= frame.durationMs; index = (index + 1) % frames.length }', does: 'Advances frames without dropping the remainder, so playback does not drift.' },
      { call: 'if (state !== next) { state = next; index = 0; elapsed = 0 }', does: 'Resets only on a real state change; resetting every frame freezes frame zero.' },
      { call: 'const frame = SHEET[state].frames[index]', does: 'The source rect handed to drawImage.' },
      { call: 'ctx.save(); ctx.scale(-1, 1); ctx.drawImage(...); ctx.restore()', does: 'Mirrors a sprite for the other facing without a second atlas row.' },
    ],
    acceptance: [
      'An animation loops at the authored rate independent of the display refresh rate.',
      'Holding a movement key does not restart the walk cycle each frame.',
      'Returning to a backgrounded tab does not skip an animation forward.',
    ],
  },
  {
    id: 'shaders',
    domain: 'shaders',
    title: 'Custom materials and GLSL programs',
    summary:
      'Project-owned shading, either as a full ShaderMaterial or as a plugin into Babylon\'s built-in program, with the raw WebGL2 path for when neither fits.',
    dimension: 'any',
    status: 'available',
    core: false,
    signals: [
      'shader', 'glsl', 'water', 'foliage', 'wind', 'dissolve', 'toon', 'cel', 'outline',
      'stylised', 'stylized', 'painterly', 'material', 'lighting', 'fog', 'weather',
    ],
    prerequisites: [
      'A renderer and a running frame loop; a shader is a change to how something already on screen is drawn.',
      'A uniform update path — one object mutated per frame, never a new material per frame.',
      'For raw WebGL2, GLSL ES 3.00 sources beginning with `#version 300 es` on the first line, no leading whitespace.',
    ],
    tools: ['@babylonjs/core (ShaderMaterial, Effect.ShadersStore, MaterialPluginBase)', 'WebGL2RenderingContext', 'GLSL ES 3.00'],
    methods: [
      { call: "Effect.ShadersStore['windVertexShader'] = vertexSource", does: 'Registers a source under a name; a ShaderMaterial is then built by naming it rather than by passing the text.' },
      { call: "new ShaderMaterial('wind', scene, { vertex: 'wind', fragment: 'wind' }, { attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'uTime'] })", does: 'A material this project owns entirely, with no Babylon lighting attached — every uniform it uses has to be declared here.' },
      { call: "material.setFloat('uTime', elapsedSeconds)", does: 'The per-frame uniform update: set the value, never rebuild the material.' },
      { call: 'class WindPlugin extends MaterialPluginBase { getCustomCode(type) { return type === "vertex" ? { CUSTOM_VERTEX_UPDATE_POSITION: WIND_CHUNK } : null } }', does: "Patches Babylon's standard or PBR material at a named injection point, so its lighting and shadows keep working." },
      { call: "registerMaterialPlugin('Wind', (material) => new WindPlugin(material))", does: 'Attaches the plugin to materials as they are created; the plugin name and its defines are what keep differently patched materials on separate compiled programs.' },
      { call: 'const shader = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(shader, source); gl.compileShader(shader)', does: 'The raw compile path.' },
      { call: 'if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "")', does: 'Surfaces the compiler log; a silently failing shader renders black and looks like a scene bug.' },
      { call: 'gl.createProgram(); gl.attachShader(program, vs); gl.linkProgram(program); gl.getProgramInfoLog(program)', does: 'Links and reports, same reasoning as the compile check.' },
      { call: "gl.uniform1f(gl.getUniformLocation(program, 'uTime'), t)", does: 'Sets a uniform; look the location up once at init, not per frame.' },
    ],
    acceptance: [
      'The shaded effect is visible and the console carries no shader compile or link log.',
      'The material compiles once: a program cache counter does not grow while the effect runs.',
      'Removing the effect changes only appearance, never simulation state.',
    ],
  },
  {
    id: 'post-processing',
    domain: 'post-processing',
    title: 'Full-screen passes and tone mapping',
    summary:
      'A composer chain after the scene pass, with a measured frame cost and a way to switch the whole chain off.',
    dimension: '3d',
    status: 'available',
    core: false,
    signals: [
      'bloom', 'glow', 'cinematic', 'atmosphere', 'atmospheric', 'post', 'hdr', 'tone',
      'depth of field', 'vignette', 'grade', 'grading', 'moody', 'neon',
    ],
    prerequisites: [
      'A working scene render and a camera to attach the pipeline to; post-processing wraps the final render, so it cannot come first.',
      'An HDR pipeline if bloom is wanted at all: thresholding an already-clipped LDR buffer blooms the whole frame.',
      'A frame timer, because a full-screen pass costs fill rate on exactly the machines an MMO cannot exclude.',
    ],
    tools: [
      '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js',
      '@babylonjs/core/Materials/imageProcessingConfiguration.js',
      '@babylonjs/core/Instrumentation/engineInstrumentation.js',
    ],
    methods: [
      { call: "const pipeline = new DefaultRenderingPipeline('default', true, scene, [camera])", does: 'The chain, attached to one camera. The `true` is the HDR flag, and it is the argument bloom depends on.' },
      { call: 'pipeline.bloomEnabled = true; pipeline.bloomThreshold = 0.85; pipeline.bloomWeight = 0.6; pipeline.bloomScale = 0.5', does: 'Bloom — the threshold is what keeps it off flat surfaces, and bloomScale is where its cost is paid.' },
      { call: 'pipeline.imageProcessing.toneMappingEnabled = true; pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES', does: 'Maps HDR values into display range instead of clipping them.' },
      { call: 'pipeline.imageProcessing.exposure = 1.1; pipeline.fxaaEnabled = true', does: 'Exposure and the cheap antialias pass, both applied once at the end of the chain.' },
      { call: "scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline('default', camera)", does: 'The off switch, without disposing the pipeline — the toggle a settings menu needs.' },
      { call: 'pipeline.dispose()', does: 'Releases the render targets. Dropping the reference does not: the pipeline manager still holds it.' },
      { call: 'const instrumentation = new EngineInstrumentation(engine); instrumentation.captureGPUFrameTime = true; instrumentation.gpuFrameTimeCounter.average', does: 'The measured frame cost, which is the only honest way to decide whether the chain stays on.' },
    ],
    acceptance: [
      'Toggling the chain off restores the plain scene render with no leftover state.',
      'Resizing the window does not blur or letterbox the composed image.',
      'The measured frame cost of the chain is recorded and inside the budget the plan sets.',
    ],
  },
  {
    id: 'network-authority',
    domain: 'networking',
    title: 'First shared authoritative encounter',
    summary:
      'One server assigns identities and owns movement. Intent goes up, whole snapshots come down, and two clients can see each other without trusting either client with position.',
    dimension: 'any',
    status: 'available',
    core: true,
    signals: [],
    prerequisites: [
      'The simulation extracted into a pure `step(state, inputs, dtSeconds)` that the server owns and the client can render.',
      'An exact JSON wire schema with a protocol version, defined once in shared code.',
      'Every message validated on arrival: a client sends intent (a direction, a target) and never a result (a position, a balance).',
    ],
    tools: [
      'ws (WebSocketServer) on node:http, or a Cloudflare Durable Object as the room owner',
      'exact JSON validators for the first inspectable protocol',
      'the shared step() module',
    ],
    methods: [
      { call: 'const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })', does: 'Caps payload size at the door; an unbounded frame is a memory attack.' },
      { call: "http.on('upgrade', (request, socket, head) => sockets.handleUpgrade(request, socket, head, attach))", does: 'Upgrades only the versioned game path before a socket can join the room.' },
      { call: "socket.on('message', (data) => enqueue(session, decodeClientMessage(String(data))))", does: 'Decode, validate, enqueue — never apply straight to state from inside the handler.' },
      { call: 'while (accumulator >= STEP_MS) { state = step(state, drainInputs(), STEP_MS / 1000); accumulator -= STEP_MS; tick += 1 }', does: 'The fixed tick; the accumulator is what keeps simulation time independent of wall-clock jitter.' },
      { call: 'const input = { seq, moveX, moveY, buttons }', does: 'The only thing a client is allowed to author. Each carries a monotonic sequence number.' },
      { call: 'session.lastSeq = input.seq', does: 'Rejects a stale replay and echoes the last accepted sequence in this client\'s snapshots.' },
      { call: 'for (const session of sessions) if (session.welcomed) snapshot(session)', does: 'Sends the whole small construction world; delta compression stays deferred until measurement justifies it.' },
      { call: 'tokens = Math.min(BURST, tokens + elapsedMs * RATE); if (tokens < 1) return; tokens -= 1', does: 'Per-socket token bucket, so one client cannot flood a tick.' },
    ],
    acceptance: [
      'Two clients on one server see each other move within the plan\'s latency budget.',
      'A client that stops sending input stops moving on every other client within one tick.',
      'A forged message claiming a position, an item, or a balance changes nothing on the server.',
      'Both generated dimensions pass the same two-client black-box connection and movement check.',
    ],
  },
  {
    id: 'persistence-streaming',
    domain: 'persistence',
    title: 'World streaming and durable state',
    summary:
      'Chunks loaded and evicted around players, and character state written often enough that a crash costs one interval, not a session.',
    dimension: 'any',
    status: 'available',
    core: true,
    signals: [],
    prerequisites: [
      'Entity and chunk state serializable to plain JSON or a fixed binary layout — no class instances, no functions.',
      'Exactly one writer per shard; two processes writing one world file is corruption, not a race to tune.',
      'A schema version row from the first migration, before any data exists to migrate.',
    ],
    tools: [
      'bun:sqlite (Database) or node:sqlite (DatabaseSync) on Node 22+',
      'an LRU keyed by chunk coordinate',
      'process signal handlers',
    ],
    methods: [
      { call: 'const chunkKey = (cx, cz) => `${cx}:${cz}`', does: 'One canonical key; two spellings of a coordinate is two copies of a chunk.' },
      { call: 'const radius = Math.ceil(viewDistance / CHUNK_SIZE); for (let dz = -radius; dz <= radius; dz += 1)', does: 'The load ring around each player, recomputed when a player crosses a chunk edge.' },
      { call: 'if (loaded.size > MAX_CHUNKS) { const [oldest] = loaded.keys(); await unloadChunk(oldest) }', does: 'LRU eviction; re-insert on access so recency is the map order.' },
      { call: "db.run('PRAGMA journal_mode = WAL')", does: 'Lets the save pass write while readers continue.' },
      { call: "db.query('INSERT INTO character (id, x, y, z, inventory) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET x = ?2, y = ?3, z = ?4, inventory = ?5')", does: 'The upsert that character saving is, without a read first.' },
      { call: 'const flush = db.transaction((rows) => { for (const row of rows) save.run(row) }); flush(dirty)', does: 'One transaction per save pass; one per row is orders of magnitude slower.' },
      { call: 'dirty.add(entityId)', does: 'The save set. Saving everything every interval does not survive a real population.' },
      { call: "process.on('SIGTERM', async () => { await flushAll(); process.exit(0) })", does: 'A clean shutdown writes the last interval instead of losing it.' },
      { call: "db.run('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')", does: 'Forward-only migrations, checked at boot before the server accepts a connection.' },
    ],
    acceptance: [
      'Killing the server uncleanly loses at most one save interval of progress.',
      'Walking a straight line for several minutes keeps the loaded chunk count bounded.',
      'Restarting the server restores character position and inventory exactly.',
    ],
  },
  {
    id: 'economy-kei',
    domain: 'economy',
    title: 'Kei currencies, items, and settlement',
    summary:
      'Player-custodied currency and items settled atomically by Kei consensus, with issuer provisioning separate from the authoritative game server.',
    dimension: 'any',
    status: 'available',
    core: true,
    signals: [],
    prerequisites: [
      'The published kei-transaction@0.6.0 package, installed by the generated project rather than imported from this harness or a sibling checkout.',
      'One issuer context for a separate provisioning job and one Kei.start() context per player; a key signs only for its own account.',
      'Integer raw strings for asset movement and safe integer literals for the current accept({ expect }) amount fields; no displayed float is signed back.',
      'Direct offer delivery or an application-owned bounded directory, because Kei has no global order book or listing index.',
    ],
    tools: [
      'kei-transaction@0.6.0 — Kei.mock(), Kei.start(), Kei.server(), token, items, and market APIs',
      'the generated src/economy modules, owned by the project and separate from src/server',
      'the chain itself for balances, ownership, offer locks, and atomic settlement; no local ledger table',
    ],
    methods: [
      { call: 'const node = await Kei.mock()', does: 'Creates the private in-process chain the generated economy proof uses without a network or secret.' },
      { call: 'const issuer = await Kei.server({ seed, node })', does: 'Opens the issuer only in a separate provisioning context; the generated game server never imports Kei.' },
      { call: "issuer.token.issue({ name: 'Gold', symbol: 'GOLD', decimals: 0, transfer: 'open', swap: 'off' })", does: 'Issues a consensus-owned currency whose open transfer policy permits direct player-to-player trade.' },
      { call: "issuer.items.create({ name: \"Founder's Sword\", transfer: 'open' }) / issuer.items.mint(sword.id, seller.address)", does: 'Creates the item and mints it directly to its player custodian, never through the game server.' },
      { call: "seller.market.offer({ give: { asset: sword.id, amount: '1' }, want: { asset: gold.id, amount: '25' }, to: buyer.address })", does: 'The seller signs one reserved offer and passes it directly to the buyer; there is no global order book.' },
      { call: 'buyer.market.accept(offer, { expect: { hash, seller, give, want, to } })', does: 'Checks every displayed term immediately before the buyer signs the one atomic settlement block.' },
      { call: 'node.holderBalance(asset, address) / node.swapOffer(offer.hash)', does: 'Reads raw chain state in the mock proof so custody and both settlement legs are exact strings, not display arithmetic.' },
    ],
    acceptance: [
      'A fresh 2D or 3D generated project runs the same Kei.mock() issue, mint, mismatch-refusal, and atomic trade proof.',
      'The issuer retains neither trade asset after setup, the seller locks only their item, and both final legs settle directly between players.',
      'A mismatched expectation fails before signing and leaves the raw balances and open offer unchanged.',
      'No generated src/server file imports kei-transaction, reads a seed, holds a balance or inventory, or accepts economic state over WebSocket.',
    ],
  },
  {
    id: 'ui-hud',
    domain: 'ui',
    title: 'HUD, input, and interface state',
    summary:
      'A DOM overlay that reads the same state the simulation writes, updated only when a value changes, and never measuring layout inside the frame.',
    dimension: 'any',
    status: 'available',
    core: true,
    signals: [],
    prerequisites: [
      'One state store the simulation writes and the HUD reads; a HUD that keeps its own copy of health will disagree with the server.',
      'An overlay root that does not eat pointer events meant for the canvas.',
      'Input intent separated from key codes, so rebinding is a table change rather than an edit to the movement code.',
    ],
    tools: ['DOM + CSS overlay', 'Pointer Events', 'Pointer Lock API', 'Gamepad API', 'ResizeObserver'],
    methods: [
      { call: 'overlay.style.pointerEvents = "none"; button.style.pointerEvents = "auto"', does: 'Lets clicks reach the canvas everywhere except on a control.' },
      { call: 'if (shown.health !== state.health) { shown.health = state.health; label.textContent = String(state.health) }', does: 'The dirty check. Writing textContent every frame is layout work every frame.' },
      { call: 'new ResizeObserver(([entry]) => resize(entry.contentRect)).observe(canvasHost)', does: 'Resize from the element, not from window, so a sidebar or devtools split is handled.' },
      { call: "canvas.requestPointerLock(); document.addEventListener('pointerlockchange', onLockChange)", does: 'Mouse-look capture, with the exit path wired from the start.' },
      { call: 'element.setPointerCapture(event.pointerId)', does: 'Keeps a drag alive when the pointer leaves the element.' },
      { call: 'const pads = navigator.getGamepads(); const pad = pads[0]', does: 'Gamepad state is polled inside the frame; there is no button event.' },
      { call: 'const intent = BINDINGS[event.code]', does: 'Key code to intent, once, in a table.' },
    ],
    acceptance: [
      'Clicking through empty HUD space reaches the world underneath.',
      'HUD values track the server without the HUD keeping its own authority.',
      'No getBoundingClientRect or offsetWidth read happens inside the render loop.',
    ],
  },
  {
    id: 'audio',
    domain: 'audio',
    title: 'Positional audio and mixing',
    summary:
      'One audio graph resumed on a real gesture, with a voice cap and separate buses, positioned from the same transforms the renderer uses.',
    dimension: 'any',
    status: 'available',
    core: false,
    signals: ['audio', 'sound', 'music', 'sfx', 'ambient', 'ambience', 'voice', 'soundtrack', 'score'],
    prerequisites: [
      'A user gesture before the first sound: every browser starts an AudioContext suspended, and autoplay policy will not be argued with.',
      'Decoded buffers cached; decodeAudioData per playback is a stutter.',
      'A voice cap, because an MMO will otherwise start a hundred footsteps at once.',
    ],
    tools: ['Web Audio API (AudioContext, GainNode)', '@babylonjs/core/AudioV2 (CreateAudioEngineAsync, CreateSoundAsync) for the 3D path'],
    methods: [
      { call: "const audio = new AudioContext(); addEventListener('pointerdown', () => audio.resume(), { once: true })", does: 'Creates the graph early and unlocks it on the first real gesture.' },
      { call: 'const buffer = await audio.decodeAudioData(await response.arrayBuffer())', does: 'Decodes once at load, into the buffer cache.' },
      { call: 'const source = audio.createBufferSource(); source.buffer = buffer; source.connect(sfxBus); source.start()', does: 'Plays one sound; a source node is single-use by design.' },
      { call: 'const sfxBus = audio.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(audio.destination)', does: 'Separate music and effect buses, so a settings slider is one gain node.' },
      { call: 'gain.gain.setTargetAtTime(0, audio.currentTime, 0.05)', does: 'Ramps rather than cuts; an abrupt gain change is an audible click.' },
      { call: 'const audioEngine = await CreateAudioEngineAsync(); audioEngine.listener.attach(camera)', does: 'One engine, one listener, tied to the camera the player is looking through.' },
      { call: "const sound = await CreateSoundAsync('step', url, { spatialEnabled: true, maxDistance: 40 }, audioEngine); sound.spatial.attach(emitter)", does: 'Attaches a positional emitter to a scene node, so it moves with the transform the renderer already updates.' },
      { call: 'if (activeVoices >= MAX_VOICES) return', does: 'The cap, checked before the source node is created.' },
    ],
    acceptance: [
      'Nothing plays before the first gesture, and everything plays after it.',
      'A crowded scene never exceeds the voice cap.',
      'Muting a bus silences its category and nothing else.',
    ],
  },
  {
    id: 'content-pipeline',
    domain: 'content',
    title: 'Assets, manifests, and loading',
    summary:
      'Every asset listed in a manifest with a hash and a licence, loaded through one manager, compressed for the network before it ships.',
    dimension: 'any',
    status: 'available',
    core: true,
    signals: [],
    prerequisites: [
      'An assets manifest committed to the repository: id, path, byte size, content hash, licence.',
      'Binary assets referenced, never authored inline. The harness write tool is for text, and a base64 mesh in a source file is a mesh nobody can edit.',
      'A loading screen that can report progress and can fail loudly.',
    ],
    tools: [
      '@babylonjs/loaders/glTF, which registers the glTF and GLB loader',
      '@babylonjs/core/Loading/sceneLoader.js (LoadAssetContainerAsync, AppendSceneAsync)',
      'DracoDecoder and KhronosTextureContainer2 configuration for compressed geometry and textures',
      'createImageBitmap for the 2D atlas path',
    ],
    methods: [
      { call: 'const container = await LoadAssetContainerAsync(record.path, scene)', does: 'Loads an admitted asset into a container the project decides when to add, rather than straight into the live scene.' },
      { call: "DracoDecoder.DefaultConfiguration = { wasmUrl: '/draco/draco_wasm_wrapper.js', wasmBinaryUrl: '/draco/draco_decoder.wasm', fallbackUrl: '/draco/draco_decoder.js' }", does: 'Geometry compression; the decoder files must actually be served from those paths.' },
      { call: "KhronosTextureContainer2.URLConfig.jsDecoderModule = '/ktx2/babylon.ktx2Decoder.js'", does: 'GPU-compressed textures, transcoded per device rather than shipped as PNG.' },
      { call: 'const { id, path, sha256, licence } = manifest.assets[index]', does: 'The manifest record; a missing licence field is a release blocker, not a warning.' },
      { call: 'await LoadAssetContainerAsync(url, scene, { onProgress: (event) => report(event.loaded / event.total) })', does: 'The progress the loading screen reports. The promise rejecting is the failure path, and swallowing it is what turns a missing asset into a blank screen.' },
      { call: 'texture.gammaSpace = true', does: 'Albedo textures are sRGB; data textures (normal, roughness, metallic) are not, and getting it wrong washes the whole scene out.' },
      { call: 'mesh.refreshBoundingInfo(true)', does: 'Frustum culling needs bounds; geometry built or skinned at runtime keeps its stale ones until this is called.' },
    ],
    acceptance: [
      'Every shipped asset appears in the manifest with a hash and a licence.',
      'A missing or corrupt asset fails with a message naming the asset, not a blank screen.',
      'The first playable frame arrives inside the load budget on the target connection.',
    ],
  },
  {
    id: 'testing',
    domain: 'testing',
    title: 'Deterministic simulation and boundary tests',
    summary:
      'A seeded, fixed-step simulation that produces the same tick hash every run, plus socket boundaries and a private Kei.mock() custody proof.',
    dimension: 'any',
    status: 'available',
    core: true,
    signals: [],
    prerequisites: [
      'A seeded PRNG everywhere; one Math.random() in the simulation makes every replay test useless.',
      'The tick loop callable directly. Tests drive step(), never setInterval.',
      'No test may reach a real provider, a real chain, or a real socket.',
    ],
    tools: ['bun test (bun:test)', 'node:test as the Node equivalent', 'an in-memory socket pair double'],
    methods: [
      { call: 'const rng = mulberry32(seed)', does: 'A small seeded PRNG; the seed goes in the test name so a failure is reproducible.' },
      { call: 'expect(hashState(runTicks(seed, 600))).toBe(GOLDEN_HASH)', does: 'The replay test: 600 ticks from a seed must land on one hash.' },
      { call: 'const [client, server] = socketPair()', does: 'Exercises encode/decode and reconciliation with no network at all.' },
      { call: 'expect(() => applyInput(session, forged)).not.toThrow(); expect(state.players[id].x).toBe(before)', does: 'The authority test: a forged input is ignored, not fatal.' },
      { call: "expect(await node.holderBalance(gold.id, seller.address)).toBe('25')", does: 'The exact chain-owned settlement check; the paired item owner and offer state are asserted in the same mock proof.' },
      { call: 'expect(renderer.info.render.calls).toBeLessThanOrEqual(DRAW_CALL_BUDGET)', does: 'Keeps a performance budget from quietly regressing.' },
    ],
    acceptance: [
      'The whole suite passes offline, with no network and no credentials set.',
      'The same seed produces the same tick hash on Linux and on Windows.',
      'Every authority rule in the networking packet has a test that tries to break it.',
    ],
  },
  {
    id: 'deployment',
    domain: 'deployment',
    title: 'Build, run, and operate',
    summary:
      'A static client, a shard process that shuts down cleanly, health that reports tick lag, and configuration that is all environment references.',
    dimension: 'any',
    status: 'available',
    core: true,
    signals: [],
    prerequisites: [
      'Client and server buildable separately; the client is static files and the server is a process.',
      'Every secret an environment variable name in the repository and a value only in the deployment.',
      'A protocol version constant shared by both, so a stale client is refused instead of desynchronised.',
    ],
    tools: ['bun build', 'a WebSocket-capable reverse proxy', 'wrangler deploy when the room owner is a Durable Object', 'the platform process manager'],
    methods: [
      { call: 'bun build ./src/client/main.ts --outdir dist/client --minify --target browser', does: 'The static client bundle.' },
      { call: "server.on('upgrade', (request, socket, head) => wss.handleUpgrade(request, socket, head, done))", does: 'The upgrade path the proxy has to be configured to pass through untouched.' },
      { call: "if (url.pathname === '/healthz') return json({ tick, lagMs, players })", does: 'Health that reports whether the tick is keeping up, not just that the process is alive.' },
      { call: "process.on('SIGTERM', async () => { wss.close(); await flushAll(); process.exit(0) })", does: 'Drain and save before exit; the deploy that skips this loses the last interval every time.' },
      { call: 'if (client.protocolVersion !== PROTOCOL_VERSION) return refuse(socket, 4001, "stale client")', does: 'Refuses a mismatched client with a close code it can explain to the player.' },
      { call: 'const endpoint = process.env.KEI_ENDPOINT', does: 'Configuration by environment reference, read at boot and validated before serving.' },
    ],
    acceptance: [
      'A clean build produces a client bundle and a server process from one command each.',
      'SIGTERM saves and exits without dropping a player mid-transaction.',
      '/healthz reports rising tick lag under load rather than reporting healthy.',
      'No credential value appears anywhere in the repository or the build output.',
    ],
  },
  {
    id: 'content-3d-props',
    domain: 'content',
    title: 'Props and models as versioned records',
    summary:
      'Set dressing specified as primitive-kitbash documents in a content manifest, admitted through a gate before any scene may reference them.',
    dimension: '3d',
    status: 'available',
    core: true,
    signals: [],
    prerequisites: [
      'The content manifest at kei-mmo/content/manifest.json, written by the harness and owned by the project.',
      'A style profile already resolved, because the prop kit is chosen by setting and never by default.',
      'The render-3d packet, since a prop spec is drawn with the same primitive builders everything else uses.',
    ],
    tools: [
      'the versioned prop-spec records in kei-mmo/content/manifest.json',
      '@babylonjs/core mesh builders (CreateBox, CreateCylinder, CreateSphere)',
      'node kei-mmo/content/check.mjs — the project-owned admission check, no harness required',
    ],
    methods: [
      { call: "const manifest = JSON.parse(readFileSync('kei-mmo/content/manifest.json', 'utf8'))", does: 'Loads the manifest; every asset a scene uses is a record in it.' },
      { call: 'const spec = manifest.assets.find((a) => a.id === id && a.kind === "prop-spec")?.data', does: 'Resolves a prop by id rather than trusting a caller-supplied shape.' },
      { call: "CreateBox(part.id, { width: part.size[0], height: part.size[1], depth: part.size[2] }, scene)", does: 'One primitive per part; a cylinder takes diameterTop/diameterBottom/height from the same size triple.' },
      { call: 'mesh.position.set(part.offset[0], part.offset[1], part.offset[2]); mesh.parent = root', does: 'Assembles the parts under one transform node so the prop moves as one object.' },
      { call: "part.role === 'emissive' ? emissiveMaterial : baseMaterial", does: 'The role field is the whole material contract: structure, accent, or emissive. Materials are shared per role, never built per part.' },
      { call: 'node kei-mmo/content/check.mjs', does: 'Re-runs admission inside the project: a record whose file or document is wrong fails the build, not the player.' },
    ],
    acceptance: [
      'Every prop a scene references resolves to an admitted manifest record.',
      'The check script exits nonzero when a declared file asset is missing from disk.',
      'A different declared style setting selects a visibly different prop kit.',
    ],
  },
  {
    id: 'content-3d-motion',
    domain: 'animation',
    title: 'Rig, clip records, and the motion ready gate',
    summary:
      'A blocking-grade rig with versioned keyframe clip documents behind an adapter seam, and a ready gate no unready clip can pass into a scene.',
    dimension: '3d',
    status: 'available',
    core: true,
    signals: [],
    prerequisites: [
      'The previs-biped rig definition, admitted in the content manifest like any other record.',
      'Clip documents at the current clip version; a stale or foreign clip parses to null and is not ready.',
      'The animation-3d packet for playback, because these clips use the same AnimationGroup boundary as glTF clips do.',
    ],
    tools: [
      'the motion-clip records in kei-mmo/content/manifest.json',
      '@babylonjs/core (Animation, AnimationGroup, TargetedAnimation)',
      'the harness ready gate (create-kei-mmo/motion motionReadyGate), run before any scene document is emitted',
    ],
    methods: [
      { call: "new Animation(track.id, track.property, frameRate, Animation.ANIMATIONTYPE_VECTOR3, loopMode)", does: 'Creates one Babylon animation per document track; the target property remains data rather than provider naming.' },
      { call: 'animation.setKeys(track.keys.map(({ frame, value }) => ({ frame, value: Vector3.FromArray(value) })))', does: 'Copies versioned key data into Babylon values without changing timing.' },
      { call: 'group.addTargetedAnimation(animation, node); group.start(doc.loop, 1, fromFrame, toFrame)', does: 'Groups tracks under the semantic clip id and starts with the document loop policy.' },
      { call: 'isClipReady(record) === (record.status === "ready" && record.clip !== undefined && record.clipVersion === MOTION_CLIP_VERSION)', does: 'The ready triple, checked strictly: a claim of ready without a current-version payload fails closed.' },
      { call: 'motionReadyGate(records, requiredClipIds)', does: 'Resolves every clip a scene needs at once, and returns every miss at once when any is not ready.' },
    ],
    acceptance: [
      'A scene or cut-scene document referencing a clip that is not ready is never written to disk.',
      'A clip whose version is not the one this build speaks is reported missing, not played.',
      'Every authored clip validates against its rig: no track names a node the rig does not have.',
    ],
  },
  {
    id: 'content-3d-cutscenes',
    domain: 'content',
    title: 'Directed cut-scenes: plan, stage, beats, rehearsal, assembly',
    summary:
      'A deterministic staged pipeline that turns cast, props, and cues into a versioned cut-scene document the project plays with its own code.',
    dimension: '3d',
    status: 'available',
    core: false,
    signals: [
      'cutscene', 'cut-scene', 'cut scene', 'cinematic', 'story', 'intro', 'opening',
      'dialogue', 'narrative', 'quest', 'boss', 'trailer', 'scripted scene',
    ],
    prerequisites: [
      'Admitted props and cues, and ready motion clips — rehearsal blocks everything else.',
      'A style profile, because the scene title and set dressing follow the declared setting.',
      'The player module src/shared/cutscene.ts, which the scaffold writes and the project owns outright.',
    ],
    tools: [
      'the staged pipeline (create-kei-mmo/cutscene: planCutScene, stageCutScene, cutSceneBeats, rehearseCutScene, assembleCutScene) — harness-side',
      'the assembled documents in kei-mmo/content/cutscenes/',
      'the project-owned player in src/shared/cutscene.ts, with no harness dependency',
    ],
    methods: [
      { call: 'const rehearsal = rehearseCutScene(plan, staged, beats, { clipRecords, admitted })', does: 'The checking pass: every missing clip, unadmitted cue, and out-of-bounds beat, reported at once.' },
      { call: 'assembleCutScene(plan, staged, beats, rehearsal)', does: 'Refuses a failed rehearsal outright; the emitted document can only reference what is ready.' },
      { call: 'stripUnready(beats, rehearsal)', does: 'The one honest repair: drop the unsatisfiable reference and let the actor hold, never ship it dangling.' },
      { call: "advanceCutScene(doc, timeMs)", does: 'The project-side player: pure, returns the active beat, camera pose, actions, and due cues for a time.' },
      { call: 'cutSceneDuration(doc) === doc.durationMs', does: 'Total duration is data in the document, so a caller can preallocate and never guess.' },
    ],
    acceptance: [
      'Assembling twice from the same inputs produces byte-identical JSON.',
      'Beat count and durations stay inside the published bounds, checked by rehearsal.',
      'The scaffolded player advances the shipped cut-scene with the harness deleted from the machine.',
    ],
  },
  {
    id: 'content-3d-audio',
    domain: 'audio',
    title: 'Audio cues: records, placeholder voices, placement',
    summary:
      'Sound as versioned cue records — category, diegetic flag, a synthesized placeholder voice — placed on beats and world emitters only after admission.',
    dimension: '3d',
    status: 'available',
    core: false,
    signals: ['audio', 'sound', 'music', 'sfx', 'ambient', 'ambience', 'soundtrack', 'score', 'foley', 'voice'],
    prerequisites: [
      'The audio packet, because cues play through the same gesture-unlocked graph and buses.',
      'A style profile: the cue palette follows the declared setting, and no setting means the neutral palette.',
      'Admission for every cue a placement names; rehearsal refuses the rest.',
    ],
    tools: [
      'the audio-cue records in kei-mmo/content/manifest.json',
      'Web Audio (OscillatorNode, GainNode, AudioBufferSourceNode for the noise voice)',
      'the cue placements carried on cut-scene beats',
    ],
    methods: [
      { call: "const osc = audio.createOscillator(); osc.type = cue.synth.wave; osc.frequency.setValueAtTime(cue.synth.startHz, t0)", does: 'The placeholder voice: one oscillator per cue, typed by the record.' },
      { call: 'osc.frequency.linearRampToValueAtTime(cue.synth.endHz, t0 + cue.synth.durationMs / 1000)', does: 'The pitch ramp that makes a blip read as a scanner rather than a beep.' },
      { call: 'gain.gain.setValueAtTime(0, t0); gain.gain.linearRampToValueAtTime(cue.synth.gain, t0 + attack)', does: 'Attack and release from the record, so no cue starts or stops with a click.' },
      { call: "cue.synth.wave === 'noise' ? noiseBufferSource(audio) : osc", does: 'The noise voice covers thuds and room tone; a looped one-second white buffer is enough at previs grade.' },
      { call: 'placement.spatial ? positionalGainFor(distance, placement.spatial.radiusM) : 1', does: 'Diegetic cues fall off over their declared radius; score does not, because it is not in the world.' },
    ],
    acceptance: [
      'Every placed cue names an admitted audio-cue record.',
      'A plan with no audio in it produces beats with no cue placements, not dangling ids.',
      'The declared setting changes which cue palette the manifest carries.',
    ],
  },
  {
    id: 'content-3d-model-generation',
    domain: 'content',
    title: 'Generated 3D models (external generator)',
    summary:
      'Text-to-3D or image-to-3D mesh generation feeding the same manifest and admission gate the primitive kits use — specified, and not implemented here.',
    dimension: '3d',
    status: 'planned',
    statusReason:
      'It needs an external generation service and a review pass; this harness bundles neither, and will not emit a mesh nothing here can inspect. The admission gate for its outputs is already real: a generated model-file record with no bytes on disk is blocked as generator_output_missing.',
    core: false,
    signals: ['text-to-3d', 'generate model', 'generated model', 'model generation', '3d generation', 'photogrammetry', 'scan'],
    prerequisites: [
      'An external mesh generator reachable from the harness, with its credential named by environment variable and never written to the project.',
      'A review step, because a generated mesh ships with the game and nobody here has seen it.',
      'The content manifest, where the output lands as a model-file record with provenance and a licence.',
    ],
    tools: [
      'an external text-to-3D or image-to-3D service (none is bundled)',
      'the model-file records and admission gate in kei-mmo/content/manifest.json',
      '@babylonjs/core LoadAssetContainerAsync for admitted output, exactly as the content-pipeline packet loads anything else',
    ],
    methods: [
      { call: "manifest.assets.push({ id, kind: 'model-file', source: { kind: 'generated', generator }, path, licence })", does: 'The record shape a generator adapter must produce: provenance and licence, or admission refuses it.' },
      { call: 'admitAssets(manifest, probe).blocked.find((v) => v.code === "generator_output_missing")', does: 'The gate that already exists: a declared output with no bytes blocks, it never becomes a scene reference.' },
      { call: 'const container = await LoadAssetContainerAsync(record.path, scene); container.addAllToScene()', does: 'Admitted output enters the scene through the ordinary Babylon loader path, nothing bespoke.' },
    ],
    acceptance: [
      'Declaring a generated model without its file blocks admission with generator_output_missing.',
      'No plan cites this packet while its status is planned; it appears in deferred, naming the status.',
    ],
  },
  {
    id: 'content-3d-motion-capture',
    domain: 'animation',
    title: 'Generated and captured motion (external service)',
    summary:
      'Text-to-motion generation or mocap import through the motion adapter seam, reported as clip records the ready gate already understands — specified, not implemented.',
    dimension: '3d',
    status: 'planned',
    statusReason:
      'It needs an external motion service (an ARDY-style text-to-motion generator, or a retargeting import). The adapter seam, record shape, and ready gate are implemented and tested; the service behind them is not, and no clip is promised from it.',
    core: false,
    signals: ['mocap', 'motion capture', 'text-to-motion', 'retarget', 'performance capture'],
    prerequisites: [
      'An external motion service reachable from the harness, its credential named by environment variable only.',
      'A pinned seed on every generation request, because an unreproducible clip cannot be admitted twice.',
      'The previs-biped rig or a declared richer rig for retargeting; a clip that names unknown nodes fails validation.',
    ],
    tools: [
      'the MotionAdapter seam (create-kei-mmo/motion): ingest(request) → one record per requested clip',
      'the motion-file records and admission gate for imported takes',
      'the ready gate, which is what keeps a pending generation out of every scene',
    ],
    methods: [
      { call: 'adapter.ingest({ clips: [{ id, prompt, durationMs, seed }] }, probe)', does: 'The request shape an ARDY-style generator drops into: prompt, duration, pinned seed, one explicit record back per clip.' },
      { call: "records.every((r) => r.status === 'ready' || r.status === 'pending' || r.status === 'failed' || r.status === 'missing')", does: 'A report never omits a requested clip; silence is not a status.' },
      { call: 'motionReadyGate(records, requiredIds).ok === false', does: 'A pending or failed generation blocks the scene that wanted it — degraded honestly, never referenced hopefully.' },
    ],
    acceptance: [
      'A pending clip record blocks cut-scene assembly until an ingest reports it ready.',
      'No plan cites this packet while its status is planned; it appears in deferred, naming the status.',
    ],
  },
  {
    id: 'content-3d-sfx-generation',
    domain: 'audio',
    title: 'Generated SFX and music (external generator)',
    summary:
      'Audio generation feeding audio-file records with provenance and a licence, behind the same admission gate the synthesized placeholders bypass honestly — specified, not implemented.',
    dimension: '3d',
    status: 'planned',
    statusReason:
      'It needs an external audio generation service; none is bundled, and the synthesized placeholder voices are deliberately not passed off as one. Produced files land as audio-file records, and the gate that blocks a missing one already runs.',
    core: false,
    signals: ['generate sound', 'sound generation', 'generated audio', 'audio generation', 'music generation', 'procedural music'],
    prerequisites: [
      'An external audio generator reachable from the harness, credential by environment-variable name only.',
      'Licensing terms recorded per produced file, because admission refuses an unlicensed file outright.',
      'The cue records whose placeholder voices the produced files replace, one for one.',
    ],
    tools: [
      'an external SFX or music generation service (none is bundled)',
      'the audio-file records and admission gate in kei-mmo/content/manifest.json',
      'the cue placement rules from the content-3d-audio packet, unchanged',
    ],
    methods: [
      { call: "manifest.assets.push({ id, kind: 'audio-file', source: { kind: 'generated', generator }, path: 'assets/audio/x.wav', licence })", does: 'The record a generator adapter must write; the placeholder synth stays until this admits.' },
      { call: 'admitAssets(manifest, probe).blocked.find((v) => v.code === "generator_output_missing")', does: 'A declared render with no bytes blocks admission, exactly as models do.' },
      { call: 'audio.decodeAudioData(await file.arrayBuffer())', does: 'Admitted audio decodes once into the same buffer cache the audio packet already specifies.' },
    ],
    acceptance: [
      'Declaring a generated audio file without its bytes blocks admission with generator_output_missing.',
      'No plan cites this packet while its status is planned; it appears in deferred, naming the status.',
    ],
  },
  {
    id: 'content-3d-voice-acting',
    domain: 'audio',
    title: 'Voice performance',
    summary:
      'Recorded or synthesized voice lines for characters and narration — not offered by this harness, for reasons no gate here can check away.',
    dimension: '3d',
    status: 'absent',
    statusReason:
      'Voice needs casting, consent, and licensing review that an offline gate cannot vouch for, and synthetic voices of real people are a line this harness does not go near. Record real performances and admit them as ordinary audio-file records with a licence.',
    core: false,
    signals: ['voice acting', 'voiceover', 'voice-over', 'voice lines', 'spoken dialogue', 'narration'],
    prerequisites: [
      'Performances recorded outside this harness, with the performer\'s consent and licence in hand.',
      'The audio-file admission path, which is how a finished line enters the manifest.',
    ],
    tools: [
      'no tool here — the decision is the point, and the audio-file records are the door back in',
    ],
    methods: [
      { call: "manifest.assets.push({ id, kind: 'audio-file', source: { kind: 'imported', origin: 'studio session' }, path, licence })", does: 'A finished, licensed line enters as an import; admission checks the bytes and the licence like any other file.' },
      { call: 'admitAssets(manifest, probe).blocked.find((v) => v.code === "missing_licence")', does: 'An unlicensed voice file is refused, which is the one check a harness can make.' },
      { call: 'cuePlacement = { cueId, atMs, gain }', does: 'Placement of an admitted line uses the same beat machinery as every other cue.' },
    ],
    acceptance: [
      'No plan cites this packet; it appears in deferred, naming the absent status and its reason.',
      'An imported voice line without a licence is blocked at admission.',
    ],
  },
] as const satisfies readonly CapabilityPacket[])

export function capabilityById(id: string): CapabilityPacket | undefined {
  return CAPABILITY_PACKETS.find((packet) => packet.id === id)
}

/** A packet in a plan, with the sentence saying how it got there. */
export interface SelectedCapability {
  readonly packet: CapabilityPacket
  readonly reason: string
}

/** A packet that is deliberately not in a plan, and why not. */
export interface DeferredCapability {
  readonly id: string
  readonly reason: string
}

export interface CapabilitySelection {
  readonly selected: readonly SelectedCapability[]
  readonly deferred: readonly DeferredCapability[]
}

/**
 * Which packets this plan gets. Dimension decides the rendering and animation
 * pair; an optional packet needs the intent to have asked for it, and when it
 * did not, the miss is recorded rather than dropped — "no audio goals were
 * given" is something the developer should be able to read back and disagree
 * with.
 *
 * Status is the binding rule on top: only an `available` packet may be
 * selected. A `planned` or `absent` one is deferred with its status named —
 * whether or not the intent asked for it — so the plan says what is not on
 * offer instead of implying it quietly is.
 */
export function selectCapabilities(
  dimension: '2d' | '3d',
  signalText: string,
): CapabilitySelection {
  const selected: SelectedCapability[] = []
  const deferred: DeferredCapability[] = []
  const haystack = signalText.toLowerCase()

  for (const packet of CAPABILITY_PACKETS) {
    if (packet.dimension !== 'any' && packet.dimension !== dimension) {
      if (packet.core) {
        deferred.push({
          id: packet.id,
          reason: `Only applies to a ${packet.dimension.toUpperCase()} project, and this plan is ${dimension.toUpperCase()}.`,
        })
      }
      continue
    }
    if (packet.status !== 'available') {
      const asked = packet.signals.find((signal) => haystack.includes(signal))
      const reason = packet.statusReason ?? 'No reason was recorded, which is itself a defect.'
      deferred.push({
        id: packet.id,
        reason: asked === undefined
          ? `Declared ${packet.status}: ${reason}`
          : `The intent mentions "${asked}", but this method is ${packet.status}: ${reason}`,
      })
      continue
    }
    if (packet.core) {
      selected.push({
        packet,
        reason:
          packet.dimension === 'any'
            ? 'Core to every MMO plan this harness produces.'
            : `Core to every ${dimension.toUpperCase()} plan.`,
      })
      continue
    }
    const hit = packet.signals.find((signal) => haystack.includes(signal))
    if (hit === undefined) {
      deferred.push({
        id: packet.id,
        reason: `Nothing in the intent asked for it. Name one of ${packet.signals.slice(0, 4).join(', ')} to pull it in.`,
      })
      continue
    }
    selected.push({ packet, reason: `The intent mentions "${hit}".` })
  }

  return Object.freeze({ selected: Object.freeze(selected), deferred: Object.freeze(deferred) })
}
