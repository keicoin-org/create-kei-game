/**
 * What the game should look and sound like, read out of the intent once and
 * written down — never guessed again downstream.
 *
 * Two axes, deliberately separate. The *setting* is the world the brief
 * describes: science fiction, contemporary, historical, fantasy. The *finish*
 * is how it is drawn: grounded materials or a stylized flat look. A toon-shaded
 * space station and a painterly Roman port are both expressible, and neither
 * axis ever answers for the other.
 *
 * The rule this file exists to enforce: **no setting is assumed.** A brief that
 * names no setting gets `unspecified` and neutral previs-grade content. In
 * particular, fantasy is never a default — it is a reading of fantasy words in
 * the brief, and when those words are absent, nothing downstream may plan a
 * dragon into somebody's shipping simulator.
 */

import { intentSignalText, type MmoIntent } from './intent.js'

export const STYLE_PROFILE_VERSION = 1 as const

export const STYLE_SETTINGS = [
  'science-fiction',
  'contemporary',
  'historical',
  'fantasy',
  'unspecified',
] as const

export type StyleSetting = (typeof STYLE_SETTINGS)[number]

export const STYLE_FINISHES = ['grounded', 'stylized'] as const

export type StyleFinish = (typeof STYLE_FINISHES)[number]

export interface StyleProfile {
  readonly styleVersion: typeof STYLE_PROFILE_VERSION
  readonly setting: StyleSetting
  readonly finish: StyleFinish
  /** The exact signals that matched, per axis. Empty means nothing did. */
  readonly evidence: {
    readonly setting: readonly string[]
    readonly finish: readonly string[]
  }
  readonly rationale: readonly string[]
}

/**
 * Lowercase substrings, matched against every goal at once. Loose on purpose —
 * the same looseness the capability signals use — because a brief is prose, not
 * a form. Each list is evidence *for* its setting; absence of all of them is
 * evidence for nothing, which is what `unspecified` records.
 */
const SETTING_SIGNALS: Readonly<Record<Exclude<StyleSetting, 'unspecified'>, readonly string[]>> =
  Object.freeze({
    'science-fiction': Object.freeze([
      'sci-fi', 'science fiction', 'science-fiction', 'space', 'starship', 'spaceship',
      'star system', 'station', 'orbital', 'derelict', 'asteroid', 'galaxy', 'nebula',
      'cyberpunk', 'cybernetic', 'android', 'mech', 'laser', 'plasma', 'hologram',
      'terraform', 'warp', 'reactor',
    ]),
    contemporary: Object.freeze([
      'modern', 'contemporary', 'present-day', 'present day', 'real-world', 'real world',
      'city street', 'urban', 'downtown', 'suburb', 'office', 'smartphone', 'delivery',
      'traffic', 'skate', 'campus',
    ]),
    historical: Object.freeze([
      'historical', 'medieval', 'viking', 'roman', 'samurai', 'feudal', 'victorian',
      'ancient', 'bronze age', 'renaissance', 'pirate', 'age of sail', 'frontier',
      'wild west', 'dynasty', 'castle siege',
    ]),
    fantasy: Object.freeze([
      'fantasy', 'dragon', 'magic', 'mage', 'wizard', 'sorcery', 'sorcerer', 'spell',
      'enchanted', 'arcane', 'elf', 'elves', 'dwarf', 'dwarves', 'orc', 'goblin',
      'necromancer', 'mythical', 'fae', 'runes',
    ]),
  })

const STYLIZED_SIGNALS: readonly string[] = Object.freeze([
  'toon', 'cel-shaded', 'cel shaded', 'cel shading', 'cartoon', 'stylized', 'stylised',
  'low-poly', 'low poly', 'voxel', 'papercraft', 'claymation', 'hand-painted',
  'hand painted', 'painterly', 'flat-shaded', 'flat shaded', 'chibi', 'pixel',
])

interface SettingReading {
  readonly setting: Exclude<StyleSetting, 'unspecified'>
  readonly matches: readonly string[]
  /** Where this setting's earliest signal sits in the text. */
  readonly firstIndex: number
}

function readSetting(haystack: string): SettingReading | undefined {
  const readings: SettingReading[] = []
  for (const setting of Object.keys(SETTING_SIGNALS) as Array<keyof typeof SETTING_SIGNALS>) {
    const matches = SETTING_SIGNALS[setting].filter((signal) => haystack.includes(signal))
    if (matches.length === 0) continue
    const firstIndex = Math.min(...matches.map((signal) => haystack.indexOf(signal)))
    readings.push({ setting, matches: Object.freeze(matches), firstIndex })
  }
  if (readings.length === 0) return undefined

  // Most evidence wins. On a tie, the setting the brief reached first wins —
  // that is still the brief deciding, not this file.
  readings.sort(
    (left, right) =>
      right.matches.length - left.matches.length ||
      left.firstIndex - right.firstIndex ||
      left.setting.localeCompare(right.setting),
  )
  return readings[0]
}

/**
 * The one place a style is decided. Pure: the same intent yields the same
 * profile, byte for byte, and the profile carries the words that decided it.
 */
export function resolveStyle(intent: MmoIntent): StyleProfile {
  const haystack = intentSignalText(intent)
  const reading = readSetting(haystack)
  const finishMatches = Object.freeze(
    STYLIZED_SIGNALS.filter((signal) => haystack.includes(signal)),
  )
  const finish: StyleFinish = finishMatches.length > 0 ? 'stylized' : 'grounded'

  const rationale: string[] = []
  if (reading) {
    rationale.push(
      `The brief reads as ${reading.setting}: it says ${reading.matches.slice(0, 4).join(', ')}.`,
    )
  } else {
    rationale.push(
      'No setting was described, so none is assumed: content is planned neutral and previs-grade, and no genre — fantasy included — leaks in uninvited.',
    )
  }
  rationale.push(
    finishMatches.length > 0
      ? `The finish is stylized: the brief says ${finishMatches.slice(0, 3).join(', ')}.`
      : 'No stylized finish was asked for, so materials stay grounded PBR — the cheapest look to keep coherent.',
  )

  return Object.freeze({
    styleVersion: STYLE_PROFILE_VERSION,
    setting: reading?.setting ?? 'unspecified',
    finish,
    evidence: Object.freeze({
      setting: reading?.matches ?? Object.freeze([]),
      finish: finishMatches,
    }),
    rationale: Object.freeze(rationale),
  })
}
