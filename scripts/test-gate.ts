import { readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { requireProcessSuccess, runProcess } from '../test/process.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const testDirectory = join(root, 'test')
const isolated = Object.freeze(['scaffold-polish.test.ts', 'agent-cli.test.ts'])
const unitFiles = readdirSync(testDirectory)
  .filter((name) => name.endsWith('.test.ts') && !isolated.includes(name))
  .sort()
  .map((name) => `./test/${name}`)

const suites = Object.freeze([
  Object.freeze({ name: 'unit', files: Object.freeze(unitFiles), timeoutMs: 300_000 }),
  Object.freeze({
    name: 'scaffold-polish',
    files: Object.freeze(['./test/scaffold-polish.test.ts']),
    timeoutMs: 180_000,
    testTimeoutMs: 15_000,
  }),
  // Bun 1.3.0 on Windows can segfault when this spawn-heavy black-box suite
  // inherits a long-lived test runner. A fresh process is the deterministic
  // boundary: it preserves every assertion and treats a crash as a failure.
  Object.freeze({ name: 'agent-cli', files: Object.freeze(['./test/agent-cli.test.ts']), timeoutMs: 120_000 }),
])

if (process.argv.includes('--plan')) {
  process.stdout.write(`${JSON.stringify(suites)}\n`)
  process.exit(0)
}

const script = fileURLToPath(import.meta.url)
if (process.argv.includes('--fixture-exit')) process.exit(7)
if (process.argv.includes('--fixture-leaf')) {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => process.stdout.write(`leaf-pid:${process.pid}\n`))
  await new Promise(() => {})
}
if (process.argv.includes('--fixture-tree')) {
  const child = spawn(process.execPath, [script, '--fixture-leaf'], {
    shell: false,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  })
  child.once('error', (error) => { throw error })
  process.stdout.write(`leaf-pid:${String(child.pid)}\n`)
  const server = createServer()
  server.listen(0, '127.0.0.1', () => process.stdout.write(`root-pid:${process.pid}\n`))
  await new Promise(() => {})
}

// This script itself is launched by Bun, so its exact executable avoids PATH
// and PATHEXT differences inside Windows child_process.
const bun = process.execPath
if (process.argv.includes('--probe-failure')) {
  const result = await runProcess(bun, [script, '--fixture-exit'], { cwd: root, timeoutMs: 10_000 })
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  requireProcessSuccess('gate-failure-probe', result)
}
if (process.argv.includes('--probe-timeout')) {
  const result = await runProcess(bun, [script, '--fixture-tree'], { cwd: root, timeoutMs: 1_000 })
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  requireProcessSuccess('gate-timeout-probe', result)
}

for (const suite of suites) {
  if (suite.files.length === 0) throw new Error(`${suite.name} test process has no files`)
  // runProcess owns the full descendant tree, uses a detached process group on
  // POSIX and captured PID/creation identities on Windows, and does not settle
  // a timeout until it proves every owned descendant is gone. Its adversarial
  // cleanup tests run in the unit suite before the isolated agent suite.
  const result = await runProcess(
    bun,
    [
      'test',
      ...suite.files,
      '--max-concurrency=1',
      ...('testTimeoutMs' in suite ? [`--timeout=${suite.testTimeoutMs}`] : []),
    ],
    { cwd: root, env: process.env, timeoutMs: suite.timeoutMs },
  )
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  requireProcessSuccess(`${suite.name}-tests`, result)
}
