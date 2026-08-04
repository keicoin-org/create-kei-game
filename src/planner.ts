/**
 * The decisions, made once and written down.
 *
 * This is the file that replaced the question "which template do you want?".
 * Nobody is asked, because the answer is derivable and the person asking has
 * usually not read the three candidates. What is owed to them instead is the
 * reasoning: every rejected reference keeps its score, every inferred dimension
 * keeps the signals that inferred it, and every goal nobody stated keeps the
 * assumption that filled it.
 *
 * Everything here is pure and deterministic. The same intent produces the same
 * plan, byte for byte, on any machine — which is what makes a plan something
 * two people can argue about rather than something that happened once.
 */

import {
  selectCapabilities,
  type CapabilityPacket,
  type SelectedCapability,
} from './capabilities.js'
import {
  intentSignalText,
  unspecifiedGoals,
  type MmoIntent,
} from './intent.js'
import {
  MMO_PLAN_VERSION,
  type AcceptanceCriterion,
  type EngineChoice,
  type EngineDimension,
  type ImplementationPlan,
  type PlanCapability,
  type PlanConstraint,
  type PlanStep,
  type ReferenceConsideration,
  type ReferenceDecision,
} from './plan.js'
import { REFERENCE_PROJECTS, type ReferenceProject } from './references.js'
import type { SourceSelection } from './source.js'

/** Flat-world words. An intent that uses these is not describing a 3D camera. */
const TWO_D_SIGNALS = [
  '2d', '2-d', 'two-dimensional', 'pixel', 'sprite', 'isometric', 'top-down', 'top down',
  'side-scroll', 'sidescroll', 'platformer', 'tilemap', 'tile map', '8-bit', '16-bit', 'bitmap',
]

const THREE_D_SIGNALS = [
  '3d', '3-d', 'three-dimensional', 'first-person', 'first person', 'third-person', 'third person',
  'voxel', 'open world', 'low-poly', 'low poly', 'pbr', 'mesh', 'skeletal', 'terrain', 'flight',
]

/** A reference has to clear this before cloning beats starting clean. */
export const CLONE_SCORE_THRESHOLD = 5
/** And it has to beat the runner-up by this much, or the choice is a coin toss. */
export const CLONE_SCORE_MARGIN = 2
const MAX_SIGNAL_POINTS = 5

function matched(haystack: string, signals: readonly string[]): readonly string[] {
  return signals.filter((signal) => haystack.includes(signal))
}

export interface DimensionDecision {
  readonly dimension: EngineDimension
  readonly rationale: readonly string[]
}

/**
 * `2d` and `3d` are taken at their word. `auto` counts signals in every goal at
 * once, and when the intent leans neither way it lands on 3D — a persistent
 * world with avatars in it is the shape most people mean by MMORPG, and the
 * plan says that is what happened rather than hiding it.
 */
export function resolveDimension(intent: MmoIntent): DimensionDecision {
  if (intent.dimension !== 'auto') {
    return Object.freeze({
      dimension: intent.dimension,
      rationale: Object.freeze([`The intent asked for ${intent.dimension} directly.`]),
    })
  }

  const haystack = intentSignalText(intent)
  const flat = matched(haystack, TWO_D_SIGNALS)
  const solid = matched(haystack, THREE_D_SIGNALS)
  const rationale = [
    'The intent left the dimension to the harness, so it was inferred from the goals.',
    flat.length === 0 ? 'No 2D signal appeared.' : `2D signals: ${flat.join(', ')}.`,
    solid.length === 0 ? 'No 3D signal appeared.' : `3D signals: ${solid.join(', ')}.`,
  ]

  if (flat.length > solid.length) {
    rationale.push('More of the intent describes a flat world, so this plan is 2D.')
    return Object.freeze({ dimension: '2d', rationale: Object.freeze(rationale) })
  }
  rationale.push(
    solid.length > flat.length
      ? 'More of the intent describes a solid world, so this plan is 3D.'
      : 'Neither reading won, and a persistent world with avatars in it defaults to 3D. Pass 2d if that is wrong.',
  )
  return Object.freeze({ dimension: '3d', rationale: Object.freeze(rationale) })
}

