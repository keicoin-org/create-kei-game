#!/usr/bin/env node
/** `create-kei-mmo`: intent in, a planned MMORPG project out. */

import { createReadStream, readFileSync } from 'node:fs'
import process, { argv, cwd, env, stdin, stdout } from 'node:process'

import {
  AgentError,
  createAgentIntent,
  createAgentRequest,
  overridesFrom,
  readAgentConfig,
  type AgentAnswers,
} from './agent.js'
import { nodeFs, nodeGit, nodePath, nodeToolFs, nodeToolPath } from './adapters.js'
import { helpText, parseArgs, type CliOptions } from './cli.js'
import { runCreationTurn, type CreationRunSummary, type CreationRuntimeOptions } from './creation-runtime.js'
import { HarnessError } from './errors.js'
import { createHarnessRequest, HarnessRequestError, type HarnessRequest } from './harness.js'
import { IntentError, type MmoIntent } from './intent.js'
import { projectFrom } from './naming.js'
import { planSummary } from './plan.js'
import { planMmo, selectionForPlan } from './planner.js'
import {
  createAsker,
  harnessNeedsAsker,
  intentFromOptions,
  intentNeedsAsker,
  onboardHarness,
  onboardIntent,
  DEFAULT_YES_GAMEPLAY,
  type Asker,
} from './prompt.js'
import type { HttpFetch } from './provider-transport.js'
import { ProviderError } from './providers.js'
import { EngineError, engineRequestFromHarness } from './runtime.js'
import { ENGINE_ERROR_MESSAGES } from './runtime-protocol.js'
import { prepareSource, PLAN_MARKDOWN_PATH, type PreparedSource, type SourceDeps } from './source.js'

// Nothing is re-exported from here: importing this file executes the command.
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}
const { version } = manifest
const deps: SourceDeps = { fs: nodeFs, path: nodePath, git: nodeGit }
const nodeFetch: HttpFetch = (url, request) => fetch(url, request)
const runtimeOptions: CreationRuntimeOptions = {
  fetch: nodeFetch,
  environment: env,
  fs: nodeToolFs,
  path: nodeToolPath,
}
const rawArgs = argv.slice(2)
const machineRequested = rawArgs.includes('--json')

async function main(): Promise<void> {
  const options = parseArgs(rawArgs)

  if (options.help) {
    stdout.write(helpText(version))
    return
  }
  if (options.version) {
    stdout.write(`${version}\n`)
    return
  }
  if (options.planOnly) {
    await runPlanOnly(options)
    return
  }
  if (options.agent) {
    await runAgent(options)
    return
  }
  if (options.yes) {
    await runUnattended(options)
    return
  }
  await runInteractive(options)
}

const noQuestions: Asker = {
  async ask() {
    throw new Error('A completed onboarding unexpectedly tried to ask a question.')
  },
  close() {},
}

/**
 * Planning reaches nothing: no directory, no provider, no credential, no model.
 * It is the way to see what the harness decided, and to disagree with it,
 * before it acts on any of it.
 */
async function runPlanOnly(options: CliOptions): Promise<void> {
  const intent = options.agent
    ? createAgentIntent(await loadAgentConfig(options.agentConfig), overridesFrom(options))
    : await interactiveIntent(options)
  const plan = planMmo(intent)

  if (options.json) {
    writeJson({ ok: true, status: 'planned', plan })
    return
  }
  stdout.write(`\n  ${indented(planSummary(plan))}\n\n  Nothing was written. Drop --plan-only to build it.\n\n`)
}

async function interactiveIntent(options: CliOptions): Promise<MmoIntent> {
  if (!intentNeedsAsker(options)) return intentFromOptions(options)
  const asker = createAsker()
  try {
    return await onboardIntent(options, asker)
  } finally {
    asker.close()
  }
}

