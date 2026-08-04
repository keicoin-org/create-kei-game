/**
 * Content records and the admission gate. The headline test is the honest
 * failure: an asset that claims a generator produced it, with nothing on
 * disk, blocks admission — it never becomes a reference a scene could dangle.
 */

import { describe, expect, test } from 'bun:test'

import {
  admitAssets,
  AUDIO_PALETTES,
  audioPaletteFor,
  CONTENT_MANIFEST_VERSION,
  CONTENT_WORKFLOWS,
  parseAudioCueSpec,
  parseContentManifest,
  parsePropSpec,
  PROP_KITS,
  propKitFor,
  type AssetRecord,
  type ContentManifest,
} from '../src/content.js'
import { capabilityById } from '../src/capabilities.js'
import { assertSafeConfigFields } from '../src/harness.js'
import { MOTION_CLIPS, PREVIS_BIPED } from '../src/motion.js'
import { STYLE_SETTINGS } from '../src/style.js'

function manifestOf(assets: readonly AssetRecord[]): ContentManifest {
  return { manifestVersion: CONTENT_MANIFEST_VERSION, assets }
}

const GENERATED_MODEL: AssetRecord = {
  id: 'hero-wreck',
  kind: 'model-file',
  title: 'Hero wreck mesh',
  source: { kind: 'generated', generator: 'text-to-3d' },
  licence: 'CC0-1.0',
  path: 'assets/models/hero-wreck.glb',
}

describe('the catalogs', () => {
  test('every setting has a prop kit and an audio palette, and ids are unique', () => {
    for (const setting of STYLE_SETTINGS) {
      expect(propKitFor(setting).setting).toBe(setting)
      expect(audioPaletteFor(setting).setting).toBe(setting)
    }
    const kitIds = PROP_KITS.map(({ id }) => id)
    expect(new Set(kitIds).size).toBe(kitIds.length)
    const paletteIds = AUDIO_PALETTES.map(({ id }) => id)
    expect(new Set(paletteIds).size).toBe(paletteIds.length)
  })

  test('every authored prop and cue parses at its version', () => {
    for (const kit of PROP_KITS) {
      for (const spec of kit.props) expect(parsePropSpec(spec)).not.toBeNull()
    }
    for (const palette of AUDIO_PALETTES) {
      for (const cue of palette.cues) expect(parseAudioCueSpec(cue)).not.toBeNull()
    }
  })

  test('parsers are defensive: wrong version or shape is null, never a throw', () => {
    const spec = PROP_KITS[0]!.props[0]!
    expect(parsePropSpec({ ...spec, propVersion: 2 })).toBeNull()
    expect(parsePropSpec({ ...spec, parts: [] })).toBeNull()
    const cue = AUDIO_PALETTES[0]!.cues[0]!
    expect(parseAudioCueSpec({ ...cue, cueVersion: 2 })).toBeNull()
    expect(parseAudioCueSpec({ ...cue, synth: { ...cue.synth, gain: 2 } })).toBeNull()
    expect(parseContentManifest({ manifestVersion: 2, assets: [] })).toBeNull()
  })

  test('no record in any catalog carries a secret-looking field', () => {
    // The same guard the agent config passes through: a manifest is config too.
    for (const kit of PROP_KITS) expect(() => assertSafeConfigFields(kit)).not.toThrow()
    for (const palette of AUDIO_PALETTES) expect(() => assertSafeConfigFields(palette)).not.toThrow()
    expect(() => assertSafeConfigFields(CONTENT_WORKFLOWS)).not.toThrow()
  })
})

