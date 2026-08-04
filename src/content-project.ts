/**
 * What the content pipelines put *into a scaffolded 3D project*: the manifest,
 * the pipeline records, the assembled intro cut-scene, a player module, and a
 * check script — every one of them plain, readable, and owned by the project.
 *
 * The harness runs the whole pipeline here, for real, at scaffold time:
 * admission over the starter manifest, the ready gate over the clips the scene
 * needs, rehearsal over the beats, then assembly. If any of that fails for the
 * content this file itself authored, that is a harness defect and it fails
 * loudly rather than shipping a scene it could not vouch for.
 *
 * Nothing written here imports this harness. The player is self-contained
 * TypeScript; the check script is plain Node with no dependencies. Deleting
 * the harness leaves both working, which is the test that matters.
 */

import {
  admitAssets,
  audioPaletteFor,
  propKitFor,
  CONTENT_MANIFEST_VERSION,
  CONTENT_WORKFLOWS,
  type AssetRecord,
  type ContentManifest,
} from './content.js'
import {
  assembleCutScene,
  cutSceneBeats,
  planCutScene,
  rehearseCutScene,
  stageCutScene,
  stripUnready,
  type CutSceneCues,
  type CutSceneDocument,
} from './cutscene.js'
import { fail } from './errors.js'
import { authoredClipRecords, MOTION_CLIPS, PREVIS_BIPED } from './motion.js'
import type { ContentPlan, ImplementationPlan } from './plan.js'
import type { ProjectIdentity, WorkspaceFile } from './source.js'

export const CONTENT_DIRECTORY = 'kei-mmo/content'
export const CONTENT_MANIFEST_PATH = `${CONTENT_DIRECTORY}/manifest.json`
export const CONTENT_PIPELINES_PATH = `${CONTENT_DIRECTORY}/pipelines.json`
export const CONTENT_CHECK_PATH = `${CONTENT_DIRECTORY}/check.mjs`
export const CUTSCENE_DIRECTORY = `${CONTENT_DIRECTORY}/cutscenes`
export const CUTSCENE_PLAYER_PATH = 'src/shared/cutscene.ts'

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** The starter manifest: everything the plan's selections said, as records. */
export function starterManifest(content: ContentPlan, withAudio: boolean): ContentManifest {
  const kit = propKitFor(content.style.setting)
  const palette = audioPaletteFor(content.style.setting)

  const assets: AssetRecord[] = [
    ...kit.props.map((spec): AssetRecord => ({
      id: spec.id,
      kind: 'prop-spec',
      title: spec.title,
      source: { kind: 'authored' },
      style: content.style.setting,
      data: spec,
    })),
    {
      id: PREVIS_BIPED.id,
      kind: 'rig',
      title: PREVIS_BIPED.title,
      source: { kind: 'authored' },
      data: PREVIS_BIPED,
    },
    ...MOTION_CLIPS.map((clip): AssetRecord => ({
      id: clip.id,
      kind: 'motion-clip',
      title: clip.title,
      source: { kind: 'authored' },
      data: clip,
    })),
    ...(withAudio
      ? palette.cues.map((cue): AssetRecord => ({
          id: cue.id,
          kind: 'audio-cue',
          title: cue.title,
          source: { kind: 'authored' },
          style: content.style.setting,
          data: cue,
        }))
      : []),
  ]

  return Object.freeze({ manifestVersion: CONTENT_MANIFEST_VERSION, assets: Object.freeze(assets) })
}

