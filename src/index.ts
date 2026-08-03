#!/usr/bin/env node
/** `npm create kei-game`: human onboarding and its hard no-prompt agent boundary. */

import { createReadStream, readFileSync } from 'node:fs'
import process, { argv, cwd, env, stdin, stdout } from 'node:process'

import {
  AgentError,
  createAgentRequest,
  readAgentConfig,
  type AgentAnswers,
  type AgentOverrides,
} from './agent.js'
import { nodeFs, nodeGit, nodePath, nodeToolFs, nodeToolPath } from './adapters.js'
import { helpText, parseArgs, selectionFrom, DEFAULT_NAME, type CliOptions } from './cli.js'
import { runCreationTurn, type CreationRunSummary, type CreationRuntimeOptions } from './creation-runtime.js'
import { HarnessError } from './errors.js'
import { createHarnessRequest, HarnessRequestError, type HarnessRequest } from './harness.js'
import { projectFrom } from './naming.js'
import { createAsker, harnessNeedsAsker, onboardHarness, type Asker } from './prompt.js'
import type { HttpFetch } from './provider-transport.js'
import { ProviderError } from './providers.js'
import { EngineError, engineRequestFromHarness } from './runtime.js'
import { ENGINE_ERROR_MESSAGES } from './runtime-protocol.js'
import { prepareSource, type PreparedSource, type SourceDeps } from './source.js'

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
  if (options.agent) {
    await runAgent(options)
    return
  }

  const fromFlags = selectionFrom(options)
  if (!options.yes) {
    await runInteractive(options, fromFlags)
    return
  }

  // Compatibility: --yes remains prompt-free source preparation and does not
  // require provider settings that have no safe defaults.
  const answers = {
    name: options.name ?? DEFAULT_NAME,
    selection: fromFlags ?? { kind: 'blank' as const },
  }

  const project = projectFrom(answers.name)
  if (answers.selection.kind === 'template' || answers.selection.kind === 'repository') {
    stdout.write('\n  Cloning...\n')
  }
  const prepared = await prepareSource(
    {
      project,
      selection: answers.selection,
      baseDirectory: cwd(),
      destination: options.into,
      force: options.force,
    },
    deps,
  )
  stdout.write(report(project.title, prepared))
}

const noQuestions: Asker = {
  async ask() {
    throw new Error('A completed onboarding unexpectedly tried to ask a question.')
  },
  close() {},
}

async function runInteractive(
  options: CliOptions,
  fromFlags: ReturnType<typeof selectionFrom>,
): Promise<void> {
  const asks = harnessNeedsAsker(options, fromFlags)
  const asker = asks ? createAsker() : noQuestions
  let answers
  try {
    if (asks) stdout.write('\n  I will ask only for the setup details still missing.\n\n')
    answers = await onboardHarness(options, fromFlags, asker)
  } finally {
    if (asks) asker.close()
  }

  // Credential presence and every provider/source invariant are checked before
  // prepareSource can create or clone anything.
  const request = createHarnessRequest(
    {
      project: answers.name,
      selection: answers.selection,
      baseDirectory: cwd(),
      destination: options.into,
      force: options.force,
      provider: answers.provider,
      model: answers.model,
      brief: answers.brief,
      launch: options.launch ?? answers.launch,
    },
    env,
  )
  if (request.selection.kind === 'template' || request.selection.kind === 'repository') {
    stdout.write('\n  Cloning...\n')
  }
  const prepared = await prepareSource(
    {
      project: request.project,
      selection: request.selection,
      baseDirectory: request.baseDirectory,
      destination: request.destination,
      force: request.force,
    },
    deps,
  )
  const run = request.launch ? await launch(request, prepared, true) : undefined
  stdout.write(agentReport(request, prepared, run))
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
  const overrides: AgentOverrides = {
    name: options.name,
    source: options.source,
    template: options.template,
    from: options.from,
    into: options.into,
    force: options.force ? true : undefined,
    provider: options.provider,
    model: options.model,
    apiKeyEnv: options.apiKeyEnv,
    baseUrl: options.baseUrl,
    protocol: options.protocol,
    brief: options.brief,
    launch: options.launch,
  }
  const request = createAgentRequest(config, overrides, cwd(), env)
  const prepared = await prepareSource(
    {
      project: request.project,
      selection: request.selection,
      baseDirectory: request.baseDirectory,
      destination: request.destination,
      force: request.force,
    },
    deps,
  )

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
  stdout.write(agentReport(request, prepared, run))
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

function writeJson(value: unknown): void {
  stdout.write(`${JSON.stringify(value)}\n`)
}

function isSafeError(
  error: unknown,
): error is AgentError | HarnessRequestError | ProviderError | HarnessError | EngineError {
  return (
    error instanceof AgentError ||
    error instanceof HarnessRequestError ||
    error instanceof ProviderError ||
    error instanceof HarnessError ||
    error instanceof EngineError
  )
}

function machineError(error: unknown): Record<string, unknown> {
  if (error instanceof EngineError) {
    // Phrased from the canonical table, never from the adapter's own words.
    return { ok: false, error: { code: error.code, message: ENGINE_ERROR_MESSAGES[error.code] } }
  }
  if (error instanceof AgentError || error instanceof HarnessRequestError || error instanceof ProviderError) {
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

function report(title: string, prepared: PreparedSource): string {
  const head = `\n  ${title} — ${where(prepared)}\n`
  return `${head}
    cd ${prepared.directory}

  --yes prepares the source and stops there, by design: it asks nothing, so it
  has no provider, model, or brief to build with. Run without it to build.

  The prepared project is yours to inspect, edit, build, and run as it is.

  https://keicoin.org
`
}

function agentReport(
  request: HarnessRequest,
  prepared: PreparedSource,
  run: CreationRunSummary | undefined,
): string {
  const outcome = run
    ? `ran ${run.turns} model ${run.turns === 1 ? 'round' : 'rounds'}, ${run.toolCalls} tool ${run.toolCalls === 1 ? 'call' : 'calls'}, ${run.written.length} ${run.written.length === 1 ? 'file' : 'files'} written`
    : 'disabled'
  const files = run && run.written.length > 0 ? `\n${run.written.map((file) => `    ${file}`).join('\n')}\n` : ''
  const tail = run
    ? `  This turn is finished. Run the harness again to keep building; the Kei
  terminal interface that holds the session open is later M9 work.`
    : `  The sanitized plan is valid and the project is prepared. No model or tool
  loop ran, because launch was disabled.`

  return `
  ${request.project.title} — ${where(prepared)}

    cd ${prepared.directory}

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