function engineFor(intent: MmoIntent, decision: DimensionDecision): EngineChoice {
  const solid = decision.dimension === '3d'
  return Object.freeze({
    dimension: decision.dimension,
    requested: intent.dimension,
    renderer: solid
      ? 'three.js over WebGL2, with instanced draws for crowds'
      : 'Canvas2D over one texture atlas, with a WebGL2 instanced path when the crowd outgrows it',
    client: 'A static browser bundle that owns the canvas and predicts the simulation',
    server: 'One authoritative process per shard, running the same fixed-step simulation over WebSockets',
    language: 'TypeScript, with the simulation in a shared module both sides import',
    rationale: Object.freeze([
      ...decision.rationale,
      solid
        ? 'three.js is chosen over raw WebGL because scene graph, glTF loading, and skinning are the parts an MMO cannot skip and should not rewrite.'
        : 'Canvas2D is chosen first because it is enough for tiles and sprites, and the WebGL2 path is named so the escalation is planned rather than a rewrite.',
      'Client and server share one step() so prediction and authority cannot drift apart.',
    ]),
  })
}

interface ScoredReference {
  readonly reference: ReferenceProject
  readonly score: number
  readonly verdict: string
}

function scoreReference(
  reference: ReferenceProject,
  dimension: EngineDimension,
  haystack: string,
): ScoredReference {
  const notes: string[] = []
  let score = 0

  if (reference.dimension !== 'any') {
    if (reference.dimension === dimension) {
      score += 3
      notes.push(`built for ${dimension.toUpperCase()}`)
    } else {
      score -= 4
      notes.push(`built for ${reference.dimension.toUpperCase()}, and this plan is ${dimension.toUpperCase()}`)
    }
  }

  const hits = matched(haystack, reference.signals)
  if (hits.length > 0) {
    score += Math.min(hits.length, MAX_SIGNAL_POINTS)
    notes.push(`matches on ${hits.join(', ')}`)
  } else {
    notes.push('nothing in the intent matches what it demonstrates')
  }

  return Object.freeze({ reference, score, verdict: notes.join('; ') })
}

/**
 * Whether to start from somebody else's working code. The bar is deliberately
 * high in both directions: a clone that does not fit is a deletion exercise,
 * and a fresh start that ignores a project already built in this exact shape is
 * a waste. The margin rule exists so that two close candidates produce a clean
 * start rather than an arbitrary winner.
 */
export function chooseReference(intent: MmoIntent, dimension: EngineDimension): ReferenceDecision {
  const haystack = intentSignalText(intent)
  const scored = REFERENCE_PROJECTS.map((reference) => scoreReference(reference, dimension, haystack))
  const ranked = [...scored].sort((left, right) =>
    right.score - left.score || left.reference.id.localeCompare(right.reference.id),
  )
  const considered: readonly ReferenceConsideration[] = Object.freeze(
    ranked.map((entry) => Object.freeze({
      id: entry.reference.id,
      score: entry.score,
      verdict: entry.verdict,
    })),
  )

  const best = ranked[0]
  const runnerUp = ranked[1]
  const margin = best && runnerUp ? best.score - runnerUp.score : Number.POSITIVE_INFINITY

  if (!best || best.score < CLONE_SCORE_THRESHOLD) {
    return Object.freeze({
      strategy: 'scaffold',
      considered,
      rationale: Object.freeze([
        `No reference scored the ${CLONE_SCORE_THRESHOLD} it takes to be worth starting from.`,
        best
          ? `The closest was ${best.reference.id} at ${best.score}: ${best.verdict}.`
          : 'There are no reference projects to consider.',
        'A fresh workspace is planned instead: nothing to delete, and the plan below is the whole opinion.',
      ]),
    })
  }
  if (margin < CLONE_SCORE_MARGIN) {
    return Object.freeze({
      strategy: 'scaffold',
      considered,
      rationale: Object.freeze([
        `${best.reference.id} (${best.score}) and ${runnerUp!.reference.id} (${runnerUp!.score}) scored within ${CLONE_SCORE_MARGIN} of each other.`,
        'When two references fit about equally, neither fits well enough to inherit, so a fresh workspace is planned.',
      ]),
    })
  }

  return Object.freeze({
    strategy: 'clone',
    reference: Object.freeze({
      id: best.reference.id,
      label: best.reference.label,
      url: best.reference.url,
    }),
    considered,
    rationale: Object.freeze([
      `${best.reference.id} scored ${best.score}, clear of the runner-up by ${margin}: ${best.verdict}.`,
      `It already demonstrates ${best.reference.demonstrates.join(', ')}.`,
      ...best.reference.caveats.map((caveat) => `Known cost of starting here: ${caveat}`),
      'The plan below applies on top of it, not instead of it: read what is there before changing it.',
    ]),
  })
}