async function runInteractive(options: CliOptions): Promise<void> {
  const asks = harnessNeedsAsker(options)
  const asker = asks ? createAsker() : noQuestions
  let answers
  try {
    if (asks) stdout.write('\n  I will ask only for the setup details still missing.\n\n')
    answers = await onboardHarness(options, asker)
  } finally {
    if (asks) asker.close()
  }

  // Credential presence and every provider invariant are checked before
  // prepareSource can create or clone anything.
  const request = createHarnessRequest(
    {
      intent: answers.intent,
      baseDirectory: cwd(),
      destination: options.into,
      force: options.force,
      provider: answers.provider,
      model: answers.model,
      launch: options.launch ?? answers.launch,
    },
    env,
  )
  stdout.write(`\n  ${indented(planSummary(request.plan))}\n`)

  const prepared = await prepare(request, true)
  const run = request.launch ? await launch(request, prepared, true) : undefined
  stdout.write(report(request, prepared, run))
}

/** `--yes`: plan and scaffold with nothing asked and no provider involved. */
async function runUnattended(options: CliOptions): Promise<void> {
  const intent = intentFromOptions(options, DEFAULT_YES_GAMEPLAY)
  const plan = planMmo(intent)
  const prepared = await prepareSource(
    {
      project: projectFrom(plan.intent.name),
      selection: selectionForPlan(plan),
      baseDirectory: cwd(),
      destination: options.into,
      force: options.force,
      plan,
    },
    deps,
  )
  stdout.write(`\n  ${indented(planSummary(plan))}\n`)
  stdout.write(`
    cd ${prepared.directory}

  --yes plans and scaffolds and stops there, by design: it asks nothing, so it
  has no provider, model, or credential to build with. Run without it to build.

  The plan is at ${PLAN_MARKDOWN_PATH} in there, and it is yours to edit.

  https://keicoin.org
`)
}

async function prepare(request: HarnessRequest, narrate: boolean): Promise<PreparedSource> {
  if (narrate && request.selection.kind !== 'blank') stdout.write('\n  Cloning the reference...\n')
  return await prepareSource(
    {
      project: request.project,
      selection: request.selection,
      baseDirectory: request.baseDirectory,
      destination: request.destination,
      force: request.force,
      plan: request.plan,
    },
    deps,
  )
}

/**
 * The launch itself: the same shared engine, against the workspace that was
 * just prepared. It runs one bounded turn and stops — the Kei TUI is what will
 * hold the session open for the turns after this one.
 */
async function launch(
  request: HarnessRequest,
  prepared: PreparedSource,
  narrate: boolean,
): Promise<CreationRunSummary> {
  if (narrate) stdout.write('\n  Building...\n')
  return await runCreationTurn(
    engineRequestFromHarness(request, prepared.directory),
    runtimeOptions,
    (event) => {
      if (!narrate) return
      if (event.type === 'tool_started') stdout.write(`    ${event.name}\n`)
      if (event.type === 'assistant' && event.content !== '') stdout.write(`\n  ${event.content}\n\n`)
    },
  )
}

async function runAgent(options: CliOptions): Promise<void> {
  const config = await loadAgentConfig(options.agentConfig)
  const request = createAgentRequest(config, overridesFrom(options), cwd(), env)
  const prepared = await prepare(request, false)

  // Progress narration would corrupt a single-JSON-object contract, so the
  // machine caller gets the run summary in the one object instead.
  const run = request.launch ? await launch(request, prepared, !options.json) : undefined

  if (options.json) {
    writeJson({
      ok: true,
      status: run ? 'built' : 'prepared',
      launch: run ? 'completed' : 'disabled',
      request,
      prepared,
      ...(run === undefined ? {} : { run }),
    })
    return
  }
  stdout.write(report(request, prepared, run))
}

