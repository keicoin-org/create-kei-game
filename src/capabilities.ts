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
 * or — where no library owns the problem, which is the case for a Kei economy —
 * a function signature this harness requires the project to define itself. The
 * second kind is marked as such in the packet's tools, because inventing an SDK
 * that does not exist is the exact failure this file is shaped to avoid.
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
      'A WebGL2 renderer driven by a fixed-step simulation clock, with instanced draw calls for the crowds an MMO puts on screen.',
    dimension: '3d',
    core: true,
    signals: [],
    prerequisites: [
      'A browser entry module served over HTTP with one <canvas> element it owns.',
      '`three` installed as a project dependency; the harness does not vendor it.',
      'Simulation state updated on a fixed step, separately from the render callback, so a slow frame never changes game outcomes.',
    ],
    tools: ['three (THREE.WebGLRenderer, WebGL2)', 'requestAnimationFrame', 'harness write_file'],
    methods: [
      { call: "new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })", does: 'Binds a GL context to the canvas the page already has.' },
      { call: 'renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))', does: 'Caps retina cost, which is the single largest fill-rate win on laptops.' },
      { call: 'renderer.setSize(width, height, false)', does: 'Resizes the drawing buffer without touching the canvas CSS size.' },
      { call: 'new THREE.PerspectiveCamera(60, width / height, 0.1, 2000)', does: 'The player camera; the far plane is the world streaming radius.' },
      { call: 'new THREE.InstancedMesh(geometry, material, maxCount)', does: 'One draw call for many copies of a mesh — trees, props, distant players.' },
      { call: 'mesh.setMatrixAt(index, matrix); mesh.instanceMatrix.needsUpdate = true', does: 'Moves one instance and marks the buffer for upload.' },
      { call: 'new THREE.Clock(); clock.getDelta()', does: 'The frame delta fed to the accumulator, not to the simulation directly.' },
      { call: 'renderer.render(scene, camera)', does: 'Draws one frame, from the state the fixed step already settled.' },
      { call: 'renderer.info.render.calls', does: 'The draw-call count to assert a budget against in a test.' },
    ],
    acceptance: [
      'The client boots to a rendered frame with an empty browser console.',
      'Resizing the window keeps the aspect ratio correct rather than stretching.',
      'Draw calls stay under the budget the plan sets with the target crowd on screen.',
    ],
  },
  {
    id: 'render-2d',
    domain: 'rendering',
    title: 'Two-dimensional tile and sprite rendering',
    summary:
      'A camera-transformed canvas that draws only the tiles and sprites inside the view rectangle, from one atlas.',
    dimension: '2d',
    core: true,
    signals: [],
    prerequisites: [
      'A browser entry module served over HTTP with one <canvas> element it owns.',
      'One packed texture atlas plus a frame table; per-sprite image files do not survive an MMO crowd.',
      'A camera in world units, and a single place that converts world to screen.',
    ],
    tools: ['CanvasRenderingContext2D', 'WebGL2 instanced quads for large crowds', 'createImageBitmap', 'harness write_file'],
    methods: [
      { call: "canvas.getContext('2d', { alpha: false, desynchronized: true })", does: 'An opaque context; alpha: false removes a per-frame compositing pass.' },
      { call: 'ctx.imageSmoothingEnabled = false', does: 'Keeps pixel art crisp when the camera zooms.' },
      { call: 'ctx.setTransform(zoom, 0, 0, zoom, -camera.x * zoom + width / 2, -camera.y * zoom + height / 2)', does: 'Applies the camera once per frame instead of per sprite.' },
      { call: 'ctx.drawImage(atlas, sx, sy, sw, sh, dx, dy, sw, sh)', does: 'Draws one atlas frame; the 9-argument form is the only one that takes a source rect.' },
      { call: 'await createImageBitmap(blob, { imageOrientation: "none" })', does: 'Decodes the atlas off the main thread before the first frame.' },
      { call: 'gl.vertexAttribDivisor(location, 1); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)', does: 'The WebGL2 escalation path: one draw call for every sprite on screen.' },
      { call: 'gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData)', does: 'Uploads the per-sprite transform buffer once per frame.' },
      { call: 'const firstTileX = Math.floor(camera.x / TILE) - 1', does: 'Culls the tile loop to the view rectangle instead of the map.' },
    ],
    acceptance: [
      'The client boots to a rendered frame with an empty browser console.',
      'Panning the camera to a map corner draws no tile outside the view rectangle.',
      'The frame budget holds with the target number of visible sprites.',
    ],
  },
  {
    id: 'animation-3d',
    domain: 'animation',
    title: 'Skeletal animation and blending',
    summary:
      'Named glTF clips driven by one mixer per character, cross-faded on state changes, updated from the same delta the renderer uses.',
    dimension: '3d',
    core: true,
    signals: [],
    prerequisites: [
      'glTF/GLB characters with clips named by the state machine that plays them (Idle, Run, Attack).',
      'A character state machine that owns transitions; the mixer plays what it is told and decides nothing.',
      'Rigged characters cloned with SkeletonUtils — a plain Object3D.clone() shares the skeleton and every copy animates identically.',
    ],
    tools: [
      'three (THREE.AnimationMixer, THREE.AnimationClip)',
      'three/examples/jsm/utils/SkeletonUtils.js',
      'three/examples/jsm/loaders/GLTFLoader.js',
    ],
    methods: [
      { call: 'const mixer = new THREE.AnimationMixer(characterRoot)', does: 'One mixer per animated character instance.' },
      { call: "THREE.AnimationClip.findByName(gltf.animations, 'Run')", does: 'Looks a clip up by name rather than by array index, which reorders when the artist re-exports.' },
      { call: 'const action = mixer.clipAction(clip); action.play()', does: 'Starts a clip; actions are cached per clip per mixer.' },
      { call: 'current.crossFadeTo(next, 0.2, false)', does: 'Blends between locomotion states without a pop.' },
      { call: 'action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true', does: 'One-shot actions such as an attack that must hold their last frame.' },
      { call: "mixer.addEventListener('finished', onActionFinished)", does: 'Returns the state machine to idle exactly when the clip ends.' },
      { call: 'mixer.update(deltaSeconds)', does: 'Advances every action; called once per frame per mixer.' },
      { call: "SkeletonUtils.clone(gltf.scene)", does: 'Clones a rigged mesh with its own skeleton so instances animate independently.' },
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
      'Project-owned shading, either as a full ShaderMaterial or as a patch into three\'s built-in program, with the raw WebGL2 path for when neither fits.',
    dimension: 'any',
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
    tools: ['three (THREE.ShaderMaterial, Material.onBeforeCompile)', 'WebGL2RenderingContext', 'GLSL ES 3.00'],
    methods: [
      { call: 'new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader, fragmentShader })', does: 'A material this project owns entirely, with no three lighting attached.' },
      { call: 'material.uniforms.uTime.value = elapsedSeconds', does: 'The per-frame uniform update: mutate the value, never replace the material.' },
      { call: "material.onBeforeCompile = (shader) => { shader.uniforms.uWind = wind; shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', WIND_CHUNK) }", does: 'Patches three\'s standard material so lighting and shadows keep working.' },
      { call: "material.customProgramCacheKey = () => 'wind-v1'", does: 'Stops three sharing one compiled program between differently patched materials.' },
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
    core: false,
    signals: [
      'bloom', 'glow', 'cinematic', 'atmosphere', 'atmospheric', 'post', 'hdr', 'tone',
      'depth of field', 'vignette', 'grade', 'grading', 'moody', 'neon',
    ],
    prerequisites: [
      'A working scene render; post-processing replaces the final render call, so it cannot come first.',
      'A resize path that resizes the composer as well as the renderer, or every pass renders at the first size forever.',
      'A frame timer, because a full-screen pass costs fill rate on exactly the machines an MMO cannot exclude.',
    ],
    tools: [
      'three/examples/jsm/postprocessing/EffectComposer.js',
      'three/examples/jsm/postprocessing/RenderPass.js',
      'three/examples/jsm/postprocessing/UnrealBloomPass.js',
      'three/examples/jsm/postprocessing/OutputPass.js',
    ],
    methods: [
      { call: 'const composer = new EffectComposer(renderer)', does: 'Owns the ping-pong render targets the passes read and write.' },
      { call: 'composer.addPass(new RenderPass(scene, camera))', does: 'The scene itself, as the first pass in the chain.' },
      { call: 'composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.6, 0.4, 0.85))', does: 'Bloom, in strength/radius/threshold order — the threshold is what keeps it off flat surfaces.' },
      { call: 'composer.addPass(new OutputPass())', does: 'Applies tone mapping and colour-space conversion once, at the end.' },
      { call: 'renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1', does: 'Maps HDR values into display range instead of clipping them.' },
      { call: 'composer.setSize(width, height); composer.setPixelRatio(renderer.getPixelRatio())', does: 'The resize path that must sit beside renderer.setSize.' },
      { call: 'composer.render(delta)', does: 'Replaces renderer.render for the frame.' },
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
    title: 'Authoritative sessions, replication, and reconciliation',
    summary:
      'One server owns the simulation and every client predicts it. Inputs go up, snapshots come down, and a client that lies changes nothing.',
    dimension: 'any',
    core: true,
    signals: [],
    prerequisites: [
      'The simulation extracted into a pure `step(state, inputs, dtSeconds)` that both sides can run — prediction is impossible without it.',
      'A wire schema with a fixed field order and a version byte, defined once in shared code.',
      'Every message validated on arrival: a client sends intent (a direction, a target) and never a result (a position, a balance).',
    ],
    tools: [
      'ws (WebSocketServer) on node:http, or a Cloudflare Durable Object as the room owner',
      'DataView / TypedArrays for the wire format',
      'the shared step() module',
    ],
    methods: [
      { call: 'const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 })', does: 'Caps payload size at the door; an unbounded frame is a memory attack.' },
      { call: "wss.on('connection', (socket, request) => attach(session, socket))", does: 'Session creation; authenticate here, before the socket joins a room.' },
      { call: "socket.on('message', (data, isBinary) => applyInput(session, decodeInput(data)))", does: 'Decode, validate, enqueue — never apply straight to state from inside the handler.' },
      { call: 'while (accumulator >= STEP_MS) { state = step(state, drainInputs(), STEP_MS / 1000); accumulator -= STEP_MS; tick += 1 }', does: 'The fixed tick; the accumulator is what keeps simulation time independent of wall-clock jitter.' },
      { call: 'const input = { seq, dtMs, moveX, moveY, buttons }', does: 'The only thing a client is allowed to author. Each carries a sequence number.' },
      { call: 'session.lastAckSeq = input.seq', does: 'What the server echoes back so the client knows which predictions are settled.' },
      { call: 'const patch = encodeDelta(snapshot, baselines.get(session.id) ?? EMPTY)', does: 'Sends the difference against what this client last acknowledged, not the whole world.' },
      { call: 'state = applySnapshot(snapshot); for (const pending of inputs.filter((i) => i.seq > snapshot.ackSeq)) state = step(state, pending, dt)', does: 'Client reconciliation: accept the server, then replay unacknowledged inputs.' },
      { call: 'const cell = `${x >> CELL_SHIFT}:${z >> CELL_SHIFT}`', does: 'Interest management: a player only receives entities in the neighbouring cells.' },
      { call: 'tokens = Math.min(BURST, tokens + elapsedMs * RATE); if (tokens < 1) return; tokens -= 1', does: 'Per-socket token bucket, so one client cannot flood a tick.' },
      { call: 'state.acceptWebSocket(server); async webSocketMessage(ws, message) {}; state.setAlarm(Date.now() + STEP_MS)', does: 'The Durable Object shape of the same loop, if the room owner is one.' },
    ],
    acceptance: [
      'Two clients on one server see each other move within the plan\'s latency budget.',
      'A client that stops sending input stops moving on every other client within one tick.',
      'A forged message claiming a position, an item, or a balance changes nothing on the server.',
      'A client with 200 ms of added latency still moves without rubber-banding on its own screen.',
    ],
  },
  {
    id: 'persistence-streaming',
    domain: 'persistence',
    title: 'World streaming and durable state',
    summary:
      'Chunks loaded and evicted around players, and character state written often enough that a crash costs one interval, not a session.',
    dimension: 'any',
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
      'A server-only ledger boundary with idempotent entries, two-phase trades, and supply that can be proved rather than hoped for.',
    dimension: 'any',
    core: true,
    signals: [],
    prerequisites: [
      'A Kei network endpoint and any credential referenced by environment-variable name. The harness never writes a key into the project, and neither may the game.',
      'Every economic action settled server-side. A client may request a trade; it may never author a balance.',
      'An idempotency key per action, because a client that reconnects mid-trade will retry it.',
      'Integer amounts in the smallest unit — bigint, never a float. Floating-point money is a duplication bug waiting for a decimal.',
    ],
    tools: [
      'a server-only src/economy/ledger.ts boundary module you define — this harness bundles no Kei SDK and will not pretend to',
      'the Kei endpoint your deployment targets, reached only from the server',
      'the persistence layer, for the ledger table and its unique index on the idempotency key',
    ],
    methods: [
      { call: "defineCurrency(id: string, options: { decimals: number; policy: 'fixed' | 'faucet' | 'sink-balanced' }): CurrencyDefinition", does: 'Declares a currency and, with it, whether new units can ever exist.' },
      { call: 'credit(accountId: string, currency: string, amount: bigint, reason: string, idempotencyKey: string): Promise<LedgerEntry>', does: 'The only way a balance goes up. The reason string is what an economy audit reads.' },
      { call: 'debit(accountId: string, currency: string, amount: bigint, reason: string, idempotencyKey: string): Promise<LedgerEntry>', does: 'The only way a balance goes down; refuses rather than going negative.' },
      { call: 'transfer(from: string, to: string, currency: string, amount: bigint, idempotencyKey: string): Promise<LedgerEntry[]>', does: 'One transaction containing both halves, or neither.' },
      { call: 'openEscrow(offer: TradeOffer): Promise<TradeId> / settleTrade(tradeId: TradeId): Promise<void>', does: 'Two-phase trade: goods leave inventories at open and land at settle, so a disconnect between them duplicates nothing.' },
      { call: 'mintItem(definitionId: string, ownerId: string, provenance: Provenance): Promise<ItemId>', does: 'Creates an item instance with the record of why it exists.' },
      { call: 'bindItem(itemId: ItemId, ownerId: string): Promise<void>', does: 'Soulbinding, which is the sink that keeps a drop from becoming currency.' },
      { call: 'supplyReport(currency: string): Promise<{ minted: bigint; burned: bigint; held: bigint }>', does: 'The invariant check: minted minus burned must equal the sum of balances.' },
      { call: 'faucetRate(windowMs: number) / sinkRate(windowMs: number)', does: 'Makes inflation observable while the game is running, instead of after players notice.' },
    ],
    acceptance: [
      'Replaying the same idempotency key twice moves value exactly once.',
      'After thousands of randomized trades, minted minus burned equals the sum of all balances.',
      'A client message cannot mint, credit, or transfer without a server-side rule allowing it.',
      'No credential or endpoint secret appears in any file the project commits.',
    ],
  },
  {
    id: 'ui-hud',
    domain: 'ui',
    title: 'HUD, input, and interface state',
    summary:
      'A DOM overlay that reads the same state the simulation writes, updated only when a value changes, and never measuring layout inside the frame.',
    dimension: 'any',
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
    core: false,
    signals: ['audio', 'sound', 'music', 'sfx', 'ambient', 'ambience', 'voice', 'soundtrack', 'score'],
    prerequisites: [
      'A user gesture before the first sound: every browser starts an AudioContext suspended, and autoplay policy will not be argued with.',
      'Decoded buffers cached; decodeAudioData per playback is a stutter.',
      'A voice cap, because an MMO will otherwise start a hundred footsteps at once.',
    ],
    tools: ['Web Audio API (AudioContext, GainNode)', 'three (THREE.AudioListener, THREE.PositionalAudio) for the 3D path'],
    methods: [
      { call: "const audio = new AudioContext(); addEventListener('pointerdown', () => audio.resume(), { once: true })", does: 'Creates the graph early and unlocks it on the first real gesture.' },
      { call: 'const buffer = await audio.decodeAudioData(await response.arrayBuffer())', does: 'Decodes once at load, into the buffer cache.' },
      { call: 'const source = audio.createBufferSource(); source.buffer = buffer; source.connect(sfxBus); source.start()', does: 'Plays one sound; a source node is single-use by design.' },
      { call: 'const sfxBus = audio.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(audio.destination)', does: 'Separate music and effect buses, so a settings slider is one gain node.' },
      { call: 'gain.gain.setTargetAtTime(0, audio.currentTime, 0.05)', does: 'Ramps rather than cuts; an abrupt gain change is an audible click.' },
      { call: 'const listener = new THREE.AudioListener(); camera.add(listener)', does: 'Ties the 3D listener to the camera the player is looking through.' },
      { call: 'const sound = new THREE.PositionalAudio(listener); sound.setRefDistance(10); emitter.add(sound)', does: 'Attaches a positional emitter to a scene object.' },
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
    core: true,
    signals: [],
    prerequisites: [
      'An assets manifest committed to the repository: id, path, byte size, content hash, licence.',
      'Binary assets referenced, never authored inline. The harness write tool is for text, and a base64 mesh in a source file is a mesh nobody can edit.',
      'A loading screen that can report progress and can fail loudly.',
    ],
    tools: [
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/loaders/DRACOLoader.js',
      'three/examples/jsm/loaders/KTX2Loader.js',
      'createImageBitmap for the 2D atlas path',
    ],
    methods: [
      { call: 'const manager = new THREE.LoadingManager(onLoad, onProgress, onError)', does: 'One place that knows what is still loading and what failed.' },
      { call: "const draco = new DRACOLoader().setDecoderPath('/draco/'); loader.setDRACOLoader(draco)", does: 'Geometry compression; the decoder files must actually be served from that path.' },
      { call: 'const ktx2 = new KTX2Loader().detectSupport(renderer); loader.setKTX2Loader(ktx2)', does: 'GPU-compressed textures, chosen per device rather than shipped as PNG.' },
      { call: 'THREE.Cache.enabled = true', does: 'Stops a second request for an asset two systems both want.' },
      { call: 'const { id, path, sha256, licence } = manifest.assets[index]', does: 'The manifest record; a missing licence field is a release blocker, not a warning.' },
      { call: 'texture.colorSpace = THREE.SRGBColorSpace', does: 'Albedo textures are sRGB; data textures are not. Getting this wrong washes the whole scene out.' },
      { call: 'geometry.computeBoundingSphere()', does: 'Frustum culling needs bounds; generated geometry has none until this is called.' },
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
      'A seeded, fixed-step simulation that produces the same tick hash every run, plus socket and ledger tests that need no network.',
    dimension: 'any',
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
      { call: 'expect(report.minted - report.burned).toBe(sumBalances(accounts))', does: 'The ledger invariant, run over randomized operations.' },
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
