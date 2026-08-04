/**
 * The plan: what the harness decided, why, and what has to be true for the
 * result to count as done.
 *
 * It is one JSON document because two audiences read it. A person reads the
 * Markdown rendering and argues with it; a model reads the JSON and acts on it,
 * and gets the same document rather than a summary of it. Everything the
 * planner concluded is in here explicitly — including the references it looked
 * at and rejected, and the capability packets it left out — because a decision
 * with its reasoning removed is indistinguishable from a guess.
 */

import type { CapabilityDomain, CapabilityMethod, DeferredCapability } from './capabilities.js'
import type { ContentWorkflow } from './content.js'
import type { MmoDimension, MmoIntent } from './intent.js'
import { INTENT_GOAL_FIELDS } from './intent.js'
import type { StyleProfile } from './style.js'

/**
 * Version 2 added the optional `content` section: the style profile, the 3D
 * content selections with their costs, the generator declarations with their
 * honest statuses, and the versioned pipeline workflows. 2D plans carry no
 * content section and are otherwise unchanged from version 1.
 */
export const MMO_PLAN_VERSION = 2 as const

/**
 * What the plan is allowed to occupy inside a system instruction. The whole
 * document always survives on disk and on the protocol; this bound is only
 * about how much of it is quoted into one provider call.
 */
export const MAX_PLAN_BRIEF_LENGTH = 28_000

export type EngineDimension = '2d' | '3d'

export interface EngineChoice {
  readonly dimension: EngineDimension
  /** What the intent asked for, which may have been `auto`. */
  readonly requested: MmoDimension
  readonly renderer: string
  readonly client: string
  readonly server: string
  readonly language: string
  readonly rationale: readonly string[]
}

export interface ReferenceConsideration {
  readonly id: string
  readonly score: number
  readonly verdict: string
}

export interface ChosenReference {
  readonly id: string
  readonly label: string
  readonly url: string
}

export interface ReferenceDecision {
  /** `scaffold` writes a fresh workspace; `clone` starts from the reference. */
  readonly strategy: 'scaffold' | 'clone'
  readonly reference?: ChosenReference
  /** Every candidate, scored, including the ones that lost. */
  readonly considered: readonly ReferenceConsideration[]
  readonly rationale: readonly string[]
}

export interface PlanConstraint {
  readonly id: string
  readonly statement: string
  readonly because: string
}

export interface AcceptanceCriterion {
  readonly id: string
  readonly statement: string
  /** How to check it: a command, or an observation somebody can make. */
  readonly check: string
}

export interface PlanStep {
  readonly order: number
  readonly id: string
  readonly title: string
  /** Capability packet ids this step draws on. */
  readonly capabilities: readonly string[]
  readonly outcome: string
}

export const CONTENT_PLAN_VERSION = 1 as const

export type ContentArea = 'props' | 'materials' | 'motion' | 'audio' | 'cutscene'

/** One content decision: what was chosen, on whose authority, and its cost. */
export interface ContentSelection {
  readonly area: ContentArea
  readonly choice: string
  /** The capability packet whose methods carry this choice out. */
  readonly capability: string
  readonly reason: string
  /** The cost of the choice, stated so it can be argued with. */
  readonly cost: string
}

/**
 * An external generator this plan is *not* promising. Each one names the
 * capability record that specifies it and repeats that record's status, so a
 * reader never has to infer what "the pipeline supports generation" means.
 */
export interface GeneratorDeclaration {
  readonly id: string
  readonly capability: string
  readonly status: 'planned' | 'absent'
  readonly reason: string
}

/** The 3D content section. Present exactly when the plan is 3D. */
export interface ContentPlan {
  readonly contentVersion: typeof CONTENT_PLAN_VERSION
  readonly style: StyleProfile
  readonly selections: readonly ContentSelection[]
  readonly generators: readonly GeneratorDeclaration[]
  readonly workflows: readonly ContentWorkflow[]
}