describe('the admission gate', () => {
  test('admits a clean data manifest with no disk probe at all', () => {
    const kit = propKitFor('science-fiction')
    const report = admitAssets(manifestOf([
      { id: kit.props[0]!.id, kind: 'prop-spec', title: 'Prop', source: { kind: 'authored' }, data: kit.props[0]! },
      { id: PREVIS_BIPED.id, kind: 'rig', title: 'Rig', source: { kind: 'authored' }, data: PREVIS_BIPED },
      { id: MOTION_CLIPS[0]!.id, kind: 'motion-clip', title: 'Clip', source: { kind: 'authored' }, data: MOTION_CLIPS[0]! },
    ]))
    expect(report.ok).toBeTrue()
    expect(report.admitted).toHaveLength(3)
  })

  test('a generated file with no bytes on disk blocks admission, naming the generator', () => {
    const report = admitAssets(manifestOf([GENERATED_MODEL]), () => null)
    expect(report.ok).toBeFalse()
    expect(report.blocked).toHaveLength(1)
    expect(report.blocked[0]!.code).toBe('generator_output_missing')
    expect(report.blocked[0]!.reason).toContain('text-to-3d')
    expect(report.blocked[0]!.reason).toContain('assets/models/hero-wreck.glb')
  })

  test('the same declaration admits once the generator has actually produced the file', () => {
    const report = admitAssets(manifestOf([GENERATED_MODEL]), (path) =>
      path === 'assets/models/hero-wreck.glb' ? { size: 512 } : null,
    )
    expect(report.ok).toBeTrue()
  })

  test('authored files miss differently, and empty files are not files', () => {
    const authored: AssetRecord = { ...GENERATED_MODEL, id: 'a', source: { kind: 'authored' } }
    const missing = admitAssets(manifestOf([authored]), () => null)
    expect(missing.blocked[0]!.code).toBe('file_missing')
    const empty = admitAssets(manifestOf([authored]), () => ({ size: 0 }))
    expect(empty.blocked[0]!.code).toBe('empty_file')
  })

  test('file records need a licence, a safe path, and the right format', () => {
    const probe = () => ({ size: 10 })
    const unlicensed = admitAssets(manifestOf([{ ...GENERATED_MODEL, licence: undefined }]), probe)
    expect(unlicensed.blocked[0]!.code).toBe('missing_licence')
    const escaping = admitAssets(manifestOf([{ ...GENERATED_MODEL, path: '../outside.glb' }]), probe)
    expect(escaping.blocked[0]!.code).toBe('unsafe_path')
    const absolute = admitAssets(manifestOf([{ ...GENERATED_MODEL, path: 'C:/models/x.glb' }]), probe)
    expect(absolute.blocked[0]!.code).toBe('unsafe_path')
    const wrongFormat = admitAssets(manifestOf([{ ...GENERATED_MODEL, path: 'assets/models/x.txt' }]), probe)
    expect(wrongFormat.blocked[0]!.code).toBe('wrong_extension')
  })

  test('duplicates, misplaced payloads, and invalid documents all block by name', () => {
    const spec = propKitFor('unspecified').props[0]!
    const record: AssetRecord = { id: 'p', kind: 'prop-spec', title: 'P', source: { kind: 'authored' }, data: spec }
    const duplicated = admitAssets(manifestOf([record, record]))
    expect(duplicated.blocked.map(({ code }) => code)).toEqual(['duplicate_id'])

    const withPath = admitAssets(manifestOf([{ ...record, path: 'somewhere.json' }]))
    expect(withPath.blocked[0]!.code).toBe('unexpected_path')

    const badData = admitAssets(manifestOf([{ ...record, data: { propVersion: 9 } }]))
    expect(badData.blocked[0]!.code).toBe('invalid_data')

    const badClip = admitAssets(manifestOf([
      { id: 'c', kind: 'motion-clip', title: 'C', source: { kind: 'authored' }, data: { ...MOTION_CLIPS[0]!, rig: 'unknown-rig' } },
    ]))
    expect(badClip.blocked[0]!.code).toBe('unknown_rig')
  })

  test('every failure is reported in one pass, not one per run', () => {
    const report = admitAssets(manifestOf([
      GENERATED_MODEL,
      { id: 'bad-cue', kind: 'audio-cue', title: 'Bad', source: { kind: 'authored' }, data: { cueVersion: 3 } },
    ]), () => null)
    expect(report.ok).toBeFalse()
    expect(report.blocked).toHaveLength(2)
    expect(report.verdicts).toHaveLength(2)
  })
})

describe('the workflow records', () => {
  test('all four pipelines are versioned and every stage names a real capability', () => {
    expect(CONTENT_WORKFLOWS.map(({ id }) => id)).toEqual([
      'workflow-model',
      'workflow-motion',
      'workflow-audio',
      'workflow-cutscene',
    ])
    for (const workflow of CONTENT_WORKFLOWS) {
      expect(workflow.workflowVersion).toBe(1)
      expect(workflow.stages.length).toBeGreaterThan(1)
      for (const stage of workflow.stages) {
        expect(capabilityById(stage.uses)).toBeDefined()
        expect(stage.gate).not.toBe('')
        expect(stage.produces).not.toBe('')
      }
    }
  })

  test('the cut-scene workflow states the missing-clip promise in its own gate', () => {
    const cutscene = CONTENT_WORKFLOWS.find(({ id }) => id === 'workflow-cutscene')!
    const rehearse = cutscene.stages.find(({ id }) => id === 'rehearse')!
    expect(rehearse.gate).toContain('missing clip is never emitted')
  })
})
