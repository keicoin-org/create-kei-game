/**
 * The decisions the planner makes on somebody's behalf, and — the part that
 * matters more — the reasons it keeps for making them.
 */

import { describe, expect, test } from 'bun:test'

import { parseMmoIntent } from '../src/intent.js'
import { MMO_PLAN_VERSION } from '../src/plan.js'
import {
  CLONE_SCORE_MARGIN,
  CLONE_SCORE_THRESHOLD,
  chooseReference,
  planMmo,
  resolveDimension,
  selectionForPlan,
} from '../src/planner.js'
import { REFERENCE_PROJECTS } from '../src/references.js'
import { CLONE_INTENT, SCAFFOLD_INTENT, planFor } from './fixtures.js'

describe('the dimension decision', () => {
  test('a stated dimension is taken at its word and says so', () => {
    for (const dimension of ['2d', '3d'] as const) {
      const decision = resolveDimension(parseMmoIntent({ name: 'g', gameplay: 'x', dimension }))
      expect(decision.dimension).toBe(dimension)
      expect(decision.rationale.join(' ')).toContain(`asked for ${dimension}`)
    }
  })

  test('auto reads flat signals out of any goal, not only the art one', () => {
    const fromArt = resolveDimension(
      parseMmoIntent({ name: 'g', gameplay: 'Questing', art: 'Isometric pixel sprites' }),
    )
    const fromWorld = resolveDimension(
      parseMmoIntent({ name: 'g', gameplay: 'Questing', world: 'A top-down tilemap of towns' }),
    )
    expect(fromArt.dimension).toBe('2d')
    expect(fromWorld.dimension).toBe('2d')
    expect(fromArt.rationale.join(' ')).toContain('2D signals')
  })

  test('auto reads solid signals the same way', () => {
    const decision = resolveDimension(
      parseMmoIntent({ name: 'g', gameplay: 'Third-person combat across open world terrain' }),
    )
    expect(decision.dimension).toBe('3d')
    expect(decision.rationale.join(' ')).toContain('3D signals')
  })

  test('a tie lands on 3D and admits that is what happened', () => {
    const decision = resolveDimension(parseMmoIntent({ name: 'g', gameplay: 'Players trade and talk.' }))
    expect(decision.dimension).toBe('3d')
    expect(decision.rationale.join(' ')).toContain('Neither reading won')
    expect(decision.rationale.join(' ')).toContain('Pass 2d if that is wrong')
  })
})

describe('the reference decision', () => {
  test('scores every candidate, including the ones that lose', () => {
    const decision = chooseReference(parseMmoIntent(CLONE_INTENT), '3d')
    expect(decision.considered.map(({ id }) => id).sort()).toEqual(
      REFERENCE_PROJECTS.map(({ id }) => id).sort(),
    )
    for (const entry of decision.considered) expect(entry.verdict).not.toBe('')
  })

  test('clones the reference an intent lands on top of, and says why', () => {
    const decision = chooseReference(parseMmoIntent(CLONE_INTENT), '3d')
    expect(decision.strategy).toBe('clone')
    expect(decision.reference?.id).toBe('world-of-wonder')
    expect(decision.reference?.url).toBe('https://github.com/keicoin-org/world-of-wonder.git')
    const why = decision.rationale.join(' ')
    expect(why).toContain('mmorpg')
    expect(why).toContain('Known cost of starting here')
  })

  test('scaffolds when nothing scores well enough, and names the closest miss', () => {
    const decision = chooseReference(parseMmoIntent(SCAFFOLD_INTENT), '3d')
    expect(decision.strategy).toBe('scaffold')
    expect(decision.reference).toBeUndefined()
    expect(decision.rationale.join(' ')).toContain(`scored the ${CLONE_SCORE_THRESHOLD}`)
    expect(decision.rationale.join(' ')).toContain('The closest was world-of-wonder')
  })

  test('a 3D-only reference is scored against, never for, a 2D plan', () => {
    const decision = chooseReference(parseMmoIntent(CLONE_INTENT), '2d')
    expect(decision.strategy).toBe('scaffold')
    const wonder = decision.considered.find(({ id }) => id === 'world-of-wonder')!
    expect(wonder.score).toBeLessThan(CLONE_SCORE_THRESHOLD)
    expect(wonder.verdict).toContain('this plan is 2D')
  })

  test('an economy-shaped intent reaches the economy reference instead', () => {
    const plan = planFor({
      name: 'Bazaar',
      gameplay: 'Trading is the game: an auction house, a launchpad, and a token exchange.',
      economy: 'Player-run market making.',
    })
    expect(plan.reference.reference?.id).toBe('carpet-markets')
  })

  test('two close candidates produce a clean start rather than an arbitrary winner', () => {
    expect(CLONE_SCORE_MARGIN).toBeGreaterThan(0)
    const plan = planFor({
      name: 'Both',
      dimension: '3d',
      gameplay: 'An mmorpg with quests and loot',
      economy: 'An auction house, a launchpad, a token exchange, and market trading',
    })
    const [best, runnerUp] = plan.reference.considered
    if (best!.score - runnerUp!.score < CLONE_SCORE_MARGIN) {
      expect(plan.reference.strategy).toBe('scaffold')
      expect(plan.reference.rationale.join(' ')).toContain('scored within')
    } else {
      expect(plan.reference.strategy).toBe('clone')
    }
  })
})