/** The intro scene, run through the whole pipeline. Deterministic end to end. */
export function starterCutScene(
  project: ProjectIdentity,
  content: ContentPlan,
  manifest: ContentManifest,
  withAudio: boolean,
): CutSceneDocument {
  const admission = admitAssets(manifest)
  if (!admission.ok) {
    fail(`The starter manifest failed its own admission gate — a harness defect: ${admission.blocked
      .map((verdict) => `${verdict.id}: ${verdict.reason}`)
      .join('; ')}`)
  }

  const kit = propKitFor(content.style.setting)
  const palette = audioPaletteFor(content.style.setting)
  const cues: CutSceneCues = withAudio
    ? {
        ambience: palette.cues.find((cue) => cue.category === 'ambience')?.id,
        accent: palette.cues.find((cue) => cue.category === 'sfx')?.id,
        sting: palette.cues.find((cue) => cue.category === 'music')?.id,
      }
    : {}

  const plan = planCutScene({
    project: { title: project.title, slug: project.slug },
    style: content.style,
    cast: [
      {
        id: 'newcomer',
        title: 'The newcomer',
        rig: PREVIS_BIPED.id,
        clips: { hold: 'idle-breathe', move: 'walk-loop', feature: 'kneel-inspect' },
      },
    ],
    subjectId: 'newcomer',
    propIds: kit.props.map((spec) => spec.id),
    cues,
  })

  const staged = stageCutScene(plan)
  const beats = cutSceneBeats(plan, staged)
  const inputs = {
    clipRecords: authoredClipRecords(MOTION_CLIPS.map((clip) => clip.id)),
    admitted: new Set(admission.admitted),
  }

  let rehearsal = rehearseCutScene(plan, staged, beats, inputs)
  let finalBeats = beats
  if (!rehearsal.ok) {
    // Strip is the only repair with no new information in it. If the scene
    // still fails after stripping, the content this harness authored is wrong,
    // and that is a defect to surface, not to ship.
    const stripped = stripUnready(beats, rehearsal)
    finalBeats = stripped.beats
    rehearsal = rehearseCutScene(plan, staged, finalBeats, inputs)
  }
  if (!rehearsal.ok) {
    fail(`The starter cut-scene failed rehearsal — a harness defect: ${rehearsal.failures
      .map((failure) => `${failure.code} at ${failure.at}`)
      .join('; ')}`)
  }

  return assembleCutScene(plan, staged, finalBeats, rehearsal)
}

/**
 * Every content file a 3D scaffold receives. A plan without a content section
 * — every 2D plan — receives none of them and is byte-for-byte what it always
 * was. The cut-scene and its player are written only when the plan selected
 * the cut-scene packet, because a file nobody planned is clutter, not a gift.
 */
export function contentProjectFiles(
  project: ProjectIdentity,
  plan: ImplementationPlan,
): readonly WorkspaceFile[] {
  const content = plan.content
  if (content === undefined) return Object.freeze([])

  const selected = new Set(plan.capabilities.map((capability) => capability.id))
  const withAudio = selected.has('content-3d-audio')
  const withCutscene = selected.has('content-3d-cutscenes')

  const manifest = starterManifest(content, withAudio)
  const files: WorkspaceFile[] = [
    { path: CONTENT_MANIFEST_PATH, contents: json(manifest) },
    {
      path: CONTENT_PIPELINES_PATH,
      contents: json({ workflows: CONTENT_WORKFLOWS, generators: content.generators }),
    },
    { path: CONTENT_CHECK_PATH, contents: checkScript() },
  ]

  if (withCutscene) {
    const document = starterCutScene(project, content, manifest, withAudio)
    files.push({ path: `${CUTSCENE_DIRECTORY}/${document.id}.json`, contents: json(document) })
    files.push({ path: CUTSCENE_PLAYER_PATH, contents: playerModule() })
  }

  return Object.freeze(files)
}

/**
 * The project's own admission gate: plain Node, no dependencies, no harness.
 * It re-checks what the harness checked at scaffold time, so content added
 * later — a generated mesh, an imported take — is held to the same bar by a
 * script the developer can read in one sitting.
 */