/** A capability packet as it appears in a plan: the packet, plus why it is here. */
export interface PlanCapability {
  readonly id: string
  readonly domain: CapabilityDomain
  readonly title: string
  readonly summary: string
  readonly reason: string
  readonly prerequisites: readonly string[]
  readonly tools: readonly string[]
  readonly methods: readonly CapabilityMethod[]
  readonly acceptance: readonly string[]
}

export interface ImplementationPlan {
  readonly planVersion: typeof MMO_PLAN_VERSION
  readonly intent: MmoIntent
  readonly engine: EngineChoice
  readonly reference: ReferenceDecision
  readonly capabilities: readonly PlanCapability[]
  /** Packets deliberately left out, with the reason. */
  readonly deferred: readonly DeferredCapability[]
  readonly constraints: readonly PlanConstraint[]
  readonly acceptance: readonly AcceptanceCriterion[]
  readonly steps: readonly PlanStep[]
  /** What was filled in for the goals nobody stated. */
  readonly assumptions: readonly string[]
  /** The 3D content pipelines. Absent on a 2D plan, by design. */
  readonly content?: ContentPlan
}

function bullets(lines: readonly string[], indent: string): string {
  return lines.map((line) => `${indent}- ${line}`).join('\n')
}

function goalLines(intent: MmoIntent): string {
  return INTENT_GOAL_FIELDS.map((field) => {
    const value = intent[field]
    const label = field[0]!.toUpperCase() + field.slice(1)
    return `  ${label}: ${value === '' ? '(not stated; see assumptions)' : value}`
  }).join('\n')
}

function referenceLine(decision: ReferenceDecision): string {
  return decision.strategy === 'clone' && decision.reference
    ? `clone ${decision.reference.id} from ${decision.reference.url}`
    : 'scaffold a fresh workspace'
}

/**
 * The plan as a person reads it. This is what lands in the project as
 * `kei-mmo/PLAN.md`, so it says everything, including the rejected options.
 */
export function renderPlanMarkdown(plan: ImplementationPlan): string {
  const sections: string[] = []

  sections.push(`# ${plan.intent.name} — implementation plan

Generated by Create Kei MMO. Plan version ${plan.planVersion}, intent version ${plan.intent.intentVersion}.
The machine-readable original is \`kei-mmo/plan.json\`; this file is a rendering of it.`)

  sections.push(`## Intent

Dimension requested: ${plan.intent.dimension}

${goalLines(plan.intent)}`)

  if (plan.assumptions.length > 0) {
    sections.push(`## Assumptions

These filled the goals that were left blank. Disagree with one and re-run with it stated.

${bullets(plan.assumptions, '')}`)
  }

  sections.push(`## Engine

- Dimension: **${plan.engine.dimension}** (requested \`${plan.engine.requested}\`)
- Renderer: ${plan.engine.renderer}
- Client: ${plan.engine.client}
- Server: ${plan.engine.server}
- Language: ${plan.engine.language}

Why:

${bullets(plan.engine.rationale, '')}`)

  sections.push(`## Starting point

Decision: **${referenceLine(plan.reference)}**

Why:

${bullets(plan.reference.rationale, '')}

Candidates considered:

${plan.reference.considered.map((entry) => `- \`${entry.id}\` (score ${entry.score}) — ${entry.verdict}`).join('\n')}`)

  if (plan.content) {
    sections.push(contentMarkdown(plan.content))
  }

  sections.push(`## Constraints

${plan.constraints.map((constraint) => `- **${constraint.statement}**\n  ${constraint.because}`).join('\n')}`)

  sections.push(`## Acceptance criteria

${plan.acceptance.map((criterion) => `- **${criterion.statement}**\n  Check: ${criterion.check}`).join('\n')}`)

  sections.push(`## Build order

${plan.steps.map((step) => `${step.order}. **${step.title}** — ${step.outcome}\n   Capabilities: ${step.capabilities.join(', ')}`).join('\n')}`)

  sections.push(`## Capability packets

