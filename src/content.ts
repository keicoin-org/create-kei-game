/**
 * The 3D content records: what an asset *is*, and the gate that decides
 * whether a plan may lean on it.
 *
 * Everything here is a versioned document with a defensive parser — a record
 * that is not exactly the shape and version this build speaks drops out, it
 * never half-loads and never throws. Assets come in two families. *Data*
 * assets (a prop spec, a rig, a motion clip, an audio cue) are embedded JSON,
 * validated in place. *File* assets (a generated GLB, an imported take, a
 * rendered WAV) are references to bytes on disk, and admission checks the
 * bytes are actually there — which is the whole point: a manifest may declare
 * that a generator produced something, and **a declared output that does not
 * exist blocks admission** instead of becoming a broken reference in a scene.
 */

import {
  MOTION_CLIP_VERSION,
  parseMotionClipDoc,
  rigById,
  validateClipAgainstRig,
  RIG_VERSION,
  type MotionClipDoc,
  type RigDefinition,
} from './motion.js'
import type { StyleSetting } from './style.js'

export const CONTENT_MANIFEST_VERSION = 1 as const
export const CONTENT_WORKFLOW_VERSION = 1 as const
export const PROP_SPEC_VERSION = 1 as const
export const AUDIO_CUE_VERSION = 1 as const

/** More parts than this is a model, and models are files, not specs. */
export const MAX_PROP_PARTS = 24
export const MAX_MANIFEST_ASSETS = 400

// ── Prop specs: models as data ───────────────────────────────────────────────

export type PropShape = 'box' | 'cylinder' | 'cone' | 'sphere'
export type PropRole = 'structure' | 'accent' | 'emissive'

export interface PropPart {
  readonly shape: PropShape
  /** Metres, `[x, y, z]`. For cylinder and cone, x is diameter and y height. */
  readonly size: readonly [number, number, number]
  /** Metres from the prop origin, y up from the floor. */
  readonly offset: readonly [number, number, number]
  readonly role: PropRole
}

