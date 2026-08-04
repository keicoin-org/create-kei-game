/**
 * What the person wants, in the only shape the rest of the harness reads.
 *
 * This is the whole input contract now. Nobody is asked which template to start
 * from or where a repository lives, because those are answers about *means* and
 * this file only carries *ends*: what the game is, whether it is flat or solid,
 * and what its world, look, sessions, and economy are supposed to do. The
 * planner turns that into means, and records why it chose them.
 *
 * It is versioned because it crosses two boundaries — a config file somebody
 * wrote last month, and the JSONL engine protocol — and a shape that crosses a
 * boundary without a version number becomes impossible to change later.
 */

export const MMO_INTENT_VERSION = 1 as const

/** Enough room for a paragraph per goal, and short of a pasted design document. */
export const MAX_INTENT_NAME_LENGTH = 200
export const MAX_INTENT_GOAL_LENGTH = 2000

export const MMO_DIMENSIONS = ['2d', '3d', 'auto'] as const
export type MmoDimension = (typeof MMO_DIMENSIONS)[number]

/** The five goal fields, in the order they are asked and rendered. */
export const INTENT_GOAL_FIELDS = ['gameplay', 'world', 'art', 'network', 'economy'] as const
export type IntentGoalField = (typeof INTENT_GOAL_FIELDS)[number]

export interface MmoIntent {
  readonly intentVersion: typeof MMO_INTENT_VERSION
  /** The project title, as typed. The slug is derived from it elsewhere. */
  readonly name: string
  readonly dimension: MmoDimension
  /** Required. The one goal a plan cannot be invented without. */
  readonly gameplay: string
  /** Optional. An empty string means "the planner decides, and says so". */
  readonly world: string
  readonly art: string
  readonly network: string
  readonly economy: string
}

/** Untrusted intent, from a config file, a flag, or a protocol line. */
export interface MmoIntentInput {
  readonly intentVersion?: unknown
  readonly name?: unknown
  readonly dimension?: unknown
  readonly gameplay?: unknown
  readonly world?: unknown
  readonly art?: unknown
  readonly network?: unknown
  readonly economy?: unknown
}

export type IntentErrorCode =
  | 'invalid_intent'
  | 'unsupported_intent_version'
  | 'invalid_name'
  | 'invalid_dimension'
  | 'missing_gameplay'
  | 'intent_too_long'

export class IntentError extends Error {
  override readonly name = 'IntentError'

  constructor(
    readonly code: IntentErrorCode,
    message: string,
    readonly details: Readonly<{ field?: string }> = {},
  ) {
    super(message)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whitespace is normalised rather than preserved. A goal reaches a model as one
 * paragraph in a system instruction, so a stray run of newlines out of a
 * heredoc is noise there, and collapsing it keeps the byte bounds honest.
 */
function collapsed(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function goal(value: unknown, field: IntentGoalField): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') {
    throw new IntentError('invalid_intent', 'Intent goal must be text.', { field })
  }
  const text = collapsed(value)
  if (text.length > MAX_INTENT_GOAL_LENGTH) {
    throw new IntentError('intent_too_long', 'Intent goal is longer than the supported limit.', { field })
  }
  return text
}

export function dimensionNamed(value: unknown): MmoDimension {
  if (value === undefined || value === null || value === '') return 'auto'
  if (typeof value !== 'string') {
    throw new IntentError('invalid_dimension', 'Dimension must be 2d, 3d, or auto.', { field: 'dimension' })
  }
  const wanted = value.trim().toLowerCase()
  const known = MMO_DIMENSIONS.find((dimension) => dimension === wanted)
  if (!known) {
    throw new IntentError('invalid_dimension', 'Dimension must be 2d, 3d, or auto.', { field: 'dimension' })
  }
  return known
}

/**
 * The one way an intent is built. Every front end — prompts, flags, agent
 * config, the JSONL protocol — comes through here, so there is one definition
 * of what a valid intent is and one place that says what is wrong with an
 * invalid one.
 */
export function parseMmoIntent(input: MmoIntentInput | unknown): MmoIntent {
  if (!isRecord(input)) {
    throw new IntentError('invalid_intent', 'Intent must be one JSON object.', { field: 'intent' })
  }
  if (input.intentVersion !== undefined && input.intentVersion !== MMO_INTENT_VERSION) {
    throw new IntentError('unsupported_intent_version', 'Intent version is not supported.', {
      field: 'intentVersion',
    })
  }

  if (typeof input.name !== 'string' || input.name.trim() === '') {
    throw new IntentError('invalid_name', 'The project needs a name.', { field: 'name' })
  }
  const name = collapsed(input.name)
  if (name.length > MAX_INTENT_NAME_LENGTH) {
    throw new IntentError('intent_too_long', 'Project name is longer than the supported limit.', {
      field: 'name',
    })
  }

  const gameplay = goal(input.gameplay, 'gameplay')
  if (gameplay === '') {
    throw new IntentError('missing_gameplay', 'The intent needs gameplay goals to plan from.', {
      field: 'gameplay',
    })
  }

  return Object.freeze({
    intentVersion: MMO_INTENT_VERSION,
    name,
    dimension: dimensionNamed(input.dimension),
    gameplay,
    world: goal(input.world, 'world'),
    art: goal(input.art, 'art'),
    network: goal(input.network, 'network'),
    economy: goal(input.economy, 'economy'),
  })
}

/** Which goals were left for the planner to answer, in field order. */
export function unspecifiedGoals(intent: MmoIntent): readonly IntentGoalField[] {
  return Object.freeze(INTENT_GOAL_FIELDS.filter((field) => intent[field] === ''))
}

/**
 * Every goal as one lowercase haystack. The planner reads signals out of this
 * rather than out of individual fields, because somebody describing an
 * isometric camera under "art" has said the same thing as somebody describing
 * it under "world".
 */
export function intentSignalText(intent: MmoIntent): string {
  return [intent.name, ...INTENT_GOAL_FIELDS.map((field) => intent[field])]
    .filter((value) => value !== '')
    .join('\n')
    .toLowerCase()
}
