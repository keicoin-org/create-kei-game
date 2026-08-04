/**
 * Rigs, motion clips, and the gate that keeps a scene honest about them.
 *
 * A clip here is a versioned keyframe document against a named rig — previs
 * grade, authored, and good enough to block a cut-scene with. Generated motion
 * (an ARDY-style text-to-motion service, a mocap import) arrives through the
 * same adapter seam and the same records; nothing downstream knows or cares
 * where a clip came from, only whether it is *ready*.
 *
 * Ready is a strict triple, borrowed deliberately from the ARDY service shape:
 * the record says `ready`, its clip version is the one this build speaks, and
 * the clip payload is actually present. Anything less fails closed. The gate's
 * one promise, enforced where scenes are assembled: **no document is ever
 * emitted that references a clip which is not ready.**
 */

export const RIG_VERSION = 1 as const
export const MOTION_CLIP_VERSION = 1 as const

/** Keyframe ceilings. A clip past these is a malfunction, not a long take. */
export const MAX_CLIP_TRACKS = 64
export const MAX_CLIP_KEYS = 600
export const MAX_CLIP_DURATION_MS = 30_000

// ── Rigs ─────────────────────────────────────────────────────────────────────

export interface RigNode {
  readonly id: string
  /** Absent on the root. Every other node must name a parent in the same rig. */
  readonly parent?: string
}

export interface RigDefinition {
  readonly rigVersion: typeof RIG_VERSION
  readonly id: string
  readonly title: string
  /** Standing height in metres, so imported models can be normalised to it. */
  readonly heightM: number
  readonly nodes: readonly RigNode[]
}

/**
 * The one rig this harness authors clips for: a blocking-grade biped. It is a
 * previs skeleton, not a deformation rig — eight nodes is enough to stage a
 * scene and nowhere near enough to ship an animation, and it says so.
 */
export const PREVIS_BIPED: RigDefinition = Object.freeze({
  rigVersion: RIG_VERSION,
  id: 'previs-biped',
  title: 'Previs biped (blocking grade)',
  heightM: 1.8,
  nodes: Object.freeze([
    { id: 'root' },
    { id: 'pelvis', parent: 'root' },
    { id: 'torso', parent: 'pelvis' },
    { id: 'head', parent: 'torso' },
    { id: 'arm-l', parent: 'torso' },
    { id: 'arm-r', parent: 'torso' },
    { id: 'leg-l', parent: 'pelvis' },
    { id: 'leg-r', parent: 'pelvis' },
  ] as const satisfies readonly RigNode[]),
})

export const RIGS: readonly RigDefinition[] = Object.freeze([PREVIS_BIPED])

export function rigById(id: string): RigDefinition | undefined {
  return RIGS.find((rig) => rig.id === id)
}

// ── Clip documents ───────────────────────────────────────────────────────────

export type ClipProperty = 'position' | 'rotation'

export interface ClipTrack {
  /** A node id in the clip's rig. Validated, not trusted. */
  readonly node: string
  readonly property: ClipProperty
  /** Seconds from clip start, strictly ascending, first at 0. */
  readonly times: readonly number[]
  /** One `[x, y, z]` per time. Rotation is Euler radians. */
  readonly values: readonly (readonly [number, number, number])[]
}

export interface MotionClipDoc {
  readonly clipVersion: typeof MOTION_CLIP_VERSION
  readonly id: string
  readonly title: string
  readonly rig: string
  readonly durationMs: number
  readonly loop: boolean
  readonly tracks: readonly ClipTrack[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVec3(value: unknown): value is readonly [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((part) => typeof part === 'number' && Number.isFinite(part))
  )
}

function parseTrack(value: unknown): ClipTrack | null {
  if (!isRecord(value)) return null
  if (typeof value.node !== 'string' || value.node === '') return null
  if (value.property !== 'position' && value.property !== 'rotation') return null
  const times = value.times
  const values = value.values
  if (!Array.isArray(times) || !Array.isArray(values)) return null
  if (times.length === 0 || times.length !== values.length) return null
  if (times.length > MAX_CLIP_KEYS) return null
  if (times[0] !== 0) return null
  let previous = -1
  for (const time of times) {
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time <= previous) return null
    previous = time
  }
  if (!values.every(isVec3)) return null
  return Object.freeze({
    node: value.node,
    property: value.property,
    times: Object.freeze([...times] as number[]),
    values: Object.freeze(values.map((vec) => Object.freeze([...vec]) as unknown as readonly [number, number, number])),
  })
}

/**
 * Defensive, in the catalog tradition: a document that is not exactly version
 * `1` and well-formed comes back `null` rather than half-parsed or thrown on.
 * A stale or foreign clip drops out of a registry; it never executes.
 */