export interface PropSpec {
  readonly propVersion: typeof PROP_SPEC_VERSION
  readonly id: string
  readonly title: string
  readonly parts: readonly PropPart[]
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

const PROP_SHAPES: ReadonlySet<string> = new Set(['box', 'cylinder', 'cone', 'sphere'])
const PROP_ROLES: ReadonlySet<string> = new Set(['structure', 'accent', 'emissive'])

export function parsePropSpec(value: unknown): PropSpec | null {
  if (!isRecord(value)) return null
  if (value.propVersion !== PROP_SPEC_VERSION) return null
  if (typeof value.id !== 'string' || value.id === '') return null
  if (typeof value.title !== 'string' || value.title === '') return null
  if (!Array.isArray(value.parts) || value.parts.length === 0 || value.parts.length > MAX_PROP_PARTS) {
    return null
  }
  const parts: PropPart[] = []
  for (const raw of value.parts) {
    if (!isRecord(raw)) return null
    if (typeof raw.shape !== 'string' || !PROP_SHAPES.has(raw.shape)) return null
    if (typeof raw.role !== 'string' || !PROP_ROLES.has(raw.role)) return null
    if (!isVec3(raw.size) || !isVec3(raw.offset)) return null
    if (raw.size.some((part) => part <= 0)) return null
    parts.push(
      Object.freeze({
        shape: raw.shape as PropShape,
        size: Object.freeze([...raw.size]) as unknown as readonly [number, number, number],
        offset: Object.freeze([...raw.offset]) as unknown as readonly [number, number, number],
        role: raw.role as PropRole,
      }),
    )
  }
  return Object.freeze({
    propVersion: PROP_SPEC_VERSION,
    id: value.id,
    title: value.title,
    parts: Object.freeze(parts),
  })
}

function prop(id: string, title: string, parts: readonly PropPart[]): PropSpec {
  const parsed = parsePropSpec({ propVersion: PROP_SPEC_VERSION, id, title, parts })
  if (parsed === null) throw new Error(`authored prop "${id}" does not parse`)
  return parsed
}

function part(
  shape: PropShape,
  size: readonly [number, number, number],
  offset: readonly [number, number, number],
  role: PropRole = 'structure',
): PropPart {
  return Object.freeze({
    shape,
    size: Object.freeze([...size]) as unknown as readonly [number, number, number],
    offset: Object.freeze([...offset]) as unknown as readonly [number, number, number],
    role,
  })
}

export interface PropKit {
  readonly id: string
  readonly setting: StyleSetting
  readonly title: string
  readonly props: readonly PropSpec[]
}

/**
 * One kit per setting, kitbashed from primitives the renderer already has.
 * These are set dressing at previs fidelity: enough silhouette that a staged
 * scene reads as *somewhere*, cheap enough that nobody mistakes them for final
 * art. The neutral kit is what an unspecified setting gets — geometry with no
 * genre in it, because assuming one was ruled out upstream.
 */
export const PROP_KITS: readonly PropKit[] = Object.freeze([
  {
    id: 'kit-neutral',
    setting: 'unspecified',
    title: 'Neutral previs blocks',
    props: Object.freeze([
      prop('marker-block', 'Marker block', [part('box', [0.6, 0.6, 0.6], [0, 0.3, 0])]),
      prop('platform', 'Low platform', [part('box', [2.4, 0.2, 2.4], [0, 0.1, 0])]),
      prop('pillar', 'Pillar', [
        part('cylinder', [0.5, 2.4, 0.5], [0, 1.2, 0]),
        part('box', [0.7, 0.15, 0.7], [0, 2.48, 0], 'accent'),
      ]),
      prop('waypost', 'Waypost', [
        part('cylinder', [0.12, 1.6, 0.12], [0, 0.8, 0]),
        part('sphere', [0.24, 0.24, 0.24], [0, 1.7, 0], 'emissive'),
      ]),
    ]),
  },
  {
    id: 'kit-science-fiction',
    setting: 'science-fiction',
    title: 'Station salvage set',
    props: Object.freeze([
      prop('cargo-crate', 'Cargo crate', [
        part('box', [1, 0.8, 1], [0, 0.4, 0]),
        part('box', [1.04, 0.08, 0.2], [0, 0.7, 0], 'accent'),
      ]),
      prop('console-bank', 'Console bank', [
        part('box', [1.6, 0.9, 0.5], [0, 0.45, 0]),
        part('box', [1.4, 0.5, 0.06], [0, 1.15, -0.1], 'emissive'),
      ]),
      prop('fuel-drum', 'Fuel drum', [
        part('cylinder', [0.6, 0.9, 0.6], [0, 0.45, 0]),
        part('cylinder', [0.62, 0.06, 0.62], [0, 0.9, 0], 'accent'),
      ]),
      prop('antenna-mast', 'Antenna mast', [
        part('cylinder', [0.14, 2.6, 0.14], [0, 1.3, 0]),
        part('cone', [0.4, 0.5, 0.4], [0, 2.85, 0], 'accent'),
        part('sphere', [0.16, 0.16, 0.16], [0, 3.15, 0], 'emissive'),
      ]),
    ]),
  },
  {
    id: 'kit-contemporary',
    setting: 'contemporary',
    title: 'Street furniture set',
    props: Object.freeze([
      prop('bench', 'Bench', [
        part('box', [1.6, 0.08, 0.5], [0, 0.45, 0]),
        part('box', [0.08, 0.45, 0.5], [-0.7, 0.225, 0]),
        part('box', [0.08, 0.45, 0.5], [0.7, 0.225, 0]),
      ]),
      prop('streetlamp', 'Streetlamp', [
        part('cylinder', [0.12, 3, 0.12], [0, 1.5, 0]),
        part('box', [0.7, 0.1, 0.2], [0.3, 3, 0], 'accent'),
        part('sphere', [0.2, 0.2, 0.2], [0.62, 2.94, 0], 'emissive'),
      ]),
      prop('planter', 'Planter', [
        part('box', [0.9, 0.5, 0.9], [0, 0.25, 0]),
        part('sphere', [0.8, 0.6, 0.8], [0, 0.75, 0], 'accent'),
      ]),
      prop('kiosk', 'Kiosk', [
        part('box', [1.2, 2.2, 1.2], [0, 1.1, 0]),
        part('box', [1.4, 0.1, 1.4], [0, 2.25, 0], 'accent'),
        part('box', [0.9, 0.5, 0.04], [0, 1.5, 0.61], 'emissive'),
      ]),
    ]),
  },
  {
    id: 'kit-historical',
    setting: 'historical',
    title: 'Old-world market set',
    props: Object.freeze([
      prop('barrel', 'Barrel', [
        part('cylinder', [0.7, 0.9, 0.7], [0, 0.45, 0]),
        part('cylinder', [0.74, 0.05, 0.74], [0, 0.25, 0], 'accent'),
        part('cylinder', [0.74, 0.05, 0.74], [0, 0.65, 0], 'accent'),
      ]),
      prop('handcart', 'Handcart', [
        part('box', [1.4, 0.15, 0.9], [0, 0.55, 0]),
        part('cylinder', [0.6, 0.08, 0.6], [-0.5, 0.3, 0.5]),
        part('cylinder', [0.6, 0.08, 0.6], [-0.5, 0.3, -0.5]),
        part('box', [0.08, 0.08, 1], [0.8, 0.62, 0]),
      ]),
      prop('brazier', 'Brazier', [
        part('cylinder', [0.5, 0.8, 0.5], [0, 0.4, 0]),
        part('sphere', [0.44, 0.3, 0.44], [0, 0.9, 0], 'emissive'),
      ]),
      prop('market-stall', 'Market stall', [
        part('box', [1.8, 0.1, 0.9], [0, 0.85, 0]),
        part('box', [0.1, 0.85, 0.1], [-0.8, 0.425, 0.35]),
        part('box', [0.1, 0.85, 0.1], [0.8, 0.425, 0.35]),
        part('box', [2, 0.06, 1.1], [0, 1.95, 0], 'accent'),
      ]),
    ]),
  },
  {
    id: 'kit-fantasy',
    setting: 'fantasy',
    title: 'Wayside shrine set',
    props: Object.freeze([
      prop('standing-stone', 'Standing stone', [
        part('box', [0.7, 2.2, 0.5], [0, 1.1, 0]),
        part('box', [0.5, 0.3, 0.4], [0, 2.3, 0], 'accent'),
      ]),
      prop('shrine-basin', 'Shrine basin', [
        part('cylinder', [0.9, 0.5, 0.9], [0, 0.25, 0]),
        part('sphere', [0.5, 0.2, 0.5], [0, 0.55, 0], 'emissive'),
      ]),
      prop('banner-pole', 'Banner pole', [
        part('cylinder', [0.1, 2.8, 0.1], [0, 1.4, 0]),
        part('box', [0.05, 1.2, 0.7], [0, 2.1, 0.38], 'accent'),
      ]),
      prop('old-chest', 'Old chest', [
        part('box', [1, 0.6, 0.6], [0, 0.3, 0]),
        part('cylinder', [0.6, 1, 0.62], [0, 0.6, 0], 'accent'),
      ]),
    ]),
  },
] as const)

export function propKitFor(setting: StyleSetting): PropKit {
  return PROP_KITS.find((kit) => kit.setting === setting) ?? PROP_KITS[0]!
}

// ── Audio cues: placement intent plus a placeholder voice ────────────────────

export type AudioCueCategory = 'sfx' | 'music' | 'ambience'
export type SynthWave = 'sine' | 'square' | 'triangle' | 'sawtooth' | 'noise'

/**
 * A cue's placeholder voice: one oscillator or noise burst with an envelope,
 * playable by any Web Audio context the project owns. This is previs sound —
 * a real palette arrives as admitted audio files, or through a generator when
 * one exists, and the records say which of those actually happened.
 */
export interface SynthSpec {
  readonly wave: SynthWave
  readonly startHz: number
  readonly endHz: number
  readonly durationMs: number
  readonly attackMs: number
  readonly releaseMs: number
  /** 0..1, pre-master. */
  readonly gain: number
}

export interface AudioCueSpec {
  readonly cueVersion: typeof AUDIO_CUE_VERSION
  readonly id: string
  readonly title: string
  readonly category: AudioCueCategory
  /** In-world source or score. Placement rules differ, so it is declared. */
  readonly diegetic: boolean
  readonly synth: SynthSpec
}

const CUE_CATEGORIES: ReadonlySet<string> = new Set(['sfx', 'music', 'ambience'])
const SYNTH_WAVES: ReadonlySet<string> = new Set(['sine', 'square', 'triangle', 'sawtooth', 'noise'])

export function parseAudioCueSpec(value: unknown): AudioCueSpec | null {
  if (!isRecord(value)) return null
  if (value.cueVersion !== AUDIO_CUE_VERSION) return null
  if (typeof value.id !== 'string' || value.id === '') return null
  if (typeof value.title !== 'string' || value.title === '') return null
  if (typeof value.category !== 'string' || !CUE_CATEGORIES.has(value.category)) return null
  if (typeof value.diegetic !== 'boolean') return null
  const synth = value.synth
  if (!isRecord(synth)) return null
  if (typeof synth.wave !== 'string' || !SYNTH_WAVES.has(synth.wave)) return null
  for (const field of ['startHz', 'endHz', 'durationMs', 'attackMs', 'releaseMs', 'gain'] as const) {
    const number = synth[field]
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) return null
  }
  if ((synth.durationMs as number) <= 0 || (synth.durationMs as number) > 30_000) return null
  if ((synth.gain as number) > 1) return null
  return Object.freeze({
    cueVersion: AUDIO_CUE_VERSION,
    id: value.id,
    title: value.title,
    category: value.category as AudioCueCategory,
    diegetic: value.diegetic,
    synth: Object.freeze({
      wave: synth.wave as SynthWave,
      startHz: synth.startHz as number,
      endHz: synth.endHz as number,
      durationMs: synth.durationMs as number,
      attackMs: synth.attackMs as number,
      releaseMs: synth.releaseMs as number,
      gain: synth.gain as number,
    }),
  })
}