function checkScript(): string {
  return `#!/usr/bin/env node
/**
 * Content admission check. Run: node kei-mmo/content/check.mjs
 *
 * Validates kei-mmo/content/manifest.json and every assembled cut-scene:
 * data records parse at their versions, file records point at real, licensed,
 * nonempty files, and no cut-scene references a clip, cue, or prop that is not
 * admitted. Exits 1 with one line per problem; exits 0 quietly when clean.
 *
 * This file is yours. It has no dependencies and does not import the harness
 * that wrote it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const problems = []

const FILE_KINDS = { 'model-file': ['.glb', '.gltf'], 'motion-file': ['.glb', '.gltf', '.json'], 'audio-file': ['.wav', '.ogg', '.mp3'] }
const DATA_VERSION_FIELD = { 'prop-spec': 'propVersion', rig: 'rigVersion', 'motion-clip': 'clipVersion', 'audio-cue': 'cueVersion' }

function record(problem) {
  problems.push(problem)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))
} catch (error) {
  record('manifest.json could not be read as JSON: ' + (error instanceof Error ? error.message : String(error)))
}

const admitted = { 'prop-spec': new Set(), rig: new Set(), 'motion-clip': new Set(), 'audio-cue': new Set(), files: new Set() }

if (manifest !== undefined) {
  if (manifest.manifestVersion !== 1) {
    record('manifest.json is not manifestVersion 1, which is the only version this check speaks')
  } else {
    const seen = new Set()
    for (const asset of manifest.assets ?? []) {
      const id = String(asset.id ?? '')
      if (id === '') { record('an asset has no id'); continue }
      if (seen.has(id)) { record(id + ': duplicate id'); continue }
      seen.add(id)
      const kind = String(asset.kind ?? '')
      if (kind in FILE_KINDS) {
        if (typeof asset.path !== 'string' || asset.path === '') { record(id + ': file asset with no path'); continue }
        if (!FILE_KINDS[kind].some((ext) => asset.path.toLowerCase().endsWith(ext))) {
          record(id + ': ' + asset.path + ' is not a ' + kind + ' format'); continue
        }
        if (typeof asset.licence !== 'string' || asset.licence.trim() === '') {
          record(id + ': no licence — an unlicensed file is a release blocker'); continue
        }
        let stat = null
        try { stat = statSync(join(here, '..', '..', asset.path)) } catch {}
        if (stat === null) {
          const generated = asset.source && asset.source.kind === 'generated'
          record(generated
            ? id + ': generator_output_missing — ' + asset.source.generator + ' is declared to have produced ' + asset.path + ', and nothing is there'
            : id + ': file_missing — nothing is at ' + asset.path)
          continue
        }
        if (stat.size <= 0) { record(id + ': ' + asset.path + ' exists but is empty'); continue }
        admitted.files.add(id)
      } else if (kind in DATA_VERSION_FIELD) {
        const versionField = DATA_VERSION_FIELD[kind]
        if (asset.data === undefined || asset.data === null || asset.data[versionField] !== 1) {
          record(id + ': embedded ' + kind + ' is missing or not ' + versionField + ' 1'); continue
        }
        admitted[kind].add(id)
      } else {
        record(id + ': unknown kind "' + kind + '"')
      }
    }
  }
}

let cutsceneFiles = []
try { cutsceneFiles = readdirSync(join(here, 'cutscenes')).filter((name) => name.endsWith('.json')) } catch {}
for (const name of cutsceneFiles) {
  let doc
  try { doc = JSON.parse(readFileSync(join(here, 'cutscenes', name), 'utf8')) } catch { record(name + ': not valid JSON'); continue }
  if (doc.cutsceneVersion !== 1) { record(name + ': not cutsceneVersion 1'); continue }
  for (const beat of doc.beats ?? []) {
    for (const action of beat.actions ?? []) {
      if (!admitted['motion-clip'].has(action.clipId)) {
        record(name + ': ' + beat.id + ' references clip "' + action.clipId + '", which is not an admitted motion clip — a scene must never reference a missing clip')
      }
    }
    for (const cue of beat.cues ?? []) {
      if (!admitted['audio-cue'].has(cue.cueId)) {
        record(name + ': ' + beat.id + ' places cue "' + cue.cueId + '", which is not an admitted audio cue')
      }
    }
  }
  for (const propId of (doc.assets && doc.assets.props) ?? []) {
    if (!admitted['prop-spec'].has(propId) && !admitted.files.has(propId)) {
      record(name + ': stages prop "' + propId + '", which is not admitted')
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(problem + '\\n')
  process.stderr.write(problems.length + ' content problem' + (problems.length === 1 ? '' : 's') + '. Nothing above may be referenced by a scene until it admits.\\n')
  process.exit(1)
}
process.stdout.write('Content admitted: manifest and ' + cutsceneFiles.length + ' cut-scene' + (cutsceneFiles.length === 1 ? '' : 's') + ' are clean.\\n')
`
}

/**
 * The player the project owns. Pure functions over the assembled document —
 * no renderer, no audio context, no imports — so it drives three.js, a test,
 * or a headless tick equally well, and survives the harness's deletion.
 */
