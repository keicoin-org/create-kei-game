/**
 * Directed cut-scenes, as a staged pipeline: plan → stage → beats → rehearse →
 * assemble. The shape is borrowed from working previs direction tooling; the
 * discipline is this harness's own.
 *
 * Every stage is a pure function, every output is a versioned document, and
 * the whole flow is deterministic — the same inputs assemble the same scene,
 * byte for byte, with no clock and no randomness anywhere. Variation comes
 * from the inputs, never from a dice roll.
 *
 * Rehearsal here is the checking pass, not a performance: it walks the staged
 * scene and every beat, and reports every violation at once — a clip that is
 * not ready, a cue that was never admitted, a beat outside its bounds.
 * Assembly refuses a failed rehearsal outright. That is the gate's promise,
 * stated once and enforced in one place: **a scene document referencing a
 * missing clip is never emitted.** When a reference cannot be satisfied, the
 * honest alternatives are to fail, or to strip the reference and let the
 * actor hold — never to ship the dangling reference and let a player find it.
 */

import { motionReadyGate, type MotionClipRecord } from './motion.js'
import type { StyleFinish, StyleProfile, StyleSetting } from './style.js'

export const CUTSCENE_PLAN_VERSION = 1 as const
export const CUTSCENE_DOC_VERSION = 1 as const

/** The published bounds. Rehearsal enforces them; nothing may widen them. */
export const MAX_CUTSCENE_CAST = 6
export const MAX_CUTSCENE_PROPS = 8
export const MAX_CUTSCENE_BEATS = 12
export const MIN_BEAT_MS = 500
export const MAX_BEAT_MS = 12_000
export const MAX_CUTSCENE_MS = 60_000

/**
 * The camera grammar, by reference: a beat stores a kind and parameters, never
 * baked keyframes, so the player interprets the move and a stale document can
 * never smuggle in geometry this build did not compute. An unknown kind plays
 * as a hold — degraded, visible, and safe — exactly like the catalogs this
 * pattern comes from.
 */
export const CAMERA_MOVE_KINDS = ['static', 'push-in', 'pull-back', 'orbit-quarter'] as const

export type CameraMoveKind = (typeof CAMERA_MOVE_KINDS)[number]

export interface CameraMoveRef {
  readonly kind: CameraMoveKind
  readonly params: { readonly distanceM?: number; readonly degrees?: number }
}

export type CutSceneErrorCode =
  | 'invalid_plan'
  | 'rehearsal_failed'

export class CutSceneError extends Error {
  override readonly name = 'CutSceneError'