const ASSUMPTIONS: Readonly<Record<string, string>> = Object.freeze({
  world:
    'World goals were not stated. Planned for one persistent shard streamed in chunks around each player, with eviction, because that is the smallest world shape that survives more than a handful of players.',
  art:
    'Art direction was not stated. Planned for one coherent material and atlas set with no full-screen effect chain, so the look stays cheap until somebody asks for something specific.',
  network:
    'Session goals were not stated. Planned for one authoritative server per shard at a fixed tick, client prediction with server reconciliation, and interest management by grid cell.',
  economy:
    'Economy goals were not stated. Planned for a single Kei currency with server-side settlement and the ledger boundary in place, so adding a second currency later is a row rather than a refactor.',
})

function assumptionsFor(intent: MmoIntent): readonly string[] {
  const assumptions = unspecifiedGoals(intent)
    .map((field) => ASSUMPTIONS[field])
    .filter((value): value is string => value !== undefined)
  if (intent.dimension === 'auto') {
    assumptions.unshift('The dimension was left to the harness; the engine rationale records what it read to decide.')
  }
  return Object.freeze(assumptions)
}

function constraintsFor(dimension: EngineDimension): readonly PlanConstraint[] {
  const shared: PlanConstraint[] = [
    {
      id: 'server-authority',
      statement: 'The server owns movement, combat, loot, and every economic action. A client sends intent and never a result.',
      because: 'A client that can author one result can author any result, and an MMO economy is the thing people attack first.',
    },
    {
      id: 'deterministic-simulation',
      statement: 'The simulation is one pure fixed-step step() shared by client and server. Rendering reads it and never writes it.',
      because: 'Prediction, reconciliation, and every replay test are impossible without it, and retrofitting it means rewriting both sides.',
    },
    {
      id: 'no-credentials-in-project',
      statement: 'No API key, seed, endpoint secret, or token is written into a project file. Configuration is by environment-variable name.',
      because: 'The harness keeps credentials in its own environment and refuses to write them out; the project must not undo that from the inside.',
    },
    {
      id: 'workspace-only',
      statement: 'Every file written stays inside the project workspace.',
      because: 'The harness tools refuse anything else, so a plan that assumes otherwise burns rounds on refusals.',
    },
    {
      id: 'bounded-files',
      statement: 'No single write exceeds 64 KiB. Split a module rather than growing one.',
      because: 'That is the harness write limit, and an oversized write is refused whole.',
    },
    {
      id: 'no-harness-runtime-dependency',
      statement: 'The finished game does not import this harness at runtime.',
      because: 'This is a starting harness, not a framework the project has to keep carrying.',
    },
    {
      id: 'assets-by-reference',
      statement: 'Binary assets are referenced from a manifest, never inlined as base64 in source.',
      because: 'A text tool cannot author a mesh, and an inlined one is a file no artist can open again.',
    },
    {
      id: 'integer-money',
      statement: 'Economic amounts are integers in the smallest unit, held as bigint.',
      because: 'Floating-point money creates and destroys value at the decimal, and an MMO will find it.',
    },
  ]

  shared.push(
    dimension === '3d'
      ? {
          id: 'draw-call-budget',
          statement: 'Draw calls and skinned mesh counts carry a written budget, checked in a test.',
          because: 'The load case is a crowd, and a scene that is fine alone is not fine with sixty players in it.',
        }
      : {
          id: 'atlas-and-culling',
          statement: 'Sprites come from one atlas and the draw loop is culled to the visible rectangle.',
          because: 'Per-sprite images and a whole-map loop are the two ways a 2D MMO stops being cheap to run.',
        },
  )

  return Object.freeze(shared.map((constraint) => Object.freeze(constraint)))
}