function cue(
  id: string,
  title: string,
  category: AudioCueCategory,
  diegetic: boolean,
  synth: SynthSpec,
): AudioCueSpec {
  const parsed = parseAudioCueSpec({ cueVersion: AUDIO_CUE_VERSION, id, title, category, diegetic, synth })
  if (parsed === null) throw new Error(`authored cue "${id}" does not parse`)
  return parsed
}

export interface AudioPalette {
  readonly id: string
  readonly setting: StyleSetting
  readonly title: string
  readonly cues: readonly AudioCueSpec[]
}

export const AUDIO_PALETTES: readonly AudioPalette[] = Object.freeze([
  {
    id: 'palette-neutral',
    setting: 'unspecified',
    title: 'Neutral previs palette',
    cues: Object.freeze([
      cue('cue-marker', 'Marker blip', 'sfx', false, { wave: 'sine', startHz: 660, endHz: 660, durationMs: 180, attackMs: 5, releaseMs: 120, gain: 0.4 }),
      cue('cue-swell', 'Soft swell', 'music', false, { wave: 'triangle', startHz: 220, endHz: 330, durationMs: 2400, attackMs: 600, releaseMs: 900, gain: 0.3 }),
      cue('cue-room', 'Room tone', 'ambience', true, { wave: 'noise', startHz: 0, endHz: 0, durationMs: 4000, attackMs: 400, releaseMs: 800, gain: 0.12 }),
    ]),
  },
  {
    id: 'palette-science-fiction',
    setting: 'science-fiction',
    title: 'Station hum palette',
    cues: Object.freeze([
      cue('cue-airlock', 'Airlock release', 'sfx', true, { wave: 'square', startHz: 180, endHz: 60, durationMs: 700, attackMs: 10, releaseMs: 350, gain: 0.45 }),
      cue('cue-scanner', 'Scanner sweep', 'sfx', true, { wave: 'sawtooth', startHz: 700, endHz: 1400, durationMs: 500, attackMs: 20, releaseMs: 200, gain: 0.35 }),
      cue('cue-drone', 'Reactor drone', 'ambience', true, { wave: 'sawtooth', startHz: 55, endHz: 55, durationMs: 6000, attackMs: 800, releaseMs: 1200, gain: 0.15 }),
      cue('cue-arrival-sting', 'Arrival sting', 'music', false, { wave: 'triangle', startHz: 262, endHz: 392, durationMs: 1800, attackMs: 300, releaseMs: 700, gain: 0.35 }),
    ]),
  },
  {
    id: 'palette-contemporary',
    setting: 'contemporary',
    title: 'City ambience palette',
    cues: Object.freeze([
      cue('cue-door-chime', 'Door chime', 'sfx', true, { wave: 'sine', startHz: 880, endHz: 1175, durationMs: 400, attackMs: 5, releaseMs: 250, gain: 0.4 }),
      cue('cue-thud', 'Soft thud', 'sfx', true, { wave: 'noise', startHz: 0, endHz: 0, durationMs: 220, attackMs: 2, releaseMs: 150, gain: 0.5 }),
      cue('cue-street', 'Street wash', 'ambience', true, { wave: 'noise', startHz: 0, endHz: 0, durationMs: 6000, attackMs: 900, releaseMs: 1200, gain: 0.12 }),
      cue('cue-arrival-sting', 'Arrival sting', 'music', false, { wave: 'sine', startHz: 330, endHz: 440, durationMs: 1600, attackMs: 250, releaseMs: 650, gain: 0.32 }),
    ]),
  },
  {
    id: 'palette-historical',
    setting: 'historical',
    title: 'Old-world palette',
    cues: Object.freeze([
      cue('cue-bell', 'Hand bell', 'sfx', true, { wave: 'triangle', startHz: 1046, endHz: 1046, durationMs: 900, attackMs: 2, releaseMs: 700, gain: 0.4 }),
      cue('cue-creak', 'Timber creak', 'sfx', true, { wave: 'sawtooth', startHz: 90, endHz: 70, durationMs: 500, attackMs: 30, releaseMs: 300, gain: 0.3 }),
      cue('cue-wind', 'Wind over stone', 'ambience', true, { wave: 'noise', startHz: 0, endHz: 0, durationMs: 6000, attackMs: 1000, releaseMs: 1400, gain: 0.12 }),
      cue('cue-arrival-sting', 'Arrival sting', 'music', false, { wave: 'triangle', startHz: 196, endHz: 294, durationMs: 2000, attackMs: 350, releaseMs: 800, gain: 0.32 }),
    ]),
  },
  {
    id: 'palette-fantasy',
    setting: 'fantasy',
    title: 'Shrine chime palette',
    cues: Object.freeze([
      cue('cue-chime', 'Shrine chime', 'sfx', true, { wave: 'sine', startHz: 1318, endHz: 988, durationMs: 1200, attackMs: 5, releaseMs: 900, gain: 0.35 }),
      cue('cue-ember', 'Ember crackle', 'sfx', true, { wave: 'noise', startHz: 0, endHz: 0, durationMs: 350, attackMs: 5, releaseMs: 250, gain: 0.3 }),
      cue('cue-glade', 'Glade tone', 'ambience', true, { wave: 'triangle', startHz: 110, endHz: 110, durationMs: 6000, attackMs: 900, releaseMs: 1300, gain: 0.12 }),
      cue('cue-arrival-sting', 'Arrival sting', 'music', false, { wave: 'sine', startHz: 294, endHz: 440, durationMs: 2000, attackMs: 300, releaseMs: 800, gain: 0.32 }),
    ]),
  },
] as const)

