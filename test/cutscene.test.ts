/**
 * The cut-scene pipeline: deterministic at every stage, bounded by the
 * published limits, and incapable of emitting a document that references a
 * clip the ready gate did not pass.
 */

import { describe, expect, test } from 'bun:test'

import {
  assembleCutScene,
  CutSceneError,
  cutSceneBeats,
  MAX_CUTSCENE_BEATS,
  MAX_CUTSCENE_MS,
  MIN_BEAT_MS,
  parseCutSceneDocument,
  planCutScene,
  rehearseCutScene,
  stageCutScene,
  stripUnready,
  type CutScenePlanInput,
  type RehearsalInputs,
} from '../src/cutscene.js'
import { authoredClipRecords, MOTION_CLIPS } from '../src/motion.js'
import { resolveStyle } from '../src/style.js'
import { intentFor } from './fixtures.js'

const SCI_FI = resolveStyle(intentFor({ gameplay: 'Crews salvage derelict stations in orbit.' }))

function planInput(overrides: Partial<CutScenePlanInput> = {}): CutScenePlanInput {
  return {
    project: { title: 'Salvage Run', slug: 'salvage-run' },
    style: SCI_FI,
    cast: [
      {
        id: 'newcomer',
        title: 'The newcomer',
        rig: 'previs-biped',
        clips: { hold: 'idle-breathe', move: 'walk-loop', feature: 'kneel-inspect' },
      },
    ],
    subjectId: 'newcomer',
    propIds: ['cargo-crate', 'console-bank'],
    cues: { ambience: 'cue-drone', accent: 'cue-scanner', sting: 'cue-arrival-sting' },
    ...overrides,
  }
}

function readyInputs(): RehearsalInputs {
  return {
    clipRecords: authoredClipRecords(MOTION_CLIPS.map(({ id }) => id)),
    admitted: new Set(['cargo-crate', 'console-bank', 'cue-drone', 'cue-scanner', 'cue-arrival-sting']),
  }
}

function assembled(input: CutScenePlanInput = planInput(), inputs: RehearsalInputs = readyInputs()) {
  const plan = planCutScene(input)
  const staged = stageCutScene(plan)
  const beats = cutSceneBeats(plan, staged)
  const rehearsal = rehearseCutScene(plan, staged, beats, inputs)
  return { plan, staged, beats, rehearsal, doc: assembleCutScene(plan, staged, beats, rehearsal) }
}

describe('the staged pipeline', () => {
  test('assembles byte-identical documents from identical inputs', () => {
    expect(JSON.stringify(assembled().doc)).toBe(JSON.stringify(assembled().doc))
  })

  test('stays inside the published bounds, and rehearsal checks them', () => {
    const { beats, doc } = assembled()
    expect(beats.beats.length).toBeLessThanOrEqual(MAX_CUTSCENE_BEATS)
    expect(doc.durationMs).toBeLessThanOrEqual(MAX_CUTSCENE_MS)
    for (const beat of beats.beats) {
      expect(beat.durationMs).toBeGreaterThanOrEqual(MIN_BEAT_MS)
    }
    // Beat starts accumulate exactly; the document carries its own total.
    let expected = 0
    for (const beat of doc.beats) {
      expect(beat.startMs).toBe(expected)
      expected += beat.durationMs
    }
    expect(doc.durationMs).toBe(expected)
  })

  test('out-of-bounds beats are rehearsal failures with their codes', () => {
    const { plan, staged, beats } = assembled()
    const tooLong = {
      beats: beats.beats.map((beat) => ({ ...beat, durationMs: 20_000 })),
    }
    const report = rehearseCutScene(plan, staged, tooLong, readyInputs())
    expect(report.ok).toBeFalse()
    const codes = report.failures.map(({ code }) => code)
    expect(codes).toContain('beat_too_long')
    expect(codes).toContain('cutscene_too_long')
  })

  test('the style names the scene; a sci-fi brief never produces fantasy dressing', () => {
    const { doc } = assembled()
    expect(doc.setting).toBe('science-fiction')
    expect(doc.title).toContain('First docking')
    const everything = JSON.stringify(doc).toLowerCase()
    for (const word of ['fantasy', 'dragon', 'magic', 'shrine', 'arcane', 'banner']) {
      expect(everything).not.toContain(word)
    }
  })

  test('a plan without audio produces beats without cues, not dangling ids', () => {
    const { doc } = assembled(planInput({ cues: {} }), {
      clipRecords: authoredClipRecords(MOTION_CLIPS.map(({ id }) => id)),
      admitted: new Set(['cargo-crate', 'console-bank']),
    })
    expect(doc.assets.cues).toEqual([])
    for (const beat of doc.beats) expect(beat.cues).toEqual([])
  })

  test('staging is explicit: every cast member and prop is placed, cameras aim', () => {
    const { staged, plan } = assembled()
    for (const member of plan.cast) {
      expect(staged.placements.find(({ id }) => id === `actor-${member.id}`)).toBeDefined()
    }
    for (const propId of plan.propIds) {
      expect(staged.placements.find(({ id }) => id === `prop-${propId}`)).toBeDefined()
    }
    const cameras = staged.placements.filter(({ kind }) => kind === 'camera')
    expect(cameras.length).toBe(2)
    for (const camera of cameras) {
      expect(camera.lookAt).toBeDefined()
      expect(camera.fovDeg).toBeGreaterThan(0)
    }
  })

  test('plans validate their inputs with the invalid_plan code', () => {
    expect(() => planCutScene(planInput({ subjectId: 'nobody' }))).toThrow(CutSceneError)
    expect(() => planCutScene(planInput({ cast: [] }))).toThrow(/casts between/)
    try {
      planCutScene(planInput({ subjectId: 'nobody' }))
    } catch (error) {
      expect((error as CutSceneError).code).toBe('invalid_plan')
    }
  })
})