function acceptanceFor(dimension: EngineDimension): readonly AcceptanceCriterion[] {
  return Object.freeze([
    {
      id: 'boots',
      statement: 'The client boots to a rendered frame with an empty console.',
      check: 'Serve the client and open it.',
    },
    {
      id: 'two-clients-agree',
      statement: 'Two clients in one session see each other move inside the latency budget.',
      check: 'Run the server and open two browser windows against it.',
    },
    {
      id: 'authority-holds',
      statement: 'A forged client message cannot move another player, mint an item, or change a balance.',
      check: 'The authority tests, which send messages a well-behaved client would never send.',
    },
    {
      id: 'state-survives-restart',
      statement: 'Restarting the server restores character position and inventory.',
      check: 'Stop the server, start it again, and log back in.',
    },
    {
      id: 'supply-balances',
      statement: 'Minted minus burned equals the sum of every balance.',
      check: 'The ledger invariant test, over randomized operations.',
    },
    {
      id: 'offline-tests',
      statement: 'The whole test suite passes offline, with no credentials set.',
      check: 'bun test, with the network unplugged.',
    },
    {
      id: 'no-secrets-committed',
      statement: 'No credential value appears in the repository or the build output.',
      check: 'Search the tree and the built bundle for the values you actually set.',
    },
    dimension === '3d'
      ? {
          id: 'frame-budget-3d',
          statement: 'The frame budget holds with the target crowd on screen.',
          check: 'A draw-call assertion against renderer.info.render.calls, plus a frame timer under load.',
        }
      : {
          id: 'frame-budget-2d',
          statement: 'The frame budget holds with the target number of visible sprites.',
          check: 'A frame timer with the camera over the densest part of the map.',
        },
  ].map((criterion) => Object.freeze(criterion)))
}

interface StepTemplate {
  readonly id: string
  readonly title: string
  readonly outcome: string
  readonly capabilities: readonly string[]
}