  constructor(
    readonly code: CutSceneErrorCode,
    message: string,
    readonly failures: readonly RehearsalFailure[] = [],
  ) {
    super(message)
  }
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export interface CutSceneCast {
  readonly id: string
  readonly title: string
  readonly rig: string
  /** The clips this member performs, by role in the scene's arc. */
  readonly clips: {
    readonly hold: string
    readonly move: string
    readonly feature: string
  }
}

export interface CutSceneCues {
  readonly ambience?: string
  readonly accent?: string
  readonly sting?: string
}

export interface CutScenePlanInput {
  readonly project: { readonly title: string; readonly slug: string }
  readonly style: StyleProfile
  readonly cast: readonly CutSceneCast[]
  /** Who the scene is about. Must be a cast id. */
  readonly subjectId: string
  /** Admitted prop asset ids, in the order they matter. First is the anchor. */
  readonly propIds: readonly string[]
  /** Admitted cue asset ids, when audio is in the plan at all. */
  readonly cues: CutSceneCues
}

export interface CutScenePlan {
  readonly cutscenePlanVersion: typeof CUTSCENE_PLAN_VERSION
  readonly id: string
  readonly title: string
  readonly logline: string
  readonly setting: StyleSetting
  readonly finish: StyleFinish
  readonly cast: readonly CutSceneCast[]
  readonly subjectId: string
  readonly propIds: readonly string[]
  readonly cues: CutSceneCues
}

const ARRIVAL_TITLES: Readonly<Record<StyleSetting, string>> = Object.freeze({
  'science-fiction': 'First docking',
  contemporary: 'First shift',
  historical: 'First landing',
  fantasy: 'First crossing',
  unspecified: 'First arrival',
})

function invalidPlan(message: string): never {
  throw new CutSceneError('invalid_plan', message)
}

/**
 * The plan: who is in the scene, where it happens, what it is called. Pure
 * derivation from the inputs — the style names the title, the cast and props
 * name the content, and nothing here invents a setting the style did not earn.
 */
export function planCutScene(input: CutScenePlanInput): CutScenePlan {
  if (input.project.slug.trim() === '' || input.project.title.trim() === '') {
    invalidPlan('A cut-scene plan needs the project title and slug.')
  }
  if (input.cast.length === 0 || input.cast.length > MAX_CUTSCENE_CAST) {
    invalidPlan(`A cut-scene casts between 1 and ${MAX_CUTSCENE_CAST} members.`)
  }
  const ids = new Set<string>()
  for (const member of input.cast) {
    if (member.id.trim() === '' || ids.has(member.id)) invalidPlan('Cast ids must be present and unique.')
    ids.add(member.id)
  }
  if (!ids.has(input.subjectId)) invalidPlan('The subject must be a cast member.')
  if (input.propIds.length > MAX_CUTSCENE_PROPS) {
    invalidPlan(`A cut-scene stages at most ${MAX_CUTSCENE_PROPS} props.`)
  }

  const subject = input.cast.find((member) => member.id === input.subjectId)!
  return Object.freeze({
    cutscenePlanVersion: CUTSCENE_PLAN_VERSION,
    id: `${input.project.slug}-arrival`,
    title: `${input.project.title} — ${ARRIVAL_TITLES[input.style.setting]}`,
    logline: `${subject.title} arrives, takes stock, and the world answers.`,
    setting: input.style.setting,
    finish: input.style.finish,
    cast: Object.freeze([...input.cast]),
    subjectId: input.subjectId,
    propIds: Object.freeze([...input.propIds]),
    cues: Object.freeze({ ...input.cues }),
  })
}

// ── Stage ────────────────────────────────────────────────────────────────────

export type PlacementKind = 'actor' | 'prop' | 'camera'

export interface StagePlacement {
  readonly id: string
  readonly kind: PlacementKind
  /** Cast id, prop asset id, or camera name. */
  readonly ref: string
  /** Metres. y is up; actors and props sit on the floor at y 0. */
  readonly position: readonly [number, number, number]
  readonly facingDeg?: number
  /** Cameras only. */
  readonly lookAt?: readonly [number, number, number]
  readonly fovDeg?: number
}

export interface StagedCutScene {
  readonly placements: readonly StagePlacement[]
}

function vec3(x: number, y: number, z: number): readonly [number, number, number] {
  return Object.freeze([x, y, z]) as unknown as readonly [number, number, number]
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Deterministic blocking: props on an arc upstage, the cast downstage facing
 * them, two cameras — a wide and a close — aimed where the scene is. Layout
 * varies with the inputs (count and order), never with a random number.
 */
export function stageCutScene(plan: CutScenePlan): StagedCutScene {
  const placements: StagePlacement[] = []

  const propCount = plan.propIds.length
  for (const [index, propId] of plan.propIds.entries()) {
    // An arc from -60° to +60° upstage, walked in prop order.
    const angle = propCount === 1 ? 0 : -60 + (120 / (propCount - 1)) * index
    const radians = (angle * Math.PI) / 180
    placements.push(Object.freeze({
      id: `prop-${propId}`,
      kind: 'prop' as const,
      ref: propId,
      position: vec3(round(Math.sin(radians) * 4), 0, round(-Math.cos(radians) * 4)),
      facingDeg: round(angle + 180),
    }))
  }

  for (const [index, member] of plan.cast.entries()) {
    const isSubject = member.id === plan.subjectId
    // The subject takes centre downstage; everyone else steps off to the side.
    const offset = isSubject ? 0 : (index + 1) * (index % 2 === 0 ? 1.5 : -1.5)
    placements.push(Object.freeze({
      id: `actor-${member.id}`,
      kind: 'actor' as const,
      ref: member.id,
      position: vec3(round(offset), 0, isSubject ? 6 : 7),
      facingDeg: 180,
    }))
  }

  placements.push(Object.freeze({
    id: 'cam-wide',
    kind: 'camera' as const,
    ref: 'cam-wide',
    position: vec3(7, 3.2, 9),
    lookAt: vec3(0, 1, 0),
    fovDeg: 55,
  }))
  placements.push(Object.freeze({
    id: 'cam-close',
    kind: 'camera' as const,
    ref: 'cam-close',
    position: vec3(1.5, 1.6, 2.5),
    lookAt: vec3(0, 1.2, -2),
    fovDeg: 40,
  }))

  return Object.freeze({ placements: Object.freeze(placements) })
}

// ── Beats ────────────────────────────────────────────────────────────────────

export interface BeatAction {
  readonly actorId: string
  readonly clipId: string
  readonly loop: boolean
}

export interface BeatCue {
  readonly cueId: string
  /** Offset into the beat. */
  readonly atMs: number
  readonly gain: number
  /** Diegetic cues anchor to a placement and fall off over the radius. */
  readonly spatial?: { readonly anchorId: string; readonly radiusM: number }
}

export interface CutSceneBeat {
  readonly id: string
  readonly title: string
  /** One derived sentence saying what reads on screen. */
  readonly line: string
  readonly durationMs: number
  readonly camera: { readonly placementId: string; readonly move: CameraMoveRef }
  readonly actions: readonly BeatAction[]
  readonly cues: readonly BeatCue[]
}

export interface CutSceneBeats {
  readonly beats: readonly CutSceneBeat[]
}

function move(kind: CameraMoveKind, params: CameraMoveRef['params'] = {}): CameraMoveRef {
  return Object.freeze({ kind, params: Object.freeze({ ...params }) })
}

/**
 * The arrival arc, written against what is actually in the plan: establish,
 * approach, feature, reveal. Everyone not featured holds. Cues land only where
 * the plan carries one — a plan without audio produces beats without audio,
 * not beats with dangling cue ids.
 */
export function cutSceneBeats(plan: CutScenePlan, staged: StagedCutScene): CutSceneBeats {
  const subject = plan.cast.find((member) => member.id === plan.subjectId)!
  const others = plan.cast.filter((member) => member.id !== plan.subjectId)
  const anchorProp = plan.propIds[0]
  const anchorPlacement = anchorProp === undefined ? undefined : `prop-${anchorProp}`
  const anchorTitle = anchorProp ?? 'the set'
  void staged

  const holdAll = (except?: string): readonly BeatAction[] =>
    Object.freeze(
      plan.cast
        .filter((member) => member.id !== except)
        .map((member) => Object.freeze({ actorId: member.id, clipId: member.clips.hold, loop: true })),
    )

  const beats: CutSceneBeat[] = []

  beats.push(Object.freeze({
    id: 'beat-1',
    title: 'Establish',
    line: `Wide on the set; ${subject.title} holds at the edge.`,
    durationMs: 6000,
    camera: Object.freeze({ placementId: 'cam-wide', move: move('static') }),
    actions: holdAll(),
    cues: plan.cues.ambience === undefined
      ? Object.freeze([])
      : Object.freeze([
          Object.freeze({
            cueId: plan.cues.ambience,
            atMs: 0,
            gain: 0.8,
            ...(anchorPlacement === undefined
              ? {}
              : { spatial: Object.freeze({ anchorId: anchorPlacement, radiusM: 20 }) }),
          }),
        ]),
  }))

  beats.push(Object.freeze({
    id: 'beat-2',
    title: 'Approach',
    line: `${subject.title} crosses toward ${anchorTitle}.`,
    durationMs: 5000,
    camera: Object.freeze({ placementId: 'cam-wide', move: move('push-in', { distanceM: 2.5 }) }),
    actions: Object.freeze([
      Object.freeze({ actorId: subject.id, clipId: subject.clips.move, loop: true }),
      ...holdAll(subject.id),
    ]),
    cues: Object.freeze([]),
  }))

  beats.push(Object.freeze({
    id: 'beat-3',
    title: 'Feature',
    line: `Close: ${subject.title} takes the measure of ${anchorTitle}.`,
    durationMs: 5000,
    camera: Object.freeze({ placementId: 'cam-close', move: move('static') }),
    actions: Object.freeze([
      Object.freeze({ actorId: subject.id, clipId: subject.clips.feature, loop: false }),
      ...holdAll(subject.id),
    ]),
    cues: plan.cues.accent === undefined
      ? Object.freeze([])
      : Object.freeze([
          Object.freeze({
            cueId: plan.cues.accent,
            atMs: 600,
            gain: 0.9,
            ...(anchorPlacement === undefined
              ? {}
              : { spatial: Object.freeze({ anchorId: anchorPlacement, radiusM: 8 }) }),
          }),
        ]),
  }))

  beats.push(Object.freeze({
    id: 'beat-4',
    title: 'Reveal',
    line: others.length > 0
      ? `The camera circles; the ${others.length === 1 ? 'other' : 'others'} come into view behind ${subject.title}.`
      : `The camera circles ${subject.title}; the whole set comes into view.`,
    durationMs: 6000,
    camera: Object.freeze({ placementId: 'cam-close', move: move('orbit-quarter', { degrees: 90 }) }),
    actions: holdAll(),
    cues: plan.cues.sting === undefined
      ? Object.freeze([])
      : Object.freeze([Object.freeze({ cueId: plan.cues.sting, atMs: 0, gain: 1 })]),
  }))

  return Object.freeze({ beats: Object.freeze(beats) })
}

// ── Rehearsal ────────────────────────────────────────────────────────────────

export type RehearsalFailureCode =
  | 'too_many_beats'
  | 'beat_too_short'
  | 'beat_too_long'
  | 'cutscene_too_long'
  | 'unknown_camera'
  | 'unknown_move'
  | 'unknown_actor'
  | 'unstaged_actor'
  | 'missing_clip'
  | 'cue_not_admitted'
  | 'prop_not_admitted'
  | 'spatial_anchor_unstaged'

export interface RehearsalFailure {
  readonly code: RehearsalFailureCode
  /** Where in the documents the problem sits, dotted-path style. */
  readonly at: string
  readonly reason: string
}

export interface RehearsalReport {
  readonly ok: boolean
  readonly checked: {
    readonly beats: number
    readonly actions: number
    readonly cues: number
  }
  readonly failures: readonly RehearsalFailure[]
}

export interface RehearsalInputs {
  /** Every clip record ingestion produced, from any adapter. */
  readonly clipRecords: readonly MotionClipRecord[]
  /** Asset ids the admission gate admitted. Nothing else exists on set. */
  readonly admitted: ReadonlySet<string>
}

/**
 * The checking pass. It looks at everything and reports everything — one run
 * says every way the scene is not ready, so the fix is one pass rather than a
 * discovery loop. Nothing here mutates or repairs; `stripUnready` is the
 * explicit, separate repair, and assembly accepts only a clean report.
 */
export function rehearseCutScene(
  plan: CutScenePlan,
  staged: StagedCutScene,
  beats: CutSceneBeats,
  inputs: RehearsalInputs,
): RehearsalReport {
  const failures: RehearsalFailure[] = []
  const placements = new Map(staged.placements.map((placement) => [placement.id, placement]))
  const castIds = new Set(plan.cast.map((member) => member.id))

  if (beats.beats.length > MAX_CUTSCENE_BEATS) {
    failures.push({
      code: 'too_many_beats',
      at: 'beats',
      reason: `${beats.beats.length} beats is over the ${MAX_CUTSCENE_BEATS}-beat bound`,
    })
  }
  const totalMs = beats.beats.reduce((total, beat) => total + beat.durationMs, 0)
  if (totalMs > MAX_CUTSCENE_MS) {
    failures.push({
      code: 'cutscene_too_long',
      at: 'beats',
      reason: `${totalMs} ms is over the ${MAX_CUTSCENE_MS} ms bound`,
    })
  }

  for (const propId of plan.propIds) {
    if (!inputs.admitted.has(propId)) {
      failures.push({
        code: 'prop_not_admitted',
        at: `plan.propIds.${propId}`,
        reason: `prop "${propId}" was never admitted, so it cannot be staged`,
      })
    }
  }

  let actions = 0
  let cues = 0
  const requiredClips = new Set<string>()

  for (const [index, beat] of beats.beats.entries()) {
    const at = `beats[${index}]`
    if (beat.durationMs < MIN_BEAT_MS) {
      failures.push({ code: 'beat_too_short', at, reason: `${beat.durationMs} ms is under the ${MIN_BEAT_MS} ms floor` })
    }
    if (beat.durationMs > MAX_BEAT_MS) {
      failures.push({ code: 'beat_too_long', at, reason: `${beat.durationMs} ms is over the ${MAX_BEAT_MS} ms ceiling` })
    }

    const camera = placements.get(beat.camera.placementId)
    if (camera === undefined || camera.kind !== 'camera') {
      failures.push({
        code: 'unknown_camera',
        at: `${at}.camera`,
        reason: `"${beat.camera.placementId}" is not a staged camera`,
      })
    }
    if (!CAMERA_MOVE_KINDS.includes(beat.camera.move.kind)) {
      failures.push({
        code: 'unknown_move',
        at: `${at}.camera.move`,
        reason: `"${beat.camera.move.kind}" is not a camera move this build generates`,
      })
    }

    for (const action of beat.actions) {
      actions += 1
      requiredClips.add(action.clipId)
      if (!castIds.has(action.actorId)) {
        failures.push({
          code: 'unknown_actor',
          at: `${at}.actions.${action.actorId}`,
          reason: `"${action.actorId}" is not in the cast`,
        })
      } else if (!placements.has(`actor-${action.actorId}`)) {
        failures.push({
          code: 'unstaged_actor',
          at: `${at}.actions.${action.actorId}`,
          reason: `"${action.actorId}" was never placed on the stage`,
        })
      }
    }

    for (const [cueIndex, cue] of beat.cues.entries()) {
      cues += 1
      if (!inputs.admitted.has(cue.cueId)) {
        failures.push({
          code: 'cue_not_admitted',
          at: `${at}.cues[${cueIndex}]`,
          reason: `cue "${cue.cueId}" was never admitted, so it cannot be placed`,
        })
      }
      if (cue.spatial !== undefined && !placements.has(cue.spatial.anchorId)) {
        failures.push({
          code: 'spatial_anchor_unstaged',
          at: `${at}.cues[${cueIndex}]`,
          reason: `cue "${cue.cueId}" anchors to "${cue.spatial.anchorId}", which is not staged`,
        })
      }
    }
  }

  // The ready gate proper: every clip any beat references, resolved against
  // the ingestion records, all misses reported at once.
  const gate = motionReadyGate(inputs.clipRecords, [...requiredClips].sort())
  if (!gate.ok) {
    for (const miss of gate.missing) {
      failures.push({
        code: 'missing_clip',
        at: `clips.${miss.id}`,
        reason: miss.reason,
      })
    }
  }

  return Object.freeze({
    ok: failures.length === 0,
    checked: Object.freeze({ beats: beats.beats.length, actions, cues }),
    failures: Object.freeze(failures),
  })
}

// ── Repair: strip, never dangle ──────────────────────────────────────────────

export interface StrippedBeats {
  readonly beats: CutSceneBeats
  readonly removedActions: number
  readonly removedCues: number
  readonly notes: readonly string[]
}

/**
 * The one repair this pipeline performs, and the only honest one that needs no
 * new information: drop the reference that cannot be satisfied. An actor whose
 * clip is not ready holds instead of performing; a cue that was never admitted
 * simply does not play. Structural failures — a beat out of bounds, a camera
 * that does not exist — are not strippable and stay failed, because deleting
 * the scene's shape to pass rehearsal would be the dishonest fix.
 */
export function stripUnready(beats: CutSceneBeats, report: RehearsalReport): StrippedBeats {
  const missingClips = new Set(
    report.failures
      .filter((failure) => failure.code === 'missing_clip')
      .map((failure) => failure.at.slice('clips.'.length)),
  )
  const blockedCues = new Set(
    report.failures
      .filter((failure) => failure.code === 'cue_not_admitted')
      .map((failure) => failure.reason.match(/^cue "([^"]+)"/)?.[1])
      .filter((id): id is string => id !== undefined),
  )

  let removedActions = 0
  let removedCues = 0
  const notes: string[] = []

  const stripped = beats.beats.map((beat) => {
    const actions = beat.actions.filter((action) => {
      if (!missingClips.has(action.clipId)) return true
      removedActions += 1
      notes.push(`${beat.id}: ${action.actorId} holds — clip "${action.clipId}" is not ready`)
      return false
    })
    const cues = beat.cues.filter((cue) => {
      if (!blockedCues.has(cue.cueId)) return true
      removedCues += 1
      notes.push(`${beat.id}: cue "${cue.cueId}" dropped — never admitted`)
      return false
    })
    return Object.freeze({ ...beat, actions: Object.freeze(actions), cues: Object.freeze(cues) })
  })

  return Object.freeze({
    beats: Object.freeze({ beats: Object.freeze(stripped) }),
    removedActions,
    removedCues,
    notes: Object.freeze(notes),
  })
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export interface AssembledBeat extends CutSceneBeat {
  /** Absolute, accumulated from the beats before it. */
  readonly startMs: number
}

export interface CutSceneDocument {
  readonly cutsceneVersion: typeof CUTSCENE_DOC_VERSION
  readonly id: string
  readonly title: string
  readonly logline: string
  readonly setting: StyleSetting
  readonly finish: StyleFinish
  readonly stage: readonly StagePlacement[]
  readonly beats: readonly AssembledBeat[]
  readonly durationMs: number
  /** Everything the document references, sorted, so a loader can preflight. */
  readonly assets: {
    readonly clips: readonly string[]
    readonly cues: readonly string[]
    readonly props: readonly string[]
  }
  readonly provenance: {
    readonly tool: 'create-kei-mmo'
    readonly workflow: 'workflow-cutscene'
  }
}

/**
 * Assembly is a formality by design: all the judgement happened upstream, and
 * this refuses to run without a clean rehearsal — which is precisely how the
 * missing-clip promise is kept. What comes out is a plain document a project
 * plays with its own code, long after this harness is deleted.
 */
export function assembleCutScene(
  plan: CutScenePlan,
  staged: StagedCutScene,
  beats: CutSceneBeats,
  rehearsal: RehearsalReport,
): CutSceneDocument {
  if (!rehearsal.ok) {
    throw new CutSceneError(
      'rehearsal_failed',
      'The cut-scene did not pass rehearsal, so no document is assembled.',
      rehearsal.failures,
    )
  }

  let startMs = 0
  const assembled: AssembledBeat[] = []
  for (const beat of beats.beats) {
    assembled.push(Object.freeze({ ...beat, startMs }))
    startMs += beat.durationMs
  }

  const clips = new Set<string>()
  const cues = new Set<string>()
  for (const beat of beats.beats) {
    for (const action of beat.actions) clips.add(action.clipId)
    for (const cue of beat.cues) cues.add(cue.cueId)
  }

  const stage = [...staged.placements].sort((left, right) => left.id.localeCompare(right.id))

  return Object.freeze({
    cutsceneVersion: CUTSCENE_DOC_VERSION,
    id: plan.id,
    title: plan.title,
    logline: plan.logline,
    setting: plan.setting,
    finish: plan.finish,
    stage: Object.freeze(stage),
    beats: Object.freeze(assembled),
    durationMs: startMs,
    assets: Object.freeze({
      clips: Object.freeze([...clips].sort()),
      cues: Object.freeze([...cues].sort()),
      props: Object.freeze([...plan.propIds].sort()),
    }),
    provenance: Object.freeze({ tool: 'create-kei-mmo', workflow: 'workflow-cutscene' }),
  })
}

/** Defensive, catalog-style: not exactly this shape and version → `null`. */
export function parseCutSceneDocument(value: unknown): CutSceneDocument | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.cutsceneVersion !== CUTSCENE_DOC_VERSION) return null
  if (typeof record.id !== 'string' || record.id === '') return null
  if (typeof record.title !== 'string') return null
  if (!Array.isArray(record.stage) || !Array.isArray(record.beats)) return null
  if (typeof record.durationMs !== 'number' || !Number.isFinite(record.durationMs)) return null
  for (const beat of record.beats) {
    const entry = beat as Record<string, unknown>
    if (typeof entry.id !== 'string' || typeof entry.startMs !== 'number' || typeof entry.durationMs !== 'number') {
      return null
    }
    if (!Array.isArray(entry.actions) || !Array.isArray(entry.cues)) return null
  }
  return value as CutSceneDocument
}
