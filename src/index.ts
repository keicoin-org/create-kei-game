#!/usr/bin/env node
/**
 * `npm create kei-game`.
 *
 * It asks what the project is called and where it starts from, puts that on
 * disk, and stops. The stopping is the honest part: choosing an AI provider,
 * holding credentials, and running the Kei terminal interface are later work,
 * and this prints what it did rather than implying it did more.
 *
 * It installs nothing of its own — only what Node already has — so the first
 * thing anyone waits for is their game's dependencies, not this.
 */

import { readFileSync } from 'node:fs'
import { argv, cwd, exit, stdout } from 'node:process'

import { nodeFs, nodeGit, nodePath } from './adapters.js'
import { helpText, parseArgs, selectionFrom, DEFAULT_NAME } from './cli.js'
import { HarnessError } from './errors.js'
import { projectFrom } from './naming.js'
import { createAsker, onboard, type Asker } from './prompt.js'
import { prepareSource, type PreparedSource, type SourceDeps } from './source.js'

// Nothing is re-exported from here on purpose: this file is the executable and
// runs on import. `create-kei-game/source` exposes the source API without
// executing the CLI.

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
const { version } = manifest

const deps: SourceDeps = { fs: nodeFs, path: nodePath, git: nodeGit }

async function main(): Promise<void> {
  const options = parseArgs(argv.slice(2))

  if (options.help) {
    stdout.write(helpText(version))
    return
  }
  if (options.version) {
    stdout.write(`${version}\n`)
    return
  }

  // Every contradiction between flags dies here, before a terminal is opened
  // and long before a directory is touched.
  const fromFlags = selectionFrom(options)

  // Nothing is asked if nothing needs asking, which is what makes this usable
  // from a script. `--yes` never opens a prompt at all.
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

function report(title: string, prepared: PreparedSource): string {
  const head = `
  ${title} — ${where(prepared)}
`
  return `${head}
    cd ${prepared.directory}

  That is as far as this goes today. It prepared the project and stopped: it did
  not choose an AI provider for you, it is holding no credentials, and the Kei
  terminal interface that will build the game with you is later work in M9.

  The prepared files do not depend on this package. Remove the command and the
  project is unchanged: it is yours to inspect, edit, build, and run as it is.

  https://keicoin.org
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
  if (error instanceof HarnessError) {
    stdout.write(`\n  ${error.message}\n\n`)
    exit(1)
  }
  throw error
}