async function loadAgentConfig(path: string | undefined): Promise<AgentAnswers> {
  if (path === undefined) return {}
  try {
    const chunks = path === '-' ? stdin : createReadStream(path)
    return await readAgentConfig(chunks as unknown as AsyncIterable<Uint8Array | string>)
  } catch (error) {
    if (isSafeError(error)) throw error
    throw new AgentError('invalid_config', 'Agent config could not be read.', {
      field: 'agentConfig',
    })
  }
}

/** Two spaces in front of every line that has something on it. */
function indented(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line === '' ? '' : `  ${line}`))
    .join('\n')
    .trimStart()
}

function writeJson(value: unknown): void {
  stdout.write(`${JSON.stringify(value)}\n`)
}

function isSafeError(
  error: unknown,
): error is AgentError | HarnessRequestError | ProviderError | HarnessError | EngineError | IntentError {
  return (
    error instanceof AgentError ||
    error instanceof HarnessRequestError ||
    error instanceof ProviderError ||
    error instanceof HarnessError ||
    error instanceof EngineError ||
    error instanceof IntentError
  )
}

function machineError(error: unknown): Record<string, unknown> {
  if (error instanceof EngineError) {
    // Phrased from the canonical table, never from the adapter's own words.
    return { ok: false, error: { code: error.code, message: ENGINE_ERROR_MESSAGES[error.code] } }
  }
  if (
    error instanceof AgentError ||
    error instanceof HarnessRequestError ||
    error instanceof ProviderError ||
    error instanceof IntentError
  ) {
    return { ok: false, error: { code: error.code, message: error.message, ...machineDetails(error.details) } }
  }
  if (error instanceof HarnessError) {
    return {
      ok: false,
      error: { code: 'invalid_arguments', message: 'Arguments or project preparation are not valid.' },
    }
  }
  return { ok: false, error: { code: 'internal_error', message: 'The harness failed unexpectedly.' } }
}

function machineDetails(details: object): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  const values = details as { readonly field?: unknown; readonly fields?: unknown; readonly missing?: unknown }
  for (const field of ['field', 'fields', 'missing'] as const) {
    if (values[field] !== undefined) safe[field] = values[field]
  }
  return safe
}

function report(
  request: HarnessRequest,
  prepared: PreparedSource,
  run: CreationRunSummary | undefined,
): string {
  const outcome = run
    ? `ran ${run.turns} model ${run.turns === 1 ? 'round' : 'rounds'}, ${run.toolCalls} tool ${run.toolCalls === 1 ? 'call' : 'calls'}, ${run.written.length} ${run.written.length === 1 ? 'file' : 'files'} written`
    : 'disabled'
  const files = run && run.written.length > 0 ? `\n${run.written.map((file) => `    ${file}`).join('\n')}\n` : ''
  const tail = run
    ? `  This turn is finished. Run the harness again to keep working through the
  plan; the Kei terminal interface that holds the session open is later M9 work.`
    : `  The intent, the plan, and the provider settings are valid and the project
  is prepared. No model or tool loop ran, because launch was disabled.`

  return `
  ${request.project.title} — ${where(prepared)}

    cd ${prepared.directory}

  Plan: ${PLAN_MARKDOWN_PATH}
  Provider: ${request.provider.provider} / ${request.model}
  Credential: inherited from ${request.provider.apiKeyEnv}
  Launch: ${outcome}
${files}
${tail}
`
}

function where(prepared: PreparedSource): string {
  switch (prepared.selection.kind) {
    case 'existing':
      return `using the project already at ${prepared.directory}`
    case 'blank':
      return `${prepared.written.length} files in ${prepared.directory}`
    default:
      return `cloned from ${prepared.remote} into ${prepared.directory}`
  }
}

try {
  await main()
} catch (error) {
  if (machineRequested) {
    writeJson(machineError(error))
    process.exitCode = 1
  } else if (isSafeError(error)) {
    stdout.write(`\n  ${error instanceof EngineError ? ENGINE_ERROR_MESSAGES[error.code] : error.message}\n\n`)
    process.exitCode = 1
  } else {
    throw error
  }
}