function stepTemplates(dimension: EngineDimension): readonly StepTemplate[] {
  const render = dimension === '3d' ? 'render-3d' : 'render-2d'
  const animate = dimension === '3d' ? 'animation-3d' : 'animation-2d'

  return [
    {
      id: 'workspace',
      title: 'Project shape',
      outcome: 'Client, server, and shared code separated, with the shared step() and the wire schema stubbed and imported by both sides.',
      capabilities: ['testing'],
    },
    {
      id: 'first-frame',
      title: 'First frame',
      outcome: 'The client boots, loads its first assets through the manifest, and draws a world that is visibly there.',
      capabilities: [render, 'content-pipeline'],
    },
    {
      id: 'player-control',
      title: 'A player you can move',
      outcome: 'Local input drives one avatar through the shared step(), with the camera and the first HUD reading the same state.',
      capabilities: [render, 'ui-hud', animate],
    },
    {
      id: 'authoritative-server',
      title: 'Authoritative server',
      outcome: 'The server runs the fixed tick, accepts validated input, and is the only thing that decides where anybody is.',
      capabilities: ['network-authority', 'testing'],
    },
    {
      id: 'replication',
      title: 'Replication and prediction',
      outcome: 'Snapshots and deltas go down, predictions reconcile against them, and two clients agree about a third.',
      capabilities: ['network-authority'],
    },
    {
      id: 'world-persistence',
      title: 'A world that stays',
      outcome: 'Chunks stream around players and character state survives a restart.',
      capabilities: ['persistence-streaming'],
    },
    {
      id: 'economy',
      title: 'Kei economy',
      outcome: 'The ledger boundary exists, trades settle in two phases, and supply can be proved.',
      capabilities: ['economy-kei'],
    },
    {
      id: 'look-and-feel',
      title: 'Look and feel',
      outcome: 'Animation states, custom materials, and any full-screen chain, each with its cost measured.',
      capabilities: [animate, 'shaders', 'post-processing'],
    },
    {
      id: 'interface-and-content',
      title: 'Interface, audio, and content',
      outcome: 'The full HUD, the audio graph, and the asset manifest the game actually ships with.',
      capabilities: ['ui-hud', 'audio', 'content-pipeline'],
    },
    {
      id: 'harden-and-ship',
      title: 'Harden and ship',
      outcome: 'Authority and ledger tests, budgets asserted, a clean build, and a shard that shuts down without losing a transaction.',
      capabilities: ['testing', 'deployment'],
    },
  ]
}

function stepsFor(dimension: EngineDimension, present: ReadonlySet<string>): readonly PlanStep[] {
  const steps: PlanStep[] = []
  for (const template of stepTemplates(dimension)) {
    const capabilities = template.capabilities.filter((id) => present.has(id))
    // A step whose whole point was a packet this plan does not include is not a
    // step; leaving it in would ask for work the plan deliberately deferred.
    if (capabilities.length === 0) continue
    steps.push(Object.freeze({
      order: steps.length + 1,
      id: template.id,
      title: template.title,
      capabilities: Object.freeze(capabilities),
      outcome: template.outcome,
    }))
  }
  return Object.freeze(steps)
}

function planCapability({ packet, reason }: SelectedCapability): PlanCapability {
  const source: CapabilityPacket = packet
  return Object.freeze({
    id: source.id,
    domain: source.domain,
    title: source.title,
    summary: source.summary,
    reason,
    prerequisites: source.prerequisites,
    tools: source.tools,
    methods: source.methods,
    acceptance: source.acceptance,
  })
}

/**
 * What the reference decision means for the disk. The source layer still has
 * four kinds, but only two of them are reachable now, because the other two
 * were answers to a question nobody is asked any more.
 */
export function selectionForPlan(plan: ImplementationPlan): SourceSelection {
  const chosen = plan.reference
  return chosen.strategy === 'clone' && chosen.reference
    ? { kind: 'template', template: chosen.reference.id }
    : { kind: 'blank' }
}

/** Intent in, plan out. The only function in the harness that decides anything. */
export function planMmo(intent: MmoIntent): ImplementationPlan {
  const dimension = resolveDimension(intent)
  const engine = engineFor(intent, dimension)
  const reference = chooseReference(intent, dimension.dimension)
  const selection = selectCapabilities(dimension.dimension, intentSignalText(intent))
  const capabilities = Object.freeze(selection.selected.map(planCapability))
  const present = new Set(capabilities.map((capability) => capability.id))

  return Object.freeze({
    planVersion: MMO_PLAN_VERSION,
    intent,
    engine,
    reference,
    capabilities,
    deferred: selection.deferred,
    constraints: constraintsFor(dimension.dimension),
    acceptance: acceptanceFor(dimension.dimension),
    steps: stepsFor(dimension.dimension, present),
    assumptions: assumptionsFor(intent),
  })
}
