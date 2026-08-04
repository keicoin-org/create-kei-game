/**
 * Motion: the clip documents, the adapter seam a generator would plug into,
 * and the ready gate. The gate's promise — no unready clip passes — is the
 * invariant the cut-scene tests then lean on.
 */

import { describe, expect, test } from 'bun:test'

import {
  authoredClipRecords,
  authoredMotionAdapter,
  isClipReady,
  MOTION_CLIP_VERSION,
  MOTION_CLIPS,
  motionClipById,
  motionReadyGate,
  parseMotionClipDoc,
  PREVIS_BIPED,
  validateClipAgainstRig,
  type MotionAdapter,
  type MotionClipRecord,
} from '../src/motion.js'

describe('clip documents', () => {
  test('every authored clip parses at the current version and fits its rig', () => {
    expect(MOTION_CLIPS.length).toBeGreaterThan(3)
    for (const clip of MOTION_CLIPS) {
      expect(parseMotionClipDoc(clip)).not.toBeNull()
      expect(validateClipAgainstRig(clip, PREVIS_BIPED)).toEqual([])
    }
  })

  test('a foreign or future version parses to null rather than half-loading', () => {
    const clip = motionClipById('walk-loop')!
    expect(parseMotionClipDoc({ ...clip, clipVersion: 2 })).toBeNull()
    expect(parseMotionClipDoc({ ...clip, clipVersion: undefined })).toBeNull()
    expect(parseMotionClipDoc('walk-loop')).toBeNull()
    expect(parseMotionClipDoc(null)).toBeNull()
  })

  test('malformed tracks are rejected whole: order, counts, bounds', () => {
    const base = motionClipById('turn-quarter')!
    const withTrack = (track: unknown) => parseMotionClipDoc({ ...base, tracks: [track] })
    expect(withTrack({ node: 'root', property: 'rotation', times: [0.5, 1], values: [[0, 0, 0], [0, 0, 0]] })).toBeNull() // first key not at 0
    expect(withTrack({ node: 'root', property: 'rotation', times: [0, 0], values: [[0, 0, 0], [0, 0, 0]] })).toBeNull() // not ascending
    expect(withTrack({ node: 'root', property: 'rotation', times: [0], values: [[0, 0, 0], [0, 0, 0]] })).toBeNull() // count mismatch
    expect(withTrack({ node: 'root', property: 'scale', times: [0], values: [[0, 0, 0]] })).toBeNull() // unknown property
  })

  test('a clip that animates a node its rig does not have is named, not trusted', () => {
    const clip = parseMotionClipDoc({
      clipVersion: MOTION_CLIP_VERSION,
      id: 'bad',
      title: 'Bad',
      rig: PREVIS_BIPED.id,
      durationMs: 1000,
      loop: false,
      tracks: [{ node: 'tail', property: 'rotation', times: [0], values: [[0, 0, 0]] }],
    })!
    const problems = validateClipAgainstRig(clip, PREVIS_BIPED)
    expect(problems.join(' ')).toContain('"tail"')
  })
})

describe('the ready gate', () => {
  test('ready is the strict triple: status, current version, payload', () => {
    const clip = motionClipById('idle-breathe')!
    const ready: MotionClipRecord = { id: clip.id, status: 'ready', adapter: 't', clipVersion: MOTION_CLIP_VERSION, clip }
    expect(isClipReady(ready)).toBeTrue()
    // A claim of ready with no payload, or with a version this build does not
    // speak, fails closed — the record is a claim and the gate checks it.
    expect(isClipReady({ ...ready, clip: undefined })).toBeFalse()
    expect(isClipReady({ ...ready, clipVersion: 2 })).toBeFalse()
    expect(isClipReady({ ...ready, status: 'pending' })).toBeFalse()
  })

  test('every miss is reported at once, in required order', () => {
    const records = authoredClipRecords(['idle-breathe'])
    const gate = motionReadyGate(records, ['idle-breathe', 'walk-loop', 'no-such-clip'])
    expect(gate.ok).toBeFalse()
    if (gate.ok) throw new Error('unreachable')
    expect(gate.missing.map(({ id }) => id)).toEqual(['walk-loop', 'no-such-clip'])
    expect(gate.missing[0]!.status).toBe('unlisted')
    for (const miss of gate.missing) expect(miss.reason).not.toBe('')
  })

  test('a clean gate hands back the clips by id', () => {
    const gate = motionReadyGate(authoredClipRecords(['idle-breathe', 'walk-loop']), ['walk-loop'])
    expect(gate.ok).toBeTrue()
    if (!gate.ok) throw new Error('unreachable')
    expect(gate.clips.get('walk-loop')?.id).toBe('walk-loop')
  })
})

describe('the adapter seam', () => {
  test('the authored adapter answers through the same seam a generator would', async () => {
    const report = await authoredMotionAdapter.ingest(
      { clips: [{ id: 'walk-loop' }, { id: 'not-a-clip' }] },
      { stat: () => null },
    )
    expect(report.adapter).toBe('authored-clips')
    expect(report.clips).toHaveLength(2)
    expect(report.clips[0]!.status).toBe('ready')
    expect(report.clips[1]!.status).toBe('missing')
    expect(report.clips[1]!.reason).toContain('not-a-clip')
  })

  test('an ARDY-shaped adapter with pending work is blocked by the gate, not worked around', async () => {
    // A stand-in for a text-to-motion service mid-generation: the request
    // carries prompt, duration, and a pinned seed; the report answers every
    // requested clip explicitly. Nothing ready ever comes back silently.
    const generating: MotionAdapter = {
      id: 'fake-ardy',
      title: 'Fake motion service',
      capability: 'content-3d-motion-capture',
      async ingest(request) {
        return {
          adapter: 'fake-ardy',
          clips: request.clips.map((clip) => ({
            id: clip.id,
            status: 'pending' as const,
            adapter: 'fake-ardy',
            reason: `generation for "${clip.prompt ?? clip.id}" (seed ${clip.seed ?? 0}) has not finished`,
          })),
        }
      },
    }

    const report = await generating.ingest(
      { clips: [{ id: 'hero-vault', prompt: 'vault over a crate', durationMs: 2000, seed: 7 }] },
      { stat: () => null },
    )
    const gate = motionReadyGate(report.clips, ['hero-vault'])
    expect(gate.ok).toBeFalse()
    if (gate.ok) throw new Error('unreachable')
    expect(gate.missing[0]!.status).toBe('pending')
    expect(gate.missing[0]!.reason).toContain('seed 7')
  })
})
