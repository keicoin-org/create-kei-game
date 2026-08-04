/**
 * Intents and plans the rest of the suite builds on.
 *
 * Two of them matter more than the others: one the planner scaffolds and one it
 * clones. Anything that touches a directory uses the scaffolding one, so no
 * test can end up wanting a network.
 */

import { parseMmoIntent, type MmoIntent, type MmoIntentInput } from '../src/intent.js'
import type { ImplementationPlan } from '../src/plan.js'
import { planMmo } from '../src/planner.js'

export function intentFor(overrides: MmoIntentInput = {}): MmoIntent {
  return parseMmoIntent({
    name: 'My MMO',
    dimension: 'auto',
    gameplay: 'Players explore, fight, and craft together.',
    ...overrides,
  })
}

export function planFor(overrides: MmoIntentInput = {}): ImplementationPlan {
  return planMmo(intentFor(overrides))
}

/** Deliberately unlike any reference project, so the planner scaffolds. */
export const SCAFFOLD_INTENT: MmoIntentInput = {
  name: 'Salvage Run',
  dimension: '3d',
  gameplay: 'Crews salvage derelict stations and haul cargo home.',
  world: 'One shard of drifting wrecks that persist between sessions.',
}

/** Squarely the shape World of Wonder already is, so the planner clones it. */
export const CLONE_INTENT: MmoIntentInput = {
  name: 'Wonderlands',
  dimension: '3d',
  gameplay: 'A fantasy MMORPG with classes, quests, dungeons, and loot.',
  economy: 'Gold and gear that settle on the chain.',
}

export const SCAFFOLD_PLAN = planFor(SCAFFOLD_INTENT)
export const CLONE_PLAN = planFor(CLONE_INTENT)