export function audioPaletteFor(setting: StyleSetting): AudioPalette {
  return AUDIO_PALETTES.find((palette) => palette.setting === setting) ?? AUDIO_PALETTES[0]!
}

// ── The manifest and the admission gate ──────────────────────────────────────

export const ASSET_KINDS = [
  'prop-spec',
  'rig',
  'motion-clip',
  'audio-cue',
  'model-file',
  'motion-file',
  'audio-file',
] as const

export type AssetKind = (typeof ASSET_KINDS)[number]

export type AssetSource =
  | { readonly kind: 'authored' }
  | { readonly kind: 'generated'; readonly generator: string }
  | { readonly kind: 'imported'; readonly origin: string }

export interface AssetRecord {
  readonly id: string
  readonly kind: AssetKind
  readonly title: string
  readonly source: AssetSource
  /** Which setting this asset belongs to, when it belongs to one. */
  readonly style?: StyleSetting
  /** Required on file assets. A file without a licence is not shippable. */
  readonly licence?: string
  /** Workspace-relative POSIX path. File assets only. */
  readonly path?: string
  /** The embedded document. Data assets only. */
  readonly data?: unknown
}

export interface ContentManifest {
  readonly manifestVersion: typeof CONTENT_MANIFEST_VERSION
  readonly assets: readonly AssetRecord[]
}