describe('the ready gate at rehearsal', () => {
  test('a clip that is not ready fails rehearsal, and assembly refuses outright', () => {
    const input = planInput()
    const plan = planCutScene(input)
    const staged = stageCutScene(plan)
    const beats = cutSceneBeats(plan, staged)
    // The walk clip never became ready: the record set simply does not have it.
    const inputs: RehearsalInputs = {
      clipRecords: authoredClipRecords(['idle-breathe', 'kneel-inspect']),
      admitted: readyInputs().admitted,
    }

    const rehearsal = rehearseCutScene(plan, staged, beats, inputs)
    expect(rehearsal.ok).toBeFalse()
    const miss = rehearsal.failures.find(({ code }) => code === 'missing_clip')
    expect(miss?.at).toBe('clips.walk-loop')

    expect(() => assembleCutScene(plan, staged, beats, rehearsal)).toThrow(CutSceneError)
    try {
      assembleCutScene(plan, staged, beats, rehearsal)
    } catch (error) {
      expect((error as CutSceneError).code).toBe('rehearsal_failed')
      expect((error as CutSceneError).failures.length).toBeGreaterThan(0)
    }
  })

  test('an unadmitted cue or prop blocks the same way', () => {
    const input = planInput()
    const plan = planCutScene(input)
    const staged = stageCutScene(plan)
    const beats = cutSceneBeats(plan, staged)
    const inputs: RehearsalInputs = {
      clipRecords: readyInputs().clipRecords,
      admitted: new Set(['cargo-crate']), // console-bank and every cue missing
    }
    const report = rehearseCutScene(plan, staged, beats, inputs)
    expect(report.ok).toBeFalse()
    const codes = report.failures.map(({ code }) => code)
    expect(codes).toContain('cue_not_admitted')
    expect(codes).toContain('prop_not_admitted')
  })

  test('strip removes exactly the unsatisfiable references, and the result passes', () => {
    const input = planInput()
    const plan = planCutScene(input)
    const staged = stageCutScene(plan)
    const beats = cutSceneBeats(plan, staged)
    const inputs: RehearsalInputs = {
      clipRecords: authoredClipRecords(['idle-breathe', 'kneel-inspect']),
      admitted: new Set(['cargo-crate', 'console-bank', 'cue-drone', 'cue-arrival-sting']), // cue-scanner missing
    }

    const first = rehearseCutScene(plan, staged, beats, inputs)
    expect(first.ok).toBeFalse()

    const stripped = stripUnready(beats, first)
    expect(stripped.removedActions).toBeGreaterThan(0)
    expect(stripped.removedCues).toBe(1)
    expect(stripped.notes.join(' ')).toContain('walk-loop')

    const second = rehearseCutScene(plan, staged, stripped.beats, inputs)
    expect(second.ok).toBeTrue()
    const doc = assembleCutScene(plan, staged, stripped.beats, second)
    // The emitted document references only what was ready — the promise held.
    expect(doc.assets.clips).toEqual(['idle-breathe', 'kneel-inspect'])
    expect(doc.assets.cues).not.toContain('cue-scanner')
  })

  test('strip does not paper over structural failures', () => {
    const { plan, staged, beats } = assembled()
    const broken = { beats: beats.beats.map((beat) => ({ ...beat, durationMs: 100 })) }
    const report = rehearseCutScene(plan, staged, broken, readyInputs())
    const stripped = stripUnready(broken, report)
    const again = rehearseCutScene(plan, staged, stripped.beats, readyInputs())
    expect(again.ok).toBeFalse()
    expect(again.failures.map(({ code }) => code)).toContain('beat_too_short')
  })
})

describe('the document', () => {
  test('parses defensively: version 1 exactly, or null', () => {
    const { doc } = assembled()
    expect(parseCutSceneDocument(JSON.parse(JSON.stringify(doc)))).not.toBeNull()
    expect(parseCutSceneDocument({ ...doc, cutsceneVersion: 2 })).toBeNull()
    expect(parseCutSceneDocument('nope')).toBeNull()
    expect(parseCutSceneDocument(null)).toBeNull()
  })

  test('carries sorted asset lists a loader can preflight', () => {
    const { doc } = assembled()
    expect(doc.assets.clips).toEqual([...doc.assets.clips].sort())
    expect(doc.assets.cues).toEqual([...doc.assets.cues].sort())
    expect(doc.assets.props).toEqual([...doc.assets.props].sort())
    expect(doc.provenance.tool).toBe('create-kei-mmo')
  })
})