describe('the plan', () => {
  const semanticDecisions = (plan: ReturnType<typeof planMmo>) => ({
    engine: plan.engine,
    reference: plan.reference,
    capabilities: plan.capabilities,
    deferred: plan.deferred,
    constraints: plan.constraints,
    acceptance: plan.acceptance,
    steps: plan.steps,
    assumptions: plan.assumptions,
    content: plan.content,
  })

  test('project display names never steer semantic planning', () => {
    const names = ['Ledger', 'Pixel Ledger', 'Voice Market', 'Space Guild']
    const plans = names.map((name) => planFor({
      name,
      dimension: 'auto',
      gameplay: 'Players manage records and trade together.',
    }))
    for (const plan of plans.slice(1)) {
      expect(semanticDecisions(plan)).toEqual(semanticDecisions(plans[0]!))
    }
    expect(plans[0]!.engine.dimension).toBe('3d')
    expect(plans[0]!.content?.style.finish).toBe('grounded')
  })

  test('invoice and workspace do not become voice and space intent', () => {
    const plan = planFor({
      name: 'Ledger',
      dimension: 'auto',
      gameplay: 'Players manage invoices in a shared workspace and trade.',
    })
    const selected = plan.capabilities.map(({ id }) => id)
    expect(selected).not.toContain('audio')
    expect(selected).not.toContain('content-3d-audio')
    expect(plan.content?.style.setting).toBe('unspecified')
    expect(plan.content?.style.evidence.setting).toEqual([])
    expect(plan.engine.rationale.join(' ')).not.toContain('"space"')
    expect(plan.capabilities.every(({ reason }) => !reason.includes('"voice"'))).toBeTrue()
  })

  test('exact voice and space terms retain their intended behavior and source evidence', () => {
    const plan = planFor({
      name: 'Ledger',
      gameplay: 'Players coordinate by voice while exploring space.',
    })
    expect(plan.capabilities.find(({ id }) => id === 'audio')?.reason).toBe(
      'The gameplay goal mentions "voice".',
    )
    expect(plan.capabilities.map(({ id }) => id)).toContain('content-3d-audio')
    expect(plan.content?.style.setting).toBe('science-fiction')
    expect(plan.content?.style.evidence.setting).toContain('space')
    expect(plan.content?.style.rationale.join(' ')).toContain('"space" in gameplay')
  })

  test('explicit dimensions stay authoritative under adversarial names and fragments', () => {
    expect(planFor({
      name: '3D Voice Space',
      dimension: '2d',
      gameplay: 'Invoices in a workspace.',
    }).engine.dimension).toBe('2d')
    expect(planFor({
      name: '2D Pixel',
      dimension: '3d',
      gameplay: 'Invoices in a workspace.',
    }).engine.dimension).toBe('3d')
  })

  test('is deterministic: the same intent produces the same document', () => {
    expect(JSON.stringify(planFor(CLONE_INTENT))).toBe(JSON.stringify(planFor(CLONE_INTENT)))
  })

  test('carries its version, its intent, and the reasoning for both decisions', () => {
    const plan = planFor(SCAFFOLD_INTENT)
    expect(plan.planVersion).toBe(MMO_PLAN_VERSION)
    expect(plan.intent.name).toBe('Salvage Run')
    expect(plan.engine.rationale.length).toBeGreaterThan(0)
    expect(plan.reference.rationale.length).toBeGreaterThan(0)
  })

  test('records an assumption for every goal that was left blank', () => {
    const bare = planFor({ name: 'Bare', gameplay: 'Questing', dimension: '3d' })
    expect(bare.assumptions).toHaveLength(4)
    const full = planFor({
      name: 'Full',
      dimension: '3d',
      gameplay: 'Questing',
      world: 'One shard',
      art: 'Low poly',
      network: '200 a shard',
      economy: 'One currency',
    })
    expect(full.assumptions).toEqual([])
  })

  test('notes that the dimension was inferred, when it was', () => {
    expect(planFor({ name: 'Auto', gameplay: 'Questing' }).assumptions[0]).toContain('left to the harness')
  })

  test('gives 2D and 3D plans their own rendering and animation packets', () => {
    const solid = planFor({ name: 'S', dimension: '3d', gameplay: 'Questing' })
    const flat = planFor({ name: 'F', dimension: '2d', gameplay: 'Questing' })
    const ids = (plan: typeof solid) => plan.capabilities.map((capability) => capability.id)

    expect(ids(solid)).toContain('render-3d')
    expect(ids(solid)).toContain('animation-3d')
    expect(ids(solid)).not.toContain('render-2d')
    expect(ids(flat)).toContain('render-2d')
    expect(ids(flat)).toContain('animation-2d')
    expect(ids(flat)).not.toContain('render-3d')
    expect(flat.deferred.map(({ id }) => id)).toContain('render-3d')
  })

  test('every core packet is present in every plan', () => {
    const ids = planFor({ name: 'S', dimension: '3d', gameplay: 'Questing' }).capabilities.map(
      (capability) => capability.id,
    )
    for (const id of [
      'network-authority',
      'persistence-streaming',
      'economy-kei',
      'ui-hud',
      'content-pipeline',
      'testing',
      'deployment',
    ]) {
      expect(ids).toContain(id)
    }
  })

  test('an optional packet arrives only when the intent asked for it, and the miss is recorded', () => {
    const quiet = planFor({ name: 'Q', dimension: '3d', gameplay: 'Questing' })
    expect(quiet.capabilities.map(({ id }) => id)).not.toContain('audio')
    expect(quiet.deferred.find(({ id }) => id === 'audio')?.reason).toContain('Nothing in the intent')

    const loud = planFor({ name: 'L', dimension: '3d', gameplay: 'Questing', art: 'Bloom and ambient music' })
    const selected = loud.capabilities.find(({ id }) => id === 'audio')
    expect(selected?.reason).toContain('music')
    expect(loud.capabilities.map(({ id }) => id)).toContain('post-processing')
  })

  test('every step names capabilities the plan actually has', () => {
    const plan = planFor({ name: 'S', dimension: '3d', gameplay: 'Questing' })
    const present = new Set(plan.capabilities.map(({ id }) => id))
    expect(plan.steps.length).toBeGreaterThan(0)
    for (const [index, step] of plan.steps.entries()) {
      expect(step.order).toBe(index + 1)
      expect(step.capabilities.length).toBeGreaterThan(0)
      for (const id of step.capabilities) expect(present.has(id)).toBeTrue()
    }
  })

  test('constraints and acceptance criteria are dimension-aware and never empty', () => {
    const solid = planFor({ name: 'S', dimension: '3d', gameplay: 'Questing' })
    const flat = planFor({ name: 'F', dimension: '2d', gameplay: 'Questing' })
    expect(solid.constraints.map(({ id }) => id)).toContain('draw-call-budget')
    expect(flat.constraints.map(({ id }) => id)).toContain('atlas-and-culling')
    expect(solid.acceptance.map(({ id }) => id)).toContain('frame-budget-3d')
    expect(flat.acceptance.map(({ id }) => id)).toContain('frame-budget-2d')
    for (const plan of [solid, flat]) {
      for (const constraint of plan.constraints) expect(constraint.because).not.toBe('')
      for (const criterion of plan.acceptance) expect(criterion.check).not.toBe('')
    }
  })

  test('the server-authority and no-credential constraints are not optional', () => {
    for (const dimension of ['2d', '3d'] as const) {
      const ids = planFor({ name: 'x', dimension, gameplay: 'Questing' }).constraints.map(({ id }) => id)
      expect(ids).toContain('server-authority')
      expect(ids).toContain('no-credentials-in-project')
      expect(ids).toContain('deterministic-simulation')
    }
  })

  test('the disk selection follows the reference decision and nothing else', () => {
    expect(selectionForPlan(planFor(SCAFFOLD_INTENT))).toEqual({ kind: 'blank' })
    expect(selectionForPlan(planFor(CLONE_INTENT))).toEqual({
      kind: 'template',
      template: 'world-of-wonder',
    })
  })

  test('plans nothing without gameplay to plan from', () => {
    expect(() => planMmo(parseMmoIntent({ name: 'g' }))).toThrow()
  })
})