const FILE_KINDS: ReadonlySet<AssetKind> = new Set(['model-file', 'motion-file', 'audio-file'])

const FILE_EXTENSIONS: Readonly<Record<'model-file' | 'motion-file' | 'audio-file', readonly string[]>> =
  Object.freeze({
    'model-file': Object.freeze(['.glb', '.gltf']),
    'motion-file': Object.freeze(['.glb', '.gltf', '.json']),
    'audio-file': Object.freeze(['.wav', '.ogg', '.mp3']),
  })

export type AdmissionCode =
  | 'invalid_record'
  | 'duplicate_id'
  | 'missing_path'
  | 'unexpected_path'
  | 'unsafe_path'
  | 'missing_licence'
  | 'file_missing'
  | 'generator_output_missing'
  | 'empty_file'
  | 'wrong_extension'
  | 'invalid_data'
  | 'unknown_rig'

export interface AssetVerdict {
  readonly id: string
  readonly kind: AssetKind | 'unknown'
  readonly admitted: boolean
  readonly code?: AdmissionCode
  readonly reason: string
}

export interface AdmissionReport {
  readonly ok: boolean
  /** Ids the rest of the pipeline may reference. Nothing else exists to it. */
  readonly admitted: readonly string[]
  readonly blocked: readonly AssetVerdict[]
  readonly verdicts: readonly AssetVerdict[]
}