export function parseMotionClipDoc(value: unknown): MotionClipDoc | null {
  if (!isRecord(value)) return null
  if (value.clipVersion !== MOTION_CLIP_VERSION) return null
  if (typeof value.id !== 'string' || value.id === '') return null
  if (typeof value.title !== 'string' || value.title === '') return null
  if (typeof value.rig !== 'string' || value.rig === '') return null
  if (
    typeof value.durationMs !== 'number' ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs <= 0 ||
    value.durationMs > MAX_CLIP_DURATION_MS
  ) {
    return null
  }
  if (typeof value.loop !== 'boolean') return null
  if (!Array.isArray(value.tracks) || value.tracks.length === 0 || value.tracks.length > MAX_CLIP_TRACKS) {
    return null
  }
  const tracks: ClipTrack[] = []
  for (const raw of value.tracks) {
    const track = parseTrack(raw)
    if (track === null) return null
    tracks.push(track)
  }
  return Object.freeze({
    clipVersion: MOTION_CLIP_VERSION,
    id: value.id,
    title: value.title,
    rig: value.rig,
    durationMs: value.durationMs,
    loop: value.loop,
    tracks: Object.freeze(tracks),
  })
}

/** Everything wrong with a clip against its rig, or empty when nothing is. */
export function validateClipAgainstRig(clip: MotionClipDoc, rig: RigDefinition): readonly string[] {
  const problems: string[] = []
  if (clip.rig !== rig.id) {
    problems.push(`clip "${clip.id}" targets rig "${clip.rig}", not "${rig.id}"`)
  }
  const nodes = new Set(rig.nodes.map((node) => node.id))
  for (const track of clip.tracks) {
    if (!nodes.has(track.node)) {
      problems.push(`clip "${clip.id}" animates "${track.node}", which is not a node of rig "${rig.id}"`)
    }
    const last = track.times[track.times.length - 1]!
    if (last * 1000 > clip.durationMs) {
      problems.push(`clip "${clip.id}" keys "${track.node}" past its own duration`)
    }
  }
  return Object.freeze(problems)
}

// ── The authored clip set ────────────────────────────────────────────────────

function clip(
  id: string,
  title: string,
  durationMs: number,
  loop: boolean,
  tracks: readonly ClipTrack[],
): MotionClipDoc {
  const doc = parseMotionClipDoc({
    clipVersion: MOTION_CLIP_VERSION,
    id,
    title,
    rig: PREVIS_BIPED.id,
    durationMs,
    loop,
    tracks,
  })
  if (doc === null) throw new Error(`authored clip "${id}" does not parse`)
  const problems = validateClipAgainstRig(doc, PREVIS_BIPED)
  if (problems.length > 0) throw new Error(problems.join('; '))
  return doc
}

function track(
  node: string,
  property: ClipProperty,
  keys: readonly (readonly [number, number, number, number])[],
): ClipTrack {
  return Object.freeze({
    node,
    property,
    times: Object.freeze(keys.map(([time]) => time)),
    values: Object.freeze(keys.map(([, x, y, z]) => Object.freeze([x, y, z]) as unknown as readonly [number, number, number])),
  })
}

/**
 * Previs-grade motion, authored as data. Nothing here claims to be final
 * animation; each clip is the blocking beat a cut-scene needs — enough that a
 * staged scene reads, and honest about being placeholder craft.
 */
export const MOTION_CLIPS: readonly MotionClipDoc[] = Object.freeze([
  clip('idle-breathe', 'Idle, breathing', 4000, true, [
    track('torso', 'position', [
      [0, 0, 1.05, 0],
      [2, 0, 1.07, 0],
      [4, 0, 1.05, 0],
    ]),
  ]),
  clip('walk-loop', 'Walk cycle (previs)', 2000, true, [
    track('root', 'position', [
      [0, 0, 0, 0],
      [2, 0, 0, 1.4],
    ]),
    track('leg-l', 'rotation', [
      [0, 0.5, 0, 0],
      [1, -0.5, 0, 0],
      [2, 0.5, 0, 0],
    ]),
    track('leg-r', 'rotation', [
      [0, -0.5, 0, 0],
      [1, 0.5, 0, 0],
      [2, -0.5, 0, 0],
    ]),
  ]),
  clip('turn-quarter', 'Quarter turn in place', 1500, false, [
    track('root', 'rotation', [
      [0, 0, 0, 0],
      [1.5, 0, Math.PI / 2, 0],
    ]),
  ]),
  clip('gesture-point', 'Point ahead', 2500, false, [
    track('arm-r', 'rotation', [
      [0, 0, 0, 0],
      [0.8, -1.2, 0, 0],
      [1.8, -1.2, 0, 0],
      [2.5, 0, 0, 0],
    ]),
  ]),
  clip('kneel-inspect', 'Kneel and inspect', 3000, false, [
    track('pelvis', 'position', [
      [0, 0, 0, 0],
      [1, 0, -0.35, 0],
      [2.2, 0, -0.35, 0],
      [3, 0, 0, 0],
    ]),
    track('head', 'rotation', [
      [0, 0, 0, 0],
      [1, 0.4, 0, 0],
      [2.2, 0.4, 0, 0],
      [3, 0, 0, 0],
    ]),
  ]),
] as const)

export function motionClipById(id: string): MotionClipDoc | undefined {
  return MOTION_CLIPS.find((entry) => entry.id === id)
}

// ── Records, the adapter seam, and the ready gate ────────────────────────────