function playerModule(): string {
  return `/**
 * Cut-scene playback, as pure functions over an assembled document from
 * kei-mmo/content/cutscenes/. No imports, no globals, no clock of its own:
 * feed it a time, get back what should be on screen and what just became due.
 *
 * This file is yours. It does not depend on the harness that wrote it.
 */

export type Vec3 = readonly [number, number, number]

export interface CutScenePlacement {
  readonly id: string
  readonly kind: 'actor' | 'prop' | 'camera'
  readonly ref: string
  readonly position: Vec3
  readonly facingDeg?: number
  readonly lookAt?: Vec3
  readonly fovDeg?: number
}

export interface CutSceneAction {
  readonly actorId: string
  readonly clipId: string
  readonly loop: boolean
}

export interface CutSceneCue {
  readonly cueId: string
  readonly atMs: number
  readonly gain: number
  readonly spatial?: { readonly anchorId: string; readonly radiusM: number }
}

export interface CutSceneBeat {
  readonly id: string
  readonly title: string
  readonly line: string
  readonly startMs: number
  readonly durationMs: number
  readonly camera: {
    readonly placementId: string
    readonly move: { readonly kind: string; readonly params: { readonly distanceM?: number; readonly degrees?: number } }
  }
  readonly actions: readonly CutSceneAction[]
  readonly cues: readonly CutSceneCue[]
}

export interface CutSceneDocument {
  readonly cutsceneVersion: 1
  readonly id: string
  readonly title: string
  readonly stage: readonly CutScenePlacement[]
  readonly beats: readonly CutSceneBeat[]
  readonly durationMs: number
}

export interface CameraPose {
  readonly position: Vec3
  readonly lookAt: Vec3
  readonly fovDeg: number
}

export interface CutSceneFrame {
  readonly done: boolean
  readonly beatIndex: number
  readonly beatId: string
  readonly line: string
  readonly camera: CameraPose
  readonly actions: readonly CutSceneAction[]
  /** Cues whose start crossed between the previous time and this one. */
  readonly dueCues: readonly CutSceneCue[]
}

export function cutSceneDuration(doc: CutSceneDocument): number {
  return doc.durationMs
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) * (-2 * t + 2) / 2
}

/**
 * Interprets the camera move grammar by reference. An unknown kind holds the
 * staged pose — degraded and visible, never a throw — so a document from a
 * newer grammar still plays.
 */
export function cameraPoseAt(doc: CutSceneDocument, beat: CutSceneBeat, timeMs: number): CameraPose {
  const placement = doc.stage.find((entry) => entry.id === beat.camera.placementId)
  const basePosition: Vec3 = placement?.position ?? [0, 2, 8]
  const lookAt: Vec3 = placement?.lookAt ?? [0, 1, 0]
  const fovDeg = placement?.fovDeg ?? 50
  const progress = beat.durationMs <= 0 ? 1 : Math.min(1, Math.max(0, (timeMs - beat.startMs) / beat.durationMs))
  const eased = easeInOut(progress)
  const move = beat.camera.move

  if (move.kind === 'push-in' || move.kind === 'pull-back') {
    const distance = (move.params.distanceM ?? 2) * (move.kind === 'push-in' ? 1 : -1)
    const dx = lookAt[0] - basePosition[0]
    const dy = lookAt[1] - basePosition[1]
    const dz = lookAt[2] - basePosition[2]
    const length = Math.hypot(dx, dy, dz) || 1
    const travelled = distance * eased
    return {
      position: [
        basePosition[0] + (dx / length) * travelled,
        basePosition[1] + (dy / length) * travelled,
        basePosition[2] + (dz / length) * travelled,
      ],
      lookAt,
      fovDeg,
    }
  }

  if (move.kind === 'orbit-quarter') {
    const degrees = move.params.degrees ?? 90
    const angle = (degrees * Math.PI / 180) * eased
    const dx = basePosition[0] - lookAt[0]
    const dz = basePosition[2] - lookAt[2]
    const sin = Math.sin(angle)
    const cos = Math.cos(angle)
    return {
      position: [
        lookAt[0] + dx * cos - dz * sin,
        basePosition[1],
        lookAt[2] + dx * sin + dz * cos,
      ],
      lookAt,
      fovDeg,
    }
  }

  // 'static', and every kind this build does not know: hold the staged pose.
  return { position: basePosition, lookAt, fovDeg }
}

/**
 * The whole player. Pass the previous frame's time to collect the cues that
 * became due since; pass -1 (the default) at the start so cues at 0 fire.
 */
export function advanceCutScene(
  doc: CutSceneDocument,
  timeMs: number,
  previousTimeMs: number = -1,
): CutSceneFrame {
  const last = doc.beats[doc.beats.length - 1]
  if (last === undefined) {
    return {
      done: true,
      beatIndex: -1,
      beatId: '',
      line: '',
      camera: { position: [0, 2, 8], lookAt: [0, 1, 0], fovDeg: 50 },
      actions: [],
      dueCues: [],
    }
  }

  const clamped = Math.max(0, Math.min(timeMs, doc.durationMs))
  let beatIndex = doc.beats.length - 1
  for (let index = 0; index < doc.beats.length; index += 1) {
    const beat = doc.beats[index]!
    if (clamped < beat.startMs + beat.durationMs) {
      beatIndex = index
      break
    }
  }
  const beat = doc.beats[beatIndex]!

  const dueCues: CutSceneCue[] = []
  for (const candidate of doc.beats) {
    for (const cue of candidate.cues) {
      const absolute = candidate.startMs + cue.atMs
      if (absolute > previousTimeMs && absolute <= timeMs) dueCues.push(cue)
    }
  }

  return {
    done: timeMs >= doc.durationMs,
    beatIndex,
    beatId: beat.id,
    line: beat.line,
    camera: cameraPoseAt(doc, beat, clamped),
    actions: beat.actions,
    dueCues,
  }
}
`
}
