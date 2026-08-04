import { describe, expect, test } from 'bun:test'

import { MAX_INTENT_GOAL_LENGTH } from '../src/intent.js'
import {
  MAX_PLAN_BRIEF_LENGTH,
  planBrief,
  planJson,
  planSummary,
  renderPlanMarkdown,
} from '../src/plan.js'
import { MAX_JSONL_LINE_BYTES } from '../src/runtime-protocol.js'
import { CLONE_PLAN, SCAFFOLD_PLAN, planFor } from './fixtures.js'

describe('the brief the model receives', () => {
  test('carries the decisions, the rules, and the calls', () => {
    const brief = planBrief(SCAFFOLD_PLAN)
    for (const heading of [
      'INTENT',
      'ENGINE',
      'STARTING POINT',
      'CONSTRAINTS',
      'ACCEPTANCE CRITERIA',
      'BUILD ORDER',
      'CAPABILITY PACKETS',
      'DEFERRED',
    ]) {
      expect(brief).toContain(heading)
    }
    expect(brief).toContain('prerequisites:')
    expect(brief).toContain('tools:')
    expect(brief).toContain('methods:')
    expect(brief).toContain('done when:')
    expect(brief).toContain('renderer.render(scene, camera)')
  })

  test('says which reference it is starting from, when it is', () => {
    expect(planBrief(CLONE_PLAN)).toContain('clone world-of-wonder')
    expect(planBrief(SCAFFOLD_PLAN)).toContain('scaffold a fresh workspace')
  })

  test('stays inside its bound even when every goal is at its own limit', () => {
    const long = 'word '.repeat(Math.floor(MAX_INTENT_GOAL_LENGTH / 5) - 1).trim()
    const plan = planFor({
      name: 'Maximal',
      dimension: '3d',
      gameplay: `bloom music shader ${long.slice(0, MAX_INTENT_GOAL_LENGTH - 20)}`,
      world: long,
      art: long,
      network: long,
      economy: long,
    })
    const brief = planBrief(plan)
    expect(brief.length).toBeLessThanOrEqual(MAX_PLAN_BRIEF_LENGTH)
  })

  test('drops the explanations before it drops the calls', () => {
    const compact = planBrief(SCAFFOLD_PLAN, 20_000)
    expect(compact.length).toBeLessThanOrEqual(20_000)
    expect(compact).toContain('renderer.render(scene, camera)')
    expect(compact).not.toContain('→')
  })

  test('a bound nothing fits into still points at the complete copy on disk', () => {
    const truncated = planBrief(SCAFFOLD_PLAN, 2_000)
    expect(truncated.length).toBeLessThanOrEqual(2_000)
    expect(truncated).toContain('kei-mmo/plan.json')
  })
})

describe('the plan as files', () => {
  test('the JSON round-trips and keeps every decision', () => {
    const parsed = JSON.parse(planJson(CLONE_PLAN))
    expect(parsed.planVersion).toBe(2)
    expect(parsed.intent.intentVersion).toBe(1)
    expect(parsed.reference.strategy).toBe('clone')
    expect(parsed.reference.considered).toHaveLength(3)
    expect(parsed.capabilities[0].methods[0].call).toBeString()
    expect(planJson(CLONE_PLAN).endsWith('\n')).toBeTrue()
  })

  test('serialized, it fits on one protocol line even at the largest intent', () => {
    const long = 'word '.repeat(Math.floor(MAX_INTENT_GOAL_LENGTH / 5) - 1).trim()
    const plan = planFor({
      name: 'Maximal',
      dimension: '3d',
      gameplay: `bloom music shader ${long.slice(0, MAX_INTENT_GOAL_LENGTH - 20)}`,
      world: long,
      art: long,
      network: long,
      economy: long,
    })
    expect(new TextEncoder().encode(JSON.stringify(plan)).byteLength).toBeLessThan(MAX_JSONL_LINE_BYTES)
  })

  test('the Markdown holds the rejected candidates as well as the chosen one', () => {
    const markdown = renderPlanMarkdown(CLONE_PLAN)
    expect(markdown).toContain('# Wonderlands — implementation plan')
    expect(markdown).toContain('## Starting point')
    expect(markdown).toContain('Candidates considered')
    expect(markdown).toContain('`carpet-markets`')
    expect(markdown).toContain('## Capability packets')
    expect(markdown).toContain('**Prerequisites**')
    expect(markdown).toContain('kei-mmo/plan.json')
  })

  test('the Markdown records the assumptions when there are any, and not when there are none', () => {
    expect(renderPlanMarkdown(SCAFFOLD_PLAN)).toContain('## Assumptions')
    const full = planFor({
      name: 'Full',
      dimension: '3d',
      gameplay: 'Questing',
      world: 'One shard',
      art: 'Low poly',
      network: '200 a shard',
      economy: 'One currency',
    })
    expect(renderPlanMarkdown(full)).not.toContain('## Assumptions')
  })
})

describe('the terminal summary', () => {
  test('shows both decisions and their first reasons without the whole document', () => {
    const summary = planSummary(SCAFFOLD_PLAN)
    expect(summary).toContain('Salvage Run — a 3D Kei MMORPG')
    expect(summary).toContain('Engine')
    expect(summary).toContain('Start from')
    expect(summary).toContain('scaffold a fresh workspace')
    expect(summary).toContain('Assumed, because the goal was left blank')
    expect(summary.length).toBeLessThan(planBrief(SCAFFOLD_PLAN).length / 4)
  })
})