describe('the content section', () => {
  test('every 3D plan carries it; no 2D plan does', () => {
    const solid = planFor({ name: 'S', dimension: '3d', gameplay: 'Questing' })
    expect(solid.content).toBeDefined()
    expect(solid.content!.contentVersion).toBe(1)
    expect(solid.content!.workflows.length).toBe(4)

    const flat = planFor({ name: 'F', dimension: '2d', gameplay: 'Questing' })
    expect(flat.content).toBeUndefined()
  })

  test('style changes the selections: a different setting picks a different kit', () => {
    const choiceFor = (gameplay: string, area: string) =>
      planFor({ name: 'X', dimension: '3d', gameplay }).content!.selections.find(
        (selection) => selection.area === area,
      )?.choice

    const sciFi = choiceFor('Crews salvage derelict stations in orbit.', 'props')
    const historical = choiceFor('Viking crews raid a medieval coast.', 'props')
    const neutral = choiceFor('Players trade and build together.', 'props')
    expect(sciFi).toContain('kit-science-fiction')
    expect(historical).toContain('kit-historical')
    expect(neutral).toContain('kit-neutral')
    expect(new Set([sciFi, historical, neutral]).size).toBe(3)
  })

  test('the finish changes the material selection the same way', () => {
    const grounded = planFor({ name: 'X', dimension: '3d', gameplay: 'Questing' })
    const stylized = planFor({ name: 'X', dimension: '3d', gameplay: 'Questing', art: 'Cel-shaded toon look' })
    const material = (plan: typeof grounded) =>
      plan.content!.selections.find((selection) => selection.area === 'materials')!.choice
    expect(material(grounded)).toContain('PBRMaterial')
    expect(material(stylized)).toContain('StandardMaterial')
  })

  test('fantasy dressing appears only when the brief asks for fantasy', () => {
    const plain = planFor({ name: 'X', dimension: '3d', gameplay: 'Players explore and trade together.' })
    expect(plain.content!.style.setting).toBe('unspecified')
    expect(JSON.stringify(plain.content).toLowerCase()).not.toContain('fantasy-')

    const asked = planFor({ name: 'X', dimension: '3d', gameplay: 'A fantasy world of mages and dragons.' })
    expect(asked.content!.style.setting).toBe('fantasy')
    expect(asked.content!.selections.find((selection) => selection.area === 'props')!.choice).toContain('kit-fantasy')
  })

  test('every selection cites an available capability the plan actually holds, with a cost', () => {
    const plan = planFor({ name: 'X', dimension: '3d', gameplay: 'Questing with a story intro and ambient music.' })
    const present = new Set(plan.capabilities.map(({ id }) => id))
    for (const selection of plan.content!.selections) {
      expect(present.has(selection.capability)).toBeTrue()
      expect(selection.cost).not.toBe('')
      expect(selection.reason).not.toBe('')
    }
    // Audio and cut-scene selections arrived because the intent asked.
    expect(plan.content!.selections.map(({ area }) => area)).toEqual([
      'props', 'materials', 'motion', 'audio', 'cutscene',
    ])
  })

  test('a quiet intent keeps the content floor and leaves audio and cut-scenes deferred', () => {
    const plan = planFor({ name: 'X', dimension: '3d', gameplay: 'Players mine and haul.' })
    expect(plan.content!.selections.map(({ area }) => area)).toEqual(['props', 'materials', 'motion'])
    expect(plan.deferred.find(({ id }) => id === 'content-3d-cutscenes')?.reason).toContain('Nothing in the intent')
  })

  test('generators repeat the capability records: planned and absent, with reasons', () => {
    const generators = planFor({ name: 'X', dimension: '3d', gameplay: 'Questing' }).content!.generators
    const byId = new Map(generators.map((generator) => [generator.id, generator]))
    expect(byId.get('model-generation')?.status).toBe('planned')
    expect(byId.get('motion-capture')?.status).toBe('planned')
    expect(byId.get('sfx-generation')?.status).toBe('planned')
    expect(byId.get('voice-acting')?.status).toBe('absent')
    for (const generator of generators) {
      expect(generator.reason.split(' ').length).toBeGreaterThan(8)
      expect(generator.capability.startsWith('content-3d-')).toBeTrue()
    }
  })

  test('the 3D build order gains the content step and 2D never sees it', () => {
    const solid = planFor({ name: 'S', dimension: '3d', gameplay: 'Questing' })
    expect(solid.steps.map(({ id }) => id)).toContain('content-3d')
    const flat = planFor({ name: 'F', dimension: '2d', gameplay: 'Questing' })
    expect(flat.steps.map(({ id }) => id)).not.toContain('content-3d')
  })
})
