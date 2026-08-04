/**
 * Deterministic lexical matching for planner intent signals.
 *
 * This record is derived in-process and never crosses the intent, plan, or
 * session boundary. Project names are deliberately absent: they label output,
 * while only the five description goals can describe semantic intent.
 */

import {
  INTENT_GOAL_FIELDS,
  MMO_INTENT_VERSION,
  type IntentGoalField,
  type MmoIntent,
} from './intent.js'

export interface IntentSignalMatch {
  /** The canonical catalog term that matched. */
  readonly signal: string
  /** The description field containing the first bounded occurrence. */
  readonly field: IntentGoalField
  /** Stable position across the five ordered, normalized goal fields. */
  readonly index: number
}

export interface IntentSignalRecord {
  readonly matches: readonly IntentSignalMatch[]
}

const WORD_CHARACTER = String.raw`\p{L}\p{N}\p{M}_`

function normalizedText(value: string): string {
  return value.normalize('NFKC').toLowerCase()
}

function normalizedSignal(value: string): string {
  return normalizedText(value).trim().replace(/\s+/gu, ' ')
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Signals are exact words or phrases, not substrings. Whitespace inside an
 * explicitly declared phrase accepts any whitespace run; hyphen/space aliases
 * remain separate catalog entries rather than fuzzy rewrites.
 */
function patternFor(signal: string): RegExp {
  const phrase = escaped(normalizedSignal(signal)).replace(/ /g, String.raw`\s+`)
  return new RegExp(`(?<![${WORD_CHARACTER}])${phrase}(?![${WORD_CHARACTER}])`, 'u')
}

/** Build one canonical, immutable match record for all planner consumers. */
export function matchIntentSignals(
  intent: MmoIntent,
  requestedSignals: readonly string[],
): IntentSignalRecord {
  const signals = [...new Map(
    requestedSignals
      .map((signal) => [normalizedSignal(signal), signal] as const)
      .filter(([key]) => key !== ''),
  ).values()]
  const sources = INTENT_GOAL_FIELDS.map((field) => ({
    field,
    text: normalizedText(intent[field]),
  }))
  const offsets = new Map<IntentGoalField, number>()
  let offset = 0
  for (const source of sources) {
    offsets.set(source.field, offset)
    offset += source.text.length + 1
  }

  const matches: IntentSignalMatch[] = []
  for (const signal of signals) {
    const pattern = patternFor(signal)
    for (const source of sources) {
      const found = pattern.exec(source.text)
      if (found === null) continue
      matches.push(Object.freeze({
        signal,
        field: source.field,
        index: offsets.get(source.field)! + found.index,
      }))
      break
    }
  }

  matches.sort((left, right) => {
    if (left.index !== right.index) return left.index - right.index
    return left.signal < right.signal ? -1 : left.signal > right.signal ? 1 : 0
  })
  return Object.freeze({ matches: Object.freeze(matches) })
}

/** Compatibility helper for catalog callers that only have one brief string. */
export function matchSignalText(
  signalText: string,
  requestedSignals: readonly string[],
): IntentSignalRecord {
  const intent: MmoIntent = {
    intentVersion: MMO_INTENT_VERSION,
    name: 'Signal text',
    dimension: 'auto',
    gameplay: signalText,
    world: '',
    art: '',
    network: '',
    economy: '',
  }
  return matchIntentSignals(intent, requestedSignals)
}

export function matchesFor(
  record: IntentSignalRecord,
  requestedSignals: readonly string[],
): readonly IntentSignalMatch[] {
  const bySignal = new Map(record.matches.map((match) => [normalizedSignal(match.signal), match]))
  const seen = new Set<string>()
  const matches: IntentSignalMatch[] = []
  for (const signal of requestedSignals) {
    const key = normalizedSignal(signal)
    if (seen.has(key)) continue
    seen.add(key)
    const match = bySignal.get(key)
    if (match !== undefined) matches.push(match)
  }
  return Object.freeze(matches)
}

export function firstMatchFor(
  record: IntentSignalRecord,
  requestedSignals: readonly string[],
): IntentSignalMatch | undefined {
  return matchesFor(record, requestedSignals)[0]
}

export function describeSignalMatch(match: IntentSignalMatch): string {
  return `"${match.signal}" in ${match.field}`
}