/**
 * How the gate looks at the disk. Synchronous and injected: the check script
 * a project owns uses `statSync`, and the tests use a plain map. `null` means
 * nothing is at that path.
 */
export type AdmissionProbe = (path: string) => { readonly size: number } | null

export function parseContentManifest(value: unknown): ContentManifest | null {
  if (!isRecord(value)) return null
  if (value.manifestVersion !== CONTENT_MANIFEST_VERSION) return null
  if (!Array.isArray(value.assets) || value.assets.length > MAX_MANIFEST_ASSETS) return null
  const assets: AssetRecord[] = []
  for (const raw of value.assets) {
    const record = parseAssetRecord(raw)
    if (record === null) return null
    assets.push(record)
  }
  return Object.freeze({ manifestVersion: CONTENT_MANIFEST_VERSION, assets: Object.freeze(assets) })
}

function parseAssetRecord(value: unknown): AssetRecord | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id === '') return null
  if (typeof value.kind !== 'string' || !ASSET_KINDS.includes(value.kind as AssetKind)) return null
  if (typeof value.title !== 'string' || value.title === '') return null
  const source = parseSource(value.source)
  if (source === null) return null
  if (value.style !== undefined && typeof value.style !== 'string') return null
  if (value.licence !== undefined && typeof value.licence !== 'string') return null
  if (value.path !== undefined && typeof value.path !== 'string') return null
  return Object.freeze({
    id: value.id,
    kind: value.kind as AssetKind,
    title: value.title,
    source,
    ...(value.style === undefined ? {} : { style: value.style as StyleSetting }),
    ...(value.licence === undefined ? {} : { licence: value.licence }),
    ...(value.path === undefined ? {} : { path: value.path }),
    ...(value.data === undefined ? {} : { data: value.data }),
  })
}

function parseSource(value: unknown): AssetSource | null {
  if (!isRecord(value)) return null
  if (value.kind === 'authored') return Object.freeze({ kind: 'authored' })
  if (value.kind === 'generated') {
    return typeof value.generator === 'string' && value.generator !== ''
      ? Object.freeze({ kind: 'generated', generator: value.generator })
      : null
  }
  if (value.kind === 'imported') {
    return typeof value.origin === 'string' && value.origin !== ''
      ? Object.freeze({ kind: 'imported', origin: value.origin })
      : null
  }
  return null
}

