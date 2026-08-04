/**
 * Everything the shared engine needs to actually run, assembled in one place.
 *
 * The JSONL process and the command line reach the model through this file and
 * through nothing else, which is what keeps them one engine rather than two.
 * The pieces it assembles — a provider transport, the workspace tools, the
 * limits — are all injectable, so the same assembly is what the tests drive.
 */

import { createProviderTransport, type HttpFetch } from './provider-transport.js'
import {
  EngineSession,
  type EngineEvent,
  type EngineLimits,
  type EngineRequest,
  type EngineTool,
  type ModelTransport,
} from './runtime.js'
import type { RuntimeFactory } from './runtime-protocol.js'
import { PLAN_JSON_PATH } from './source.js'
import { createWorkspaceTools, type ToolFs, type ToolPath } from './tools.js'

/** What the harness sends when a session has no plan to point at. */
export const FIRST_TURN_PROMPT = [
  'Build the game described in the brief, inside this workspace.',
  'Look at what is already there before you write anything, then create or update',
  'the files the brief needs. Explain what you changed when you are done.',
].join(' ')

/**
 * The opening turn, aimed at the first step of the plan rather than at the
 * whole plan. A model told to build an MMO writes ten shallow files; a model
 * told to finish step one writes one that works.
 */
export function firstTurnPrompt(request: EngineRequest): string {
  const first = request.plan?.steps[0]
  if (!first) return FIRST_TURN_PROMPT

  return [
    `Start on step ${first.order} of the plan: ${first.title}.`,
    `Outcome: ${first.outcome}`,
    `Capability packets for this step: ${first.capabilities.join(', ')} — their prerequisites, tools, and methods are in your instructions, and the whole plan is in the workspace at ${PLAN_JSON_PATH}.`,
    'Look at what is already in the workspace before you write anything. Do the',
    'work of this step and stop; the later steps are later turns. Say what you',
    'changed, and say plainly if the plan is wrong rather than quietly doing',
    'something else.',
  ].join(' ')
}

/** Enough of the final reply for a machine caller to act on, and no more. */
export const MAX_SUMMARY_CHARACTERS = 4000

export interface CreationRuntimeOptions {
  readonly fetch: HttpFetch
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly fs: ToolFs
  readonly path: ToolPath
  readonly limits?: Partial<EngineLimits>
  readonly maxOutputTokens?: number
}

export interface CreationRuntime {
  readonly transport: ModelTransport
  readonly tools: readonly EngineTool[]
  readonly limits?: Partial<EngineLimits>
  /** Workspace-relative POSIX paths the tools wrote, growing as the session runs. */
  readonly written: readonly string[]
}

export function createCreationRuntime(
  request: EngineRequest,
  options: CreationRuntimeOptions,
): CreationRuntime {
  const workspace = createWorkspaceTools({
    workspace: request.workspace,
    fs: options.fs,
    path: options.path,
    // Read at each write rather than captured now: this closure holds a name,
    // and the value it looks up never outlives the comparison.
    secrets: () => {
      const name = request.provider.apiKeyEnv
      const value = Object.hasOwn(options.environment, name) ? options.environment[name] : undefined
      return typeof value === 'string' && value.trim() !== '' ? [value.trim()] : []
    },
  })
  return {
    transport: createProviderTransport({
      fetch: options.fetch,
      environment: options.environment,
      ...(options.maxOutputTokens === undefined ? {} : { maxOutputTokens: options.maxOutputTokens }),
    }),
    tools: workspace.tools,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    written: workspace.written,
  }
}

/** The factory the JSONL process hands to `runJsonlEngine`. */
export function creationRuntimeFactory(options: CreationRuntimeOptions): RuntimeFactory {
  return { create: (request) => createCreationRuntime(request, options) }
}

export interface CreationRunSummary {
  readonly turns: number
  readonly outputBytes: number
  readonly toolCalls: number
  readonly written: readonly string[]
  /** The model's closing message, truncated. Never a tool argument or result. */
  readonly summary: string
}

/**
 * One bounded turn against a prepared workspace. The command line uses this;
 * the long-running process uses the factory above and its own session loop.
 */
export async function runCreationTurn(
  request: EngineRequest,
  options: CreationRuntimeOptions,
  observe: (event: EngineEvent) => void = () => {},
  prompt: string = firstTurnPrompt(request),
): Promise<CreationRunSummary> {
  const runtime = createCreationRuntime(request, options)
  const session = new EngineSession({
    request,
    transport: runtime.transport,
    tools: runtime.tools,
    ...(runtime.limits === undefined ? {} : { limits: runtime.limits }),
  })

  let turns = 0
  let outputBytes = 0
  let toolCalls = 0
  let summary = ''
  await session.runTurn(prompt, (event) => {
    if (event.type === 'assistant') summary = event.content
    if (event.type === 'tool_started') toolCalls += 1
    if (event.type === 'completed') {
      turns = event.turns
      outputBytes = event.outputBytes
    }
    observe(event)
  })

  return Object.freeze({
    turns,
    outputBytes,
    toolCalls,
    written: Object.freeze([...runtime.written]),
    summary: summary.length > MAX_SUMMARY_CHARACTERS ? `${summary.slice(0, MAX_SUMMARY_CHARACTERS)}…` : summary,
  })
}