${plan.capabilities.map(capabilityMarkdown).join('\n\n')}`)

  if (plan.deferred.length > 0) {
    sections.push(`## Deferred

${plan.deferred.map((entry) => `- \`${entry.id}\` — ${entry.reason}`).join('\n')}`)
  }

  return `${sections.join('\n\n')}\n`
}

function contentMarkdown(content: ContentPlan): string {
  return `## Content pipelines (3D)

Style: **${content.style.setting}**, **${content.style.finish}** finish.

${bullets(content.style.rationale, '')}

Selections, each with its cost:

${content.selections.map((selection) => `- **${selection.area}** — ${selection.choice}\n  ${selection.reason}\n  Cost: ${selection.cost}`).join('\n')}

External generators, stated honestly — none of these is promised:

${content.generators.map((generator) => `- \`${generator.id}\` (**${generator.status}**, capability \`${generator.capability}\`) — ${generator.reason}`).join('\n')}

Workflows, versioned and written into the project:

${content.workflows.map((workflow) => `- \`${workflow.id}\` v${workflow.workflowVersion} — ${workflow.title}: ${workflow.stages.map((stage) => stage.title).join(' → ')}`).join('\n')}`
}

function capabilityMarkdown(capability: PlanCapability): string {
  return `### ${capability.title} \`${capability.id}\`

${capability.summary}

_Included because:_ ${capability.reason}

**Prerequisites**

${bullets(capability.prerequisites, '')}

**Tools**

${bullets(capability.tools, '')}

**Methods**

${capability.methods.map((method) => `- \`${method.call}\`\n  ${method.does}`).join('\n')}

**Done when**

${bullets(capability.acceptance, '')}`
}

/**
 * The plan as the model receives it, inside the system instruction.
 *
 * Rendered at the fullest level that fits. If the whole thing is too long, the
 * per-method explanations go first — the call itself is the actionable part —
 * and if it is still too long, the tail is cut with a pointer to the copy on
 * disk, which is always complete.
 */
export function planBrief(plan: ImplementationPlan, maximum: number = MAX_PLAN_BRIEF_LENGTH): string {
  const full = renderPlanBrief(plan, true)
  if (full.length <= maximum) return full

  const compact = renderPlanBrief(plan, false)
  if (compact.length <= maximum) return compact

  const notice = '\n\n[Plan truncated here. The complete plan is at kei-mmo/plan.json — read it.]'
  return `${compact.slice(0, Math.max(0, maximum - notice.length))}${notice}`
}

function renderPlanBrief(plan: ImplementationPlan, explain: boolean): string {
  const parts: string[] = []

  parts.push(`${plan.intent.name} — a ${plan.engine.dimension.toUpperCase()} Kei MMORPG.

This is a harness-authored implementation plan, not a suggestion. Follow it, and
say so plainly if a step turns out to be wrong rather than quietly doing
something else.

INTENT
${goalLines(plan.intent)}`)

  if (plan.assumptions.length > 0) {
    parts.push(`ASSUMPTIONS (filled in for goals that were left blank)\n${bullets(plan.assumptions, '  ')}`)
  }

  parts.push(`ENGINE
  Dimension: ${plan.engine.dimension} (requested: ${plan.engine.requested})
  Renderer: ${plan.engine.renderer}
  Client: ${plan.engine.client}
  Server: ${plan.engine.server}
  Language: ${plan.engine.language}
${bullets(plan.engine.rationale, '  ')}`)

  parts.push(`STARTING POINT
  ${referenceLine(plan.reference)}
${bullets(plan.reference.rationale, '  ')}`)

  if (plan.content) {
    parts.push(`CONTENT — the 3D pipelines
  Style: ${plan.content.style.setting}, ${plan.content.style.finish} finish
${bullets(plan.content.style.rationale, '  ')}
  Selections:
${plan.content.selections.map((selection) => `    - ${selection.area}: ${selection.choice} — cost: ${selection.cost}`).join('\n')}
  External generators — declared, not promised:
