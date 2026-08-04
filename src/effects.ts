/** Pure presentation records. They describe feedback; they never mutate game state. */

export const QUALITY_TIERS = ['low', 'medium', 'high'] as const
export type QualityTier = (typeof QUALITY_TIERS)[number]

export const SEMANTIC_EVENTS = [
  'anticipation',
  'contact',
  'success',
  'refusal',
  'cooldown',
  'recovery',
] as const
export type SemanticEvent = (typeof SEMANTIC_EVENTS)[number]

export const SEMANTIC_CUES = [
  'ambience',
  'footstep',
  'interaction',
  'swing',
  'impact',
  'refusal',
  'success',
  'cooldown',
  'recovery',
] as const
export type SemanticCue = (typeof SEMANTIC_CUES)[number]

export interface EffectRecipe {
  readonly event: SemanticEvent
  readonly cue: SemanticCue
  readonly visual: 'telegraph' | 'contact' | 'status'
  readonly cameraImpulse: number
  readonly hud: 'action' | 'success' | 'refusal' | 'cooldown' | 'recovery'
  readonly reducedMotion: {
    readonly visual: 'telegraph' | 'contact' | 'status'
    readonly hud: 'action' | 'success' | 'refusal' | 'cooldown' | 'recovery'
    readonly cameraImpulse: 0
  }
}

export interface QualityProfile {
  readonly tier: QualityTier
  readonly maxParticles: number
  readonly maxVoices: number
  readonly postProcessing: readonly ('fxaa' | 'bloom' | 'ssao')[]
  readonly shadows: boolean
  readonly cameraImpulseScale: number
  readonly targetFps: 30 | 60
  readonly p95FrameMs: number
  readonly p99FrameMs: number
  readonly maxLongFrameMs: number
}

const POST_PROCESSING = new Set(['fxaa', 'bloom', 'ssao'])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...keys].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

export function parseEffectRecipe(value: unknown, event: SemanticEvent): EffectRecipe | null {
  if (!record(value) || !exactKeys(value, ['event', 'cue', 'visual', 'cameraImpulse', 'hud', 'reducedMotion'])) return null
  if (value.event !== event) return null
  if (!SEMANTIC_CUES.includes(value.cue as SemanticCue)) return null
  if (!['telegraph', 'contact', 'status'].includes(String(value.visual))) return null
  if (!['action', 'success', 'refusal', 'cooldown', 'recovery'].includes(String(value.hud))) return null
  if (typeof value.cameraImpulse !== 'number' || !Number.isFinite(value.cameraImpulse) || value.cameraImpulse < 0 || value.cameraImpulse > 1) return null
  if (!record(value.reducedMotion) || !exactKeys(value.reducedMotion, ['visual', 'hud', 'cameraImpulse'])) return null
  if (!['telegraph', 'contact', 'status'].includes(String(value.reducedMotion.visual))) return null
  if (!['action', 'success', 'refusal', 'cooldown', 'recovery'].includes(String(value.reducedMotion.hud))) return null
  if (value.reducedMotion.cameraImpulse !== 0) return null
  return Object.freeze({
    event,
    cue: value.cue as SemanticCue,
    visual: value.visual as EffectRecipe['visual'],
    cameraImpulse: value.cameraImpulse,
    hud: value.hud as EffectRecipe['hud'],
    reducedMotion: Object.freeze({
      visual: value.reducedMotion.visual as EffectRecipe['reducedMotion']['visual'],
      hud: value.reducedMotion.hud as EffectRecipe['reducedMotion']['hud'],
      cameraImpulse: 0,
    }),
  })
}

export function parseQualityProfile(value: unknown, tier: QualityTier): QualityProfile | null {
  if (!record(value) || !exactKeys(value, ['tier', 'maxParticles', 'maxVoices', 'postProcessing', 'shadows', 'cameraImpulseScale', 'targetFps', 'p95FrameMs', 'p99FrameMs', 'maxLongFrameMs'])) return null
  if (value.tier !== tier) return null
  if (!Number.isInteger(value.maxParticles) || (value.maxParticles as number) < 0 || (value.maxParticles as number) > 512) return null
  if (!Number.isInteger(value.maxVoices) || (value.maxVoices as number) < 1 || (value.maxVoices as number) > 64) return null
  if (!Array.isArray(value.postProcessing) || value.postProcessing.some((entry) => typeof entry !== 'string' || !POST_PROCESSING.has(entry))) return null
  if (new Set(value.postProcessing).size !== value.postProcessing.length) return null
  if (typeof value.shadows !== 'boolean') return null
  if (typeof value.cameraImpulseScale !== 'number' || !Number.isFinite(value.cameraImpulseScale) || value.cameraImpulseScale < 0 || value.cameraImpulseScale > 1) return null
  if (![30, 60].includes(value.targetFps as number)) return null
  for (const field of ['p95FrameMs', 'p99FrameMs', 'maxLongFrameMs'] as const) {
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || (value[field] as number) <= 0 || (value[field] as number) > 100) return null
  }
  if ((value.p95FrameMs as number) > (value.p99FrameMs as number) || (value.p99FrameMs as number) > (value.maxLongFrameMs as number)) return null
  return Object.freeze({
    tier,
    maxParticles: value.maxParticles as number,
    maxVoices: value.maxVoices as number,
    postProcessing: Object.freeze([...(value.postProcessing as QualityProfile['postProcessing'])]),
    shadows: value.shadows,
    cameraImpulseScale: value.cameraImpulseScale,
    targetFps: value.targetFps as 30 | 60,
    p95FrameMs: value.p95FrameMs as number,
    p99FrameMs: value.p99FrameMs as number,
    maxLongFrameMs: value.maxLongFrameMs as number,
  })
}

/** Lower tiers may remove cost, but may never demand more work than a higher tier. */
export function qualityDegradesSafely(profiles: Readonly<Record<QualityTier, QualityProfile>>): boolean {
  const ordered = QUALITY_TIERS.map((tier) => profiles[tier])
  for (let index = 1; index < ordered.length; index += 1) {
    const lower = ordered[index - 1]!
    const higher = ordered[index]!
    if (lower.maxParticles > higher.maxParticles || lower.maxVoices > higher.maxVoices) return false
    if (lower.cameraImpulseScale > higher.cameraImpulseScale) return false
    if (lower.shadows && !higher.shadows) return false
    if (lower.postProcessing.some((effect) => !higher.postProcessing.includes(effect))) return false
    if (lower.targetFps > higher.targetFps) return false
    if (higher.p95FrameMs > lower.p95FrameMs || higher.p99FrameMs > lower.p99FrameMs || higher.maxLongFrameMs > lower.maxLongFrameMs) return false
  }
  return true
}
