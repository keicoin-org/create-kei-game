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
import { nodeFs, nodeGit, nodePath } from './adapters.js'
import { helpText, parseArgs, selectionFrom, DEFAULT_NAME, type CliOptions } from './cli.js'
import { HarnessError } from './errors.js'
import { HarnessRequestError, type HarnessRequest } from './harness.js'
import { projectFrom } from './naming.js'
import { createAsker, onboard, type Asker } from './prompt.js'
import { ProviderError } from './providers.js'
import { prepareSource, type PreparedSource, type SourceDeps } from './source.js'

// Nothing is re-exported from here: importing this file executes the command.
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}
const { version } = manifest
const deps: SourceDeps = { fs: nodeFs, path: nodePath, git: nodeGit }
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
  const asks = !options.yes && (options.name === undefined || fromFlags === null)
  const asker: Asker | undefined = asks ? createAsker() : undefined

  let answers
  try {
    if (asker) stdout.write('\n  I will ask only for the setup details still missing.\n\n')
    answers = asker
      ? await onboard(options, fromFlags, asker)
      : { name: options.name ?? DEFAULT_NAME, selection: fromFlags ?? { kind: 'blank' as const } }
  } finally {
    asker?.close()
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

  if (options.json) {
    writeJson({
      ok: true,
      status: 'prepared',
      launch: request.launch ? 'pending' : 'disabled',
      request,
      prepared,
    })
    return
  }
  stdout.write(agentReport(request, prepared))
}

async function loadAgentConfig(path: string | undefined): Promise<AgentAnswers> {
  if (path === undefined) return {}
  try {
    const chunks = path === '-' ? stdin : createReadStream(path)
    return await readAgentConfig(chunks as AsyncIterable<Uint8Array | string>)
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
): error is AgentError | HarnessRequestError | ProviderError | HarnessError {
  return (
    error instanceof AgentError ||
    error instanceof HarnessRequestError ||
    error instanceof ProviderError ||
    error instanceof HarnessError
  )
}

function machineError(error: unknown): Record<string, unknown> {
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

  That is as far as this goes today. It prepared the project and stopped: the
  model/tool loop and Kei terminal interface are later M9 work.

  The prepared project is yours to inspect, edit, build, and run as it is.

  https://keicoin.org
`
}

function agentReport(request: HarnessRequest, prepared: PreparedSource): string {
  const launch = request.launch ? 'pending until the model runtime lands' : 'disabled'
  return `
  ${request.project.title} — ${where(prepared)}

    cd ${prepared.directory}

  Provider: ${request.provider.provider} / ${request.model}
  Credential: inherited from ${request.provider.apiKeyEnv}
  Launch: ${launch}

  The sanitized plan is valid and the project is prepared. No model or tool
  loop ran; the Kei terminal runtime is later M9 work.
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
    stdout.write(`\n  ${error.message}\n\n`)
    process.exitCode = 1
  } else {
    throw error
  }
}
