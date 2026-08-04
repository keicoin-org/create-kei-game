/**
 * The catalog's own invariant: a packet has to be actionable.
 *
 * "Actionable" is checkable. A packet that names a topic and stops is what this
 * file exists to fail on, so every one of them must carry prerequisites, tools,
 * methods with real call text, and acceptance it can be judged by.
 */

import { describe, expect, test } from 'bun:test'

import {
  CAPABILITY_DOMAINS,
  CAPABILITY_PACKETS,
  capabilityById,
  selectCapabilities,
} from '../src/capabilities.js'

describe('the capability catalog', () => {
  test('covers every domain an MMO plan has to speak to', () => {
    const covered = new Set(CAPABILITY_PACKETS.map((packet) => packet.domain))
    for (const domain of CAPABILITY_DOMAINS) expect(covered.has(domain)).toBeTrue()
  })

  test('names both renderers, both animation paths, and the rest by id', () => {
    for (const id of [
      'render-2d',
      'render-3d',
      'animation-2d',
      'animation-3d',
      'shaders',
      'post-processing',
      'network-authority',
      'persistence-streaming',
      'economy-kei',
      'ui-hud',
      'audio',
      'content-pipeline',
      'testing',
      'deployment',
    ]) {
      expect(capabilityById(id)).toBeDefined()
    }
    expect(capabilityById('nothing-like-this')).toBeUndefined()
  })

  test('every id is unique', () => {
    const ids = CAPABILITY_PACKETS.map((packet) => packet.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test.each(CAPABILITY_PACKETS.map((packet) => [packet.id, packet] as const))(
    '%s states prerequisites, tools, methods, and acceptance',
    (_id, packet) => {
      expect(packet.prerequisites.length).toBeGreaterThan(0)
      expect(packet.tools.length).toBeGreaterThan(0)
      expect(packet.methods.length).toBeGreaterThan(2)
      expect(packet.acceptance.length).toBeGreaterThan(0)
      expect(packet.summary.length).toBeGreaterThan(40)

      for (const line of [...packet.prerequisites, ...packet.acceptance]) {
        // A bare topic word is what this catalog is not allowed to contain.
        expect(line.split(' ').length).toBeGreaterThan(3)
      }
      // A tool is a name rather than a sentence, but it still has to be one.
      for (const tool of packet.tools) expect(tool.trim().length).toBeGreaterThan(2)
      for (const method of packet.methods) {
        expect(method.call.trim()).not.toBe('')
        // A method is a call, so it has to look like one.
        expect(method.call).toMatch(/[(.=]/)
        expect(method.does.split(' ').length).toBeGreaterThan(3)
      }
    },
  )

  test('an optional packet carries the signals that would pull it in', () => {
    for (const packet of CAPABILITY_PACKETS) {
      if (packet.core) continue
      expect(packet.signals.length).toBeGreaterThan(0)
    }
  })

  test('every packet declares a status, core packets are available, and the rest say why not', () => {
    for (const packet of CAPABILITY_PACKETS) {
      expect(['available', 'planned', 'absent']).toContain(packet.status)
      // A core packet that is not implemented would be a plan citing vapour.
      if (packet.core) expect(packet.status).toBe('available')
      if (packet.status !== 'available') {
        expect(packet.statusReason).toBeString()
        expect(packet.statusReason!.split(' ').length).toBeGreaterThan(8)
      }
    }
  })

  test('the external generators are declared planned or absent, never available', () => {
    expect(capabilityById('content-3d-model-generation')?.status).toBe('planned')
    expect(capabilityById('content-3d-motion-capture')?.status).toBe('planned')
    expect(capabilityById('content-3d-sfx-generation')?.status).toBe('planned')
    expect(capabilityById('content-3d-voice-acting')?.status).toBe('absent')
  })

  test('polish remains planned for both dimensions until admitted assets and captures exist', () => {
    expect(capabilityById('polish-2d')?.status).toBe('planned')
    expect(capabilityById('polish-3d')?.status).toBe('planned')
    expect(capabilityById('polish-2d')?.statusReason).toContain('no licensed 2D art or audio')
    expect(capabilityById('polish-3d')?.statusReason).toContain('no licensed 3D art or audio')
  })

  test('the economy packet names the published player-custodied API', () => {
    const packet = capabilityById('economy-kei')!
    expect(packet.tools.join(' ')).toContain('kei-transaction@0.6.0')
    const calls = packet.methods.map((method) => method.call).join(' ')
    expect(calls).toContain('Kei.mock()')
    expect(calls).toContain('market.offer')
    expect(calls).toContain('market.accept')
    expect(calls).not.toContain('openEscrow')
  })
})

describe('selection', () => {
  test('keeps the packets for the chosen dimension and defers the other pair', () => {
    const solid = selectCapabilities('3d', '')
    expect(solid.selected.map(({ packet }) => packet.id)).toContain('render-3d')
    expect(solid.deferred.map(({ id }) => id)).toContain('render-2d')
    expect(solid.deferred.map(({ id }) => id)).toContain('animation-2d')

    const flat = selectCapabilities('2d', '')
    expect(flat.selected.map(({ packet }) => packet.id)).toContain('render-2d')
    expect(flat.deferred.map(({ id }) => id)).toContain('render-3d')
  })

  test('every selected packet carries the sentence that selected it', () => {
    for (const entry of selectCapabilities('3d', 'bloom and ambient music').selected) {
      expect(entry.reason).not.toBe('')
    }
  })

  test('a signal hit is quoted back, and a miss says what would have hit', () => {
    const hit = selectCapabilities('3d', 'lots of neon glow')
    expect(hit.selected.find(({ packet }) => packet.id === 'post-processing')?.reason).toContain('glow')

    const miss = selectCapabilities('3d', 'plain and quiet')
    expect(miss.deferred.find(({ id }) => id === 'audio')?.reason).toMatch(/Name one of/)
  })

  test('is case-insensitive about the intent text', () => {
    const upper = selectCapabilities('3d', 'BLOOM')
    expect(upper.selected.map(({ packet }) => packet.id)).toContain('post-processing')
  })

  test('a 2D plan can still reach the shader packet', () => {
    const flat = selectCapabilities('2d', 'a stylised water shader')
    expect(flat.selected.map(({ packet }) => packet.id)).toContain('shaders')
    // …but never the 3D-only full-screen chain.
    expect(flat.selected.map(({ packet }) => packet.id)).not.toContain('post-processing')
  })

  test('a planned packet is never selected, even when the intent begs for it', () => {
    const selection = selectCapabilities('3d', 'full mocap and motion capture everywhere, generated models too')
    const ids = selection.selected.map(({ packet }) => packet.id)
    expect(ids).not.toContain('content-3d-motion-capture')
    expect(ids).not.toContain('content-3d-model-generation')

    const mocap = selection.deferred.find(({ id }) => id === 'content-3d-motion-capture')
    expect(mocap?.reason).toContain('mentions "mocap"')
    expect(mocap?.reason).toContain('planned')
  })

  test('planned and absent packets appear in every matching plan\'s deferrals, naming their status', () => {
    const quiet = selectCapabilities('3d', 'nothing special at all')
    const byId = new Map(quiet.deferred.map((entry) => [entry.id, entry.reason]))
    expect(byId.get('content-3d-model-generation')).toContain('Declared planned')
    expect(byId.get('content-3d-voice-acting')).toContain('Declared absent')
  })

  test('the 3D content core lands in every 3D plan and is deferred from 2D ones', () => {
    const solid = selectCapabilities('3d', '')
    expect(solid.selected.map(({ packet }) => packet.id)).toContain('content-3d-props')
    expect(solid.selected.map(({ packet }) => packet.id)).toContain('content-3d-motion')

    const flat = selectCapabilities('2d', '')
    expect(flat.selected.map(({ packet }) => packet.id)).not.toContain('content-3d-props')
    expect(flat.deferred.map(({ id }) => id)).toContain('content-3d-props')
  })
})