export type ClipStatus = 'ready' | 'pending' | 'failed' | 'missing'

/**
 * One clip as an ingestion reported it. `clip` and `clipVersion` are only
 * meaningful on `ready`, and the gate checks them anyway, because a record is
 * a claim and the gate's whole job is not taking claims at their word.
 */
export interface MotionClipRecord {
  readonly id: string
  readonly status: ClipStatus
  /** Which adapter produced this record. */
  readonly adapter: string
  readonly clipVersion?: number
  readonly clip?: MotionClipDoc
  readonly reason?: string
}

/** One requested clip. The shape mirrors an ARDY generate call on purpose. */
export interface MotionIngestClipRequest {
  readonly id: string
  /** Text-to-motion prompt, for adapters that generate. */
  readonly prompt?: string
  readonly durationMs?: number
  /** Pinned, so a generated clip is reproducible. Never defaulted randomly. */
  readonly seed?: number
  /** Workspace-relative file, for adapters that import. */
  readonly path?: string
}

export interface MotionIngestRequest {
  readonly clips: readonly MotionIngestClipRequest[]
}

export interface MotionIngestReport {
  readonly adapter: string
  readonly clips: readonly MotionClipRecord[]
}

/** How an adapter looks at the workspace. Injected, so tests need no disk. */
export interface MotionProbe {
  stat(path: string): { readonly size: number } | null
}

/**
 * The seam a motion service plugs into. It is deliberately shaped so that an
 * ARDY-style generator drops in without changing any caller: a request carries
 * prompt, duration, and a pinned seed; a report carries one record per
 * requested clip, each with an explicit status — never a silent omission.
 * Adapters may be async services; everything downstream of the report is pure.
 */
export interface MotionAdapter {
  readonly id: string
  readonly title: string
  /** The capability packet this adapter is the implementation of. */
  readonly capability: string
  ingest(request: MotionIngestRequest, probe: MotionProbe): Promise<MotionIngestReport>
}

/** Records for authored clips, resolved synchronously against the catalog. */
export function authoredClipRecords(ids: readonly string[]): readonly MotionClipRecord[] {
  return Object.freeze(
    ids.map((id): MotionClipRecord => {
      const found = motionClipById(id)
      return found === undefined
        ? Object.freeze({
            id,
            status: 'missing' as const,
            adapter: 'authored-clips',
            reason: `no authored clip is called "${id}"`,
          })
        : Object.freeze({
            id,
            status: 'ready' as const,
            adapter: 'authored-clips',
            clipVersion: found.clipVersion,
            clip: found,
          })
    }),
  )
}

/**
 * The built-in adapter: the authored catalog, behind the same seam an external
 * generator would use. It generates nothing and says so.
 */
export const authoredMotionAdapter: MotionAdapter = Object.freeze({
  id: 'authored-clips',
  title: 'Authored previs clips',
  capability: 'content-3d-motion',
  async ingest(request: MotionIngestRequest): Promise<MotionIngestReport> {
    return Object.freeze({
      adapter: 'authored-clips',
      clips: authoredClipRecords(request.clips.map((entry) => entry.id)),
    })
  },
})

/**
 * The ARDY ready condition, kept as one function so it cannot drift: the
 * record claims ready, the clip payload is present, and its version is the one
 * this build speaks. A version from the future fails closed.
 */
export function isClipReady(record: MotionClipRecord): boolean {
  return (
    record.status === 'ready' &&
    record.clip !== undefined &&
    record.clipVersion === MOTION_CLIP_VERSION
  )
}

export interface MissingClip {
  readonly id: string
  readonly status: ClipStatus | 'unlisted'
  readonly reason: string
}

export type ReadyGateResult =
  | { readonly ok: true; readonly clips: ReadonlyMap<string, MotionClipDoc> }
  | { readonly ok: false; readonly missing: readonly MissingClip[] }

/**
 * The gate itself. Every required id must resolve to a ready record; the
 * failure lists every miss at once, in required order, so a caller fixes the
 * lot rather than discovering them one retry at a time.
 */
export function motionReadyGate(
  records: readonly MotionClipRecord[],
  requiredIds: readonly string[],
): ReadyGateResult {
  const byId = new Map<string, MotionClipRecord>()
  for (const record of records) {
    if (!byId.has(record.id)) byId.set(record.id, record)
  }

  const missing: MissingClip[] = []
  const clips = new Map<string, MotionClipDoc>()
  for (const id of [...new Set(requiredIds)]) {
    const record = byId.get(id)
    if (record === undefined) {
      missing.push({ id, status: 'unlisted', reason: `no ingestion reported a clip "${id}"` })
      continue
    }
    if (!isClipReady(record)) {
      missing.push({
        id,
        status: record.status,
        reason:
          record.reason ??
          (record.status === 'ready'
            ? `record for "${id}" claims ready but carries no usable clip payload`
            : `clip "${id}" is ${record.status}`),
      })
      continue
    }
    clips.set(id, record.clip!)
  }

  return missing.length > 0
    ? Object.freeze({ ok: false, missing: Object.freeze(missing) })
    : Object.freeze({ ok: true, clips })
}