${plan.content.generators.map((generator) => `    - ${generator.id}: ${generator.status}`).join('\n')}
  The content manifest is at kei-mmo/content/manifest.json and the pipeline
  records at kei-mmo/content/pipelines.json. Assembled cut-scenes live in
  kei-mmo/content/cutscenes/. Reference only admitted assets and ready clips;
  the project's own check is \`node kei-mmo/content/check.mjs\`.`)
  }

  parts.push(`CONSTRAINTS — these are not negotiable
${plan.constraints.map((constraint) => `  - ${constraint.statement}\n    (${constraint.because})`).join('\n')}`)

  parts.push(`ACCEPTANCE CRITERIA — the work is done when all of these hold
${plan.acceptance.map((criterion) => `  - ${criterion.statement}\n    check: ${criterion.check}`).join('\n')}`)

  parts.push(`BUILD ORDER
${plan.steps.map((step) => `  ${step.order}. ${step.title} — ${step.outcome}\n     capabilities: ${step.capabilities.join(', ')}`).join('\n')}`)

  parts.push(`CAPABILITY PACKETS
Each packet names what must exist first, which tools do the work, and the exact
calls that do it. Prefer these calls over inventing an API.

${plan.capabilities.map((capability) => capabilityBrief(capability, explain)).join('\n\n')}`)

  if (plan.deferred.length > 0) {
    parts.push(`DEFERRED — out of scope for this plan
${plan.deferred.map((entry) => `  - ${entry.id}: ${entry.reason}`).join('\n')}`)
  }

  return parts.join('\n\n')
}

function capabilityBrief(capability: PlanCapability, explain: boolean): string {
  const methods = capability.methods
    .map((method) => (explain ? `    ${method.call}\n      → ${method.does}` : `    ${method.call}`))
    .join('\n')

  return `[${capability.id}] ${capability.title}
  ${capability.summary}
  prerequisites:
${bullets(capability.prerequisites, '    ')}
  tools:
${bullets(capability.tools, '    ')}
  methods:
${methods}
  done when:
${bullets(capability.acceptance, '    ')}`
}

/**
 * The plan at a glance, for the terminal. It is deliberately short: the point
 * is that somebody can see what was decided without reading the document, and
 * go and read the document when they disagree.
 */
export function planSummary(plan: ImplementationPlan): string {
  const lines = [
    `${plan.intent.name} — a ${plan.engine.dimension.toUpperCase()} Kei MMORPG`,
    '',
    `  Engine       ${plan.engine.renderer}`,
    ...plan.engine.rationale.map((reason) => `               ${reason}`),
    '',
    `  Start from   ${referenceLine(plan.reference)}`,
    ...plan.reference.rationale.map((reason) => `               ${reason}`),
    ...(plan.content
      ? [
          '',
          `  Style        ${plan.content.style.setting}, ${plan.content.style.finish} finish`,
          `  Content      ${plan.content.selections.map((selection) => selection.choice).join(', ')}`,
          `               Generators: ${plan.content.generators.map((generator) => `${generator.id} (${generator.status})`).join(', ')}`,
        ]
      : []),
    '',
    `  Capabilities ${plan.capabilities.length} selected${plan.deferred.length > 0 ? `, ${plan.deferred.length} deferred` : ''}`,
    `               ${plan.capabilities.map((capability) => capability.id).join(', ')}`,
    `  Build order  ${plan.steps.length} steps, starting with "${plan.steps[0]?.title ?? 'nothing'}"`,
    `  Constraints  ${plan.constraints.length}`,
    `  Acceptance   ${plan.acceptance.length} criteria`,
  ]
  if (plan.assumptions.length > 0) {
    lines.push('', '  Assumed, because the goal was left blank:')
    lines.push(...plan.assumptions.map((assumption) => `    - ${assumption}`))
  }
  return lines.join('\n')
}

/** The plan as a project file, stable enough to diff between runs. */
export function planJson(plan: ImplementationPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`
}
