/**
 * The projects the harness may decide to start from, and what each one is
 * actually evidence of.
 *
 * Nobody is asked to pick from this list. It exists so the planner can weigh
 * "this has already been built once, in this shape" against "a clean start is
 * cheaper than deleting somebody else's game", and then say which it chose and
 * why. A reference is a body of working code, not a template with the name
 * filed off, so the case for cloning one has to be that the intent really does
 * land on top of it.
 */

export interface ReferenceProject {
  /** Stable id, and the directory name the reference is known by. */
  readonly id: string
  readonly label: string
  readonly summary: string
  /** Cloned over HTTPS. Nothing is packaged with this harness. */
  readonly url: string
  /** The dimension it is built for, or `any` when it is not about rendering. */
  readonly dimension: '2d' | '3d' | 'any'
  /** What a reader would find already working in it. */
  readonly demonstrates: readonly string[]
  /** Lowercase intent substrings that argue for starting here. */
  readonly signals: readonly string[]
  /** Why it can be the wrong start, stated so the planner can quote it. */
  readonly caveats: readonly string[]
}

export const REFERENCE_PROJECTS: readonly ReferenceProject[] = Object.freeze([
  {
    id: 'button',
    label: 'Button',
    summary: 'One button, one currency, one item. The small one, and the one to read first.',
    url: 'https://github.com/keicoin-org/button.git',
    dimension: 'any',
    demonstrates: ['the smallest end-to-end Kei loop', 'one currency and one item, settled'],
    signals: ['minimal', 'smallest', 'tutorial', 'learn', 'prototype', 'proof of concept', 'single button'],
    caveats: [
      'It has no world, no sessions, and no server authority, so an MMO keeps almost none of it.',
    ],
  },
  {
    id: 'world-of-wonder',
    label: 'World of Wonder',
    summary: 'A multiplayer 3D RPG whose gold and items are on the chain.',
    url: 'https://github.com/keicoin-org/world-of-wonder.git',
    dimension: '3d',
    demonstrates: [
      'a 3D client with a shared, persistent world',
      'multiplayer sessions with a server that owns the simulation',
      'currency and items that settle on the chain rather than in a save file',
    ],
    signals: [
      'mmorpg', 'mmo', 'rpg', 'quest', 'class', 'guild', 'raid', 'dungeon', 'loot',
      'open world', 'party', 'level', 'adventure', 'fantasy',
    ],
    caveats: [
      'It brings its own art direction and world structure; a project that wants a different look starts by removing things.',
    ],
  },
  {
    id: 'carpet-markets',
    label: 'Carpet Markets',
    summary: 'A coin launchpad where whether a coin can be rugged is a policy the chain enforces.',
    url: 'https://github.com/keicoin-org/carpet-markets.git',
    dimension: 'any',
    demonstrates: [
      'currency issuance with policy enforced outside the game client',
      'a market and order flow that survives adversarial players',
    ],
    signals: ['market', 'trading', 'auction house', 'launchpad', 'issuance', 'token', 'exchange', 'brokerage'],
    caveats: [
      'It is an economy first and a game second; it contributes no rendering, sessions, or world.',
    ],
  },
] as const)

export type ReferenceId = 'button' | 'world-of-wonder' | 'carpet-markets'

/** Accepts the id and the human label, because both get typed and stored. */
export function referenceNamed(name: string): ReferenceProject | undefined {
  const wanted = name.trim().toLowerCase()
  return REFERENCE_PROJECTS.find(
    (reference) => reference.id === wanted || reference.label.toLowerCase() === wanted,
  )
}