/** Relative, forward-slashed, no `..`, no drive letter — or nothing. */
function safeRelativePath(path: string): boolean {
  if (path === '' || path.includes('\0') || path.includes('\\')) return false
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false
  const segments = path.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function blockedVerdict(record: AssetRecord, code: AdmissionCode, reason: string): AssetVerdict {
  return Object.freeze({ id: record.id, kind: record.kind, admitted: false, code, reason })
}

function admittedVerdict(record: AssetRecord): AssetVerdict {
  return Object.freeze({ id: record.id, kind: record.kind, admitted: true, reason: 'admitted' })
}

function admitDataAsset(record: AssetRecord): AssetVerdict {
  if (record.path !== undefined) {
    return blockedVerdict(record, 'unexpected_path', `"${record.id}" embeds its document, so it cannot also point at a file`)
  }
  switch (record.kind) {
    case 'prop-spec':
      return parsePropSpec(record.data) === null
        ? blockedVerdict(record, 'invalid_data', `"${record.id}" does not parse as a version-${PROP_SPEC_VERSION} prop spec`)
        : admittedVerdict(record)
    case 'audio-cue':
      return parseAudioCueSpec(record.data) === null
        ? blockedVerdict(record, 'invalid_data', `"${record.id}" does not parse as a version-${AUDIO_CUE_VERSION} audio cue`)
        : admittedVerdict(record)
    case 'rig': {
      const rig = record.data as RigDefinition | undefined
      if (!isRecord(rig) || rig.rigVersion !== RIG_VERSION || rigById(String(rig.id)) === undefined) {
        return blockedVerdict(record, 'unknown_rig', `"${record.id}" does not name a rig this build defines`)
      }
      return admittedVerdict(record)
    }
    case 'motion-clip': {
      const clip = parseMotionClipDoc(record.data)
      if (clip === null) {
        return blockedVerdict(record, 'invalid_data', `"${record.id}" does not parse as a version-${MOTION_CLIP_VERSION} motion clip`)
      }
      const rig = rigById(clip.rig)
      if (rig === undefined) {
        return blockedVerdict(record, 'unknown_rig', `clip "${record.id}" targets rig "${clip.rig}", which this build does not define`)
      }
      const problems = validateClipAgainstRig(clip, rig)
      if (problems.length > 0) {
        return blockedVerdict(record, 'invalid_data', problems.join('; '))
      }
      return admittedVerdict(record)
    }
    default:
      return blockedVerdict(record, 'invalid_record', `"${record.id}" has a kind admission does not know`)
  }
}

function admitFileAsset(record: AssetRecord, probe: AdmissionProbe | undefined): AssetVerdict {
  if (record.data !== undefined) {
    return blockedVerdict(record, 'invalid_record', `"${record.id}" is a file asset and cannot embed a document`)
  }
  if (record.path === undefined) {
    return blockedVerdict(record, 'missing_path', `"${record.id}" declares bytes on disk but no path to them`)
  }
  if (!safeRelativePath(record.path)) {
    return blockedVerdict(record, 'unsafe_path', `"${record.path}" is not a safe workspace-relative path`)
  }
  const extensions = FILE_EXTENSIONS[record.kind as 'model-file' | 'motion-file' | 'audio-file']
  if (!extensions.some((extension) => record.path!.toLowerCase().endsWith(extension))) {
    return blockedVerdict(
      record,
      'wrong_extension',
      `"${record.path}" is not a ${record.kind} format (expected ${extensions.join(', ')})`,
    )
  }
  if (record.licence === undefined || record.licence.trim() === '') {
    return blockedVerdict(record, 'missing_licence', `"${record.id}" has no licence, and an unlicensed file is a release blocker, not a warning`)
  }
  const stat = probe?.(record.path) ?? null
  if (stat === null) {
    return record.source.kind === 'generated'
      ? blockedVerdict(
          record,
          'generator_output_missing',
          `"${record.id}" claims ${record.source.generator} produced ${record.path}, but nothing is there — the generator has not run, or its output was not saved`,
        )
      : blockedVerdict(record, 'file_missing', `"${record.id}" points at ${record.path}, and nothing is there`)
  }
  if (stat.size <= 0) {
    return blockedVerdict(record, 'empty_file', `"${record.path}" exists but is empty`)
  }
  return admittedVerdict(record)
}

/**
 * The gate. Every record gets a verdict; a manifest passes only when every
 * record does. The report lists every failure at once — a pipeline that
 * reveals its blockers one run at a time is a pipeline nobody finishes.
 */
export function admitAssets(manifest: ContentManifest, probe?: AdmissionProbe): AdmissionReport {
  const verdicts: AssetVerdict[] = []
  const seen = new Set<string>()

  for (const record of manifest.assets) {
    if (seen.has(record.id)) {
      verdicts.push(blockedVerdict(record, 'duplicate_id', `"${record.id}" appears more than once`))
      continue
    }
    seen.add(record.id)
    verdicts.push(FILE_KINDS.has(record.kind) ? admitFileAsset(record, probe) : admitDataAsset(record))
  }

  const admitted = verdicts.filter((verdict) => verdict.admitted).map((verdict) => verdict.id)
  const blocked = verdicts.filter((verdict) => !verdict.admitted)
  return Object.freeze({
    ok: blocked.length === 0,
    admitted: Object.freeze(admitted),
    blocked: Object.freeze(blocked),
    verdicts: Object.freeze(verdicts),
  })
}

// ── Workflow records ─────────────────────────────────────────────────────────

export interface WorkflowStage {
  readonly id: string
  readonly title: string
  /** The capability packet whose methods do this stage's work. */
  readonly uses: string
  readonly produces: string
  /** What must hold before the next stage may run. */
  readonly gate: string
}

export interface ContentWorkflow {
  readonly workflowVersion: typeof CONTENT_WORKFLOW_VERSION
  readonly id: string
  readonly title: string
  readonly stages: readonly WorkflowStage[]
}

function workflow(id: string, title: string, stages: readonly WorkflowStage[]): ContentWorkflow {
  return Object.freeze({
    workflowVersion: CONTENT_WORKFLOW_VERSION,
    id,
    title,
    stages: Object.freeze(stages.map((stage) => Object.freeze({ ...stage }))),
  })
}

/**
 * The four 3D pipelines, written down as records a person or a model can walk.
 * Stages that lean on a generator name the capability honestly; whether that
 * capability is available, planned, or absent is the capability record's fact,
 * and the plan repeats it rather than papering over it.
 */
export const CONTENT_WORKFLOWS: readonly ContentWorkflow[] = Object.freeze([
  workflow('workflow-model', 'Models and props', [
    {
      id: 'spec',
      title: 'Spec the prop from primitives',
      uses: 'content-3d-props',
      produces: 'a prop-spec asset in kei-mmo/content/manifest.json',
      gate: 'parsePropSpec accepts it and admission admits it',
    },
    {
      id: 'generate',
      title: 'Generate or import a real mesh',
      uses: 'content-3d-model-generation',
      produces: 'a model-file asset (.glb) with provenance and a licence',
      gate: 'the file exists on disk — a generated record with no bytes is blocked as generator_output_missing',
    },
    {
      id: 'admit',
      title: 'Admit into the manifest',
      uses: 'content-3d-props',
      produces: 'an admitted asset id scenes may reference',
      gate: 'admitAssets reports ok for the record',
    },
  ]),
  workflow('workflow-motion', 'Rigging and animation', [
    {
      id: 'rig',
      title: 'Pick the rig',
      uses: 'content-3d-motion',
      produces: 'a rig reference (previs-biped today)',
      gate: 'the rig id resolves in this build',
    },
    {
      id: 'author-or-generate',
      title: 'Author a clip, or ingest a generated one',
      uses: 'content-3d-motion-capture',
      produces: 'a motion-clip document, or a motion-file with provenance',
      gate: 'the clip parses at the current clip version and every track names a rig node',
    },
    {
      id: 'ready',
      title: 'Pass the ready gate',
      uses: 'content-3d-motion',
      produces: 'a ready clip record scenes may reference',
      gate: 'isClipReady holds — status ready, current version, payload present; anything else fails closed',
    },
  ]),
  workflow('workflow-audio', 'SFX and audio', [
    {
      id: 'cue',
      title: 'Declare the cue',
      uses: 'content-3d-audio',
      produces: 'an audio-cue record: category, diegetic or not, placeholder synth voice',
      gate: 'parseAudioCueSpec accepts it and admission admits it',
    },
    {
      id: 'produce',
      title: 'Replace the placeholder with produced audio',
      uses: 'content-3d-sfx-generation',
      produces: 'an audio-file asset (.wav/.ogg) with a licence',
      gate: 'the file exists and is nonempty, or the cue keeps its synth voice and says so',
    },
    {
      id: 'place',
      title: 'Place it',
      uses: 'content-3d-audio',
      produces: 'cue placements on cut-scene beats or world emitters',
      gate: 'every placement references an admitted cue; rehearsal blocks the rest',
    },
  ]),
  workflow('workflow-cutscene', 'Directed cut-scenes', [
    {
      id: 'plan',
      title: 'Plan the scene',
      uses: 'content-3d-cutscenes',
      produces: 'a cut-scene plan: cast, setting, purpose',
      gate: 'cast, props, and cues name admitted assets only',
    },
    {
      id: 'stage',
      title: 'Stage it',
      uses: 'content-3d-cutscenes',
      produces: 'deterministic placements for actors, props, and cameras',
      gate: 'every cast member and named prop is placed',
    },
    {
      id: 'beats',
      title: 'Write the beats',
      uses: 'content-3d-cutscenes',
      produces: 'timed beats: camera moves, actor actions, cue placements',
      gate: 'beat count and durations inside the published bounds',
    },
    {
      id: 'rehearse',
      title: 'Rehearse',
      uses: 'content-3d-cutscenes',
      produces: 'a rehearsal report listing every violation at once',
      gate: 'ok — or assembly refuses; a scene referencing a missing clip is never emitted',
    },
    {
      id: 'assemble',
      title: 'Assemble',
      uses: 'content-3d-cutscenes',
      produces: 'a deterministic cut-scene document the project plays without this harness',
      gate: 'byte-identical output for identical input',
    },
  ]),
] as const)
