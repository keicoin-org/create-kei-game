/** Heavy generated-project proof, intentionally run in its own Bun process. */
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { planFiles, scaffoldWorkspace } from '../src/source.js'
import { planFor } from './fixtures.js'
import { processFailureDiagnostic, runProcess, safeOsMessage, terminateProcessTree } from './process.js'

const roots: string[] = []
const COMMAND_TIMEOUT_MS = 120_000
const READY_TIMEOUT_MS = 45_000
const BUN = process.execPath

setDefaultTimeout(240_000)

interface FailureDetails {
  readonly code: string
  readonly executable?: 'bun'
  readonly phase: string
  readonly message: string
  readonly status?: number | null
  readonly signal?: string | null
  readonly osCode?: string
  readonly stdout?: string
  readonly stderr?: string
}

class SmokeFailure extends Error {
  constructor(details: FailureDetails) {
    super(JSON.stringify({ event: 'generated_project_smoke_failed', ...details }))
    this.name = 'SmokeFailure'
  }
}

async function run(directory: string, phase: string, args: readonly string[]): Promise<string> {
  const result = await runProcess(BUN, args, {
    cwd: directory,
    env: { ...process.env, NO_COLOR: '1' },
    timeoutMs: COMMAND_TIMEOUT_MS,
  })
  if (result.error !== undefined || result.status !== 0) {
    const diagnostic = JSON.parse(processFailureDiagnostic(phase, result)) as {
      readonly errorCode?: string
    }
    throw new SmokeFailure({
      code: diagnostic.errorCode === 'ETIMEDOUT'
        ? `${phase}_timed_out`
        : `${phase}_failed`,
      executable: 'bun',
      phase,
      message: result.error === undefined
        ? `bun exited ${String(result.status)}`
        : 'bun failed before producing an exit status',
      status: result.status,
      signal: result.signal,
      osCode: diagnostic.errorCode,
    })
  }
  return result.stdout
}

function writeProject(dimension: '2d' | '3d'): string {
  const directory = mkdtempSync(join(tmpdir(), `kei-generated-${dimension}-`))
  roots.push(directory)
  const title = dimension === '3d' ? 'Smoke World 3D' : 'Smoke World 2D'
  const project = { slug: `smoke-world-${dimension}`, title }
  const plan = planFor({
    name: title,
    dimension,
    gameplay: 'Players move around a deliberately minimal construction world.',
  })

  for (const file of [...scaffoldWorkspace(project, plan), ...planFiles(plan)]) {
    const target = join(directory, ...file.path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.contents, 'utf8')
  }
  return directory
}

/**
 * Teardown shares the harness terminator so this proof cannot report a reaped
 * tree while a descendant of the dev server is still holding its port. The
 * shared terminator keeps sweeping after the direct child exits, which a
 * `taskkill /t` on an already-exited root never does.
 */
async function terminateTree(child: ChildProcessWithoutNullStreams, spawnedAtMs: number): Promise<void> {
  try {
    await terminateProcessTree(child, spawnedAtMs)
  } catch (error) {
    throw new SmokeFailure({
      code: 'tree_termination_failed',
      phase: 'teardown',
      message: safeOsMessage(error instanceof Error ? error.message : error),
    })
  }
}

async function expectPortReleased(host: string, port: number): Promise<void> {
  const deadline = Date.now() + 5_000
  while (true) {
    const probe = spawnSync('node', [
      '-e',
      "const net=require('node:net');const s=net.createConnection({host:process.argv[1],port:Number(process.argv[2])});s.setTimeout(1000);s.once('connect',()=>{s.destroy();process.exit(2)});s.once('error',()=>process.exit(0));s.once('timeout',()=>{s.destroy();process.exit(0)})",
      host,
      String(port),
    ], { encoding: 'utf8', timeout: 5_000, windowsHide: true })
    const connected = probe.status === 2
    if (!connected) return
    if (Date.now() >= deadline) {
      throw new SmokeFailure({
        code: 'dev_port_still_open',
        phase: 'teardown',
        message: `${host}:${port} still accepted connections after process-tree termination`,
      })
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function expectCrossOriginRefused(directory: string, socketUrl: string): Promise<void> {
  const script = [
    "const WebSocket=require('ws')",
    "const socket=new WebSocket(process.argv[1],{origin:'http://attacker.invalid'})",
    "let message=null",
    "const timeout=setTimeout(()=>{socket.terminate();process.stderr.write('timed out');process.exit(1)},10000)",
    "socket.once('message',data=>message=JSON.parse(String(data)))",
    "socket.once('close',code=>{clearTimeout(timeout);process.stdout.write(JSON.stringify({code,message}));process.exit(0)})",
    "socket.once('error',error=>{clearTimeout(timeout);process.stderr.write(error.message);process.exit(1)})",
  ].join(';')
  const probe = spawnSync('node', ['-e', script, socketUrl], {
    cwd: directory, encoding: 'utf8', timeout: 15_000, windowsHide: true,
  })
  if (probe.error !== undefined || probe.status !== 0) {
    throw new SmokeFailure({
      code: 'cross_origin_probe_failed',
      phase: 'websocket',
      message: probe.error?.message ?? `node exited ${String(probe.status)}`,
      status: probe.status,
      signal: probe.signal,
      stdout: probe.stdout,
      stderr: probe.stderr,
    })
  }
  const response = JSON.parse(probe.stdout) as { readonly code?: unknown; readonly message?: unknown }
  expect(response.code).toBe(4003)
  expect(response.message).toEqual({ v: 2, type: 'refused', code: 'origin_refused' })
}

async function startAndProbe(directory: string): Promise<void> {
  const spawnedAt = Date.now()
  const child = spawn(BUN, ['run', 'dev'], {
    cwd: directory,
    detached: process.platform !== 'win32',
    windowsHide: true,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', NO_COLOR: '1' },
  })

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { stdout += chunk })
  child.stderr.on('data', (chunk: string) => { stderr += chunk })
  let bound: { readonly host: string; readonly port: number } | null = null

  try {
    const ready = await new Promise<{
      readonly url: string
      readonly socketUrl: string
      readonly host: string
      readonly port: number
      readonly protocol: number
    }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new SmokeFailure({
          code: 'dev_ready_timed_out',
          phase: 'dev',
          message: `no readiness record within ${READY_TIMEOUT_MS}ms`,
          stdout,
          stderr,
        }))
      }, READY_TIMEOUT_MS)

      const inspect = (): void => {
        for (const line of stdout.split(/\r?\n/)) {
          if (line.trim() === '') continue
          try {
            const record = JSON.parse(line) as {
              event?: unknown
              service?: unknown
              url?: unknown
              socketUrl?: unknown
              host?: unknown
              port?: unknown
              protocol?: unknown
            }
            if (
              record.event === 'ready' &&
              record.service === 'kei-game-server' &&
              typeof record.url === 'string' &&
              typeof record.socketUrl === 'string' &&
              typeof record.host === 'string' &&
              typeof record.port === 'number' &&
              record.protocol === 2
            ) {
              clearTimeout(timeout)
              resolve({
                url: record.url,
                socketUrl: record.socketUrl,
                host: record.host,
                port: record.port,
                protocol: record.protocol,
              })
              return
            }
          } catch {
            // Bun can print its command banner; readiness itself must be JSON.
          }
        }
      }

      child.stdout.on('data', inspect)
      child.once('exit', (status, signal) => {
        clearTimeout(timeout)
        reject(new SmokeFailure({
          code: 'dev_exited_before_ready',
          phase: 'dev',
          message: 'the dev process exited before its readiness record',
          status,
          signal,
          stdout,
          stderr,
        }))
      })
    })

    expect(ready.host).toBe('127.0.0.1')
    expect(ready.port).toBeGreaterThan(0)
    expect(ready.protocol).toBe(2)
    expect(new URL(ready.url).hostname).toBe('127.0.0.1')
    expect(new URL(ready.socketUrl).hostname).toBe('127.0.0.1')
    bound = { host: ready.host, port: ready.port }

    try {
      const page = await fetch(ready.url, { signal: AbortSignal.timeout(10_000) })
      if (!page.ok || !(await page.text()).includes('<canvas id="game"')) {
        throw new SmokeFailure({
          code: 'page_probe_failed',
          phase: 'http',
          message: `GET / returned ${page.status} or no game canvas`,
          stdout,
          stderr,
        })
      }

      const bundle = await fetch(new URL('client/main.js', ready.url), {
        signal: AbortSignal.timeout(10_000),
      })
      if (!bundle.ok || (await bundle.arrayBuffer()).byteLength === 0) {
        throw new SmokeFailure({
          code: 'bundle_probe_failed',
          phase: 'http',
          message: `GET /client/main.js returned ${bundle.status} or an empty body`,
          stdout,
          stderr,
        })
      }

      const status = await fetch(new URL('__dev/status', ready.url), {
        signal: AbortSignal.timeout(10_000),
      })
      expect(await status.json()).toEqual({
        service: 'kei-game-server',
        root: 'dist',
        entry: 'client/main.js',
        socketPath: '/game',
        protocol: 2,
      })

      const wrongProtocol = new URL(ready.socketUrl)
      wrongProtocol.searchParams.set('protocol', '1')
      const mismatch = await new Promise<{ readonly message: Record<string, unknown>; readonly closeCode: number }>(
        (resolve, reject) => {
          const socket = new WebSocket(wrongProtocol)
          let message: Record<string, unknown> | null = null
          const timeout = setTimeout(() => {
            socket.close()
            reject(new Error('protocol mismatch socket did not close in time'))
          }, 10_000)
          socket.addEventListener('message', (event) => {
            message = JSON.parse(String(event.data)) as Record<string, unknown>
          })
          socket.addEventListener('close', (event) => {
            clearTimeout(timeout)
            if (message === null) reject(new Error('protocol mismatch closed without a refusal'))
            else resolve({ message, closeCode: event.code })
          })
          socket.addEventListener('error', () => {
            clearTimeout(timeout)
            reject(new Error('protocol mismatch failed before its refusal'))
          })
        },
      )
      expect(mismatch.message).toEqual({ v: 2, type: 'refused', code: 'protocol_mismatch' })
      expect(mismatch.closeCode).toBe(4001)

      await expectCrossOriginRefused(directory, ready.socketUrl)

      const encounter = await run(directory, 'shared_encounter', ['run', 'headless', '--', ready.socketUrl])
      const evidence = encounter
        .split(/\r?\n/)
        .filter((line) => line.trim().startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((line) => line.event === 'shared_encounter')
      expect(evidence).toMatchObject({
        event: 'shared_encounter',
        protocol: 2,
        staleInputRefused: true,
        authorityViolationRefused: true,
        rateLimited: true,
        disconnectObserved: true,
      })
      expect(evidence?.players).toBeArrayOfSize(2)
    } catch (error) {
      if (error instanceof SmokeFailure) throw error
      throw new SmokeFailure({
        code: 'http_probe_failed',
        phase: 'http',
        message: error instanceof Error ? error.message : String(error),
        stdout,
        stderr,
      })
    }
  } finally {
    await terminateTree(child, spawnedAt)
    if (bound !== null) await expectPortReleased(bound.host, bound.port)
  }
}

function expectPublicHostRefused(directory: string): void {
  const result = spawnSync(BUN, ['run', 'dev'], {
    cwd: directory,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
    env: { ...process.env, HOST: '0.0.0.0', PORT: '0', NO_COLOR: '1' },
  })
  expect(result.status).not.toBe(0)
  expect(result.stdout).not.toContain('"event":"ready"')
  const record = result.stderr
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as { event?: unknown; code?: unknown; message?: unknown })
    .find((line) => line.event === 'error')
  expect(record).toEqual({
    event: 'error',
    code: 'invalid_host',
    message: 'HOST must be the numeric loopback address 127.0.0.1 or ::1.',
  })
}

afterAll(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('generated projects install, build, and start without the harness', () => {
  for (const dimension of ['2d', '3d'] as const) {
    test(`${dimension} scaffold passes the offline black-box smoke`, async () => {
      const directory = writeProject(dimension)
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
      }
      expect(manifest.dependencies?.['create-kei-mmo']).toBeUndefined()
      expect(manifest.dependencies?.ws).toMatch(/^\^8\./)
      expect(manifest.dependencies?.['kei-transaction']).toBe('0.6.0')
      if (dimension === '3d') expect(manifest.dependencies?.['@babylonjs/core']).toMatch(/^\^9\./)
      else expect(manifest.dependencies?.['@babylonjs/core']).toBeUndefined()

      // The harness install populated Bun's global cache. Offline mode proves
      // this generated-project check cannot silently depend on registry access.
      await run(directory, 'install', ['install', '--offline'])
      await run(directory, 'build', ['run', 'build'])
      await run(directory, 'economy', ['run', 'economy:check'])
      expect(existsSync(join(directory, 'dist', 'client', 'main.js'))).toBeTrue()
      expect(existsSync(join(directory, 'dist', 'server', 'main.js'))).toBeTrue()
      expect(existsSync(join(directory, 'dist', 'headless', 'headless.js'))).toBeTrue()

      expectPublicHostRefused(directory)

      const installedLock = readFileSync(join(directory, 'bun.lock'), 'utf8')
      expect(installedLock).not.toContain('create-kei-mmo')

      const ownedSource = [
        'scripts/build.mjs',
        'src/client/main.ts',
        'src/client/connection.ts',
        'src/client/headless.ts',
        'src/economy/definitions.ts',
        'src/economy/player-trade.ts',
        'src/economy/provision.ts',
        'src/client/restart-proof.ts',
        'src/server/dev-server.mjs',
        'src/server/main.ts',
        'src/server/persistence.ts',
        'src/shared/simulation.ts',
        'src/shared/protocol.ts',
        'test/economy.test.ts',
      ].map((file) => readFileSync(join(directory, ...file.split('/')), 'utf8')).join('\n')
      expect(ownedSource).not.toMatch(/(?:from|require\()\s*['"]create-kei-mmo/)
      if (dimension === '3d') {
        expect(ownedSource).toContain("from '@babylonjs/core/")
        expect(ownedSource).not.toMatch(/(?:from|require\()\s*['"]three/)
        expect(ownedSource).toContain('engine.runRenderLoop')
        expect(ownedSource).toContain("window.addEventListener('resize'")
      } else {
        expect(ownedSource).toContain("canvas.getContext('2d'")
        expect(ownedSource).toContain('const firstX = Math.floor')
        expect(ownedSource).not.toContain('@babylonjs/core')
      }

      const restartProof = await run(directory, 'restart_proof', ['run', 'restart-proof'])
      const restartEvidence = restartProof
        .split(/\r?\n/)
        .filter((line) => line.trim().startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((line) => line.event === 'restart_proof')
      expect(restartEvidence).toMatchObject({
        event: 'restart_proof', protocol: 2, restoredExactly: true,
        progressionAuthored: true, randomTokenRefused: true, malformedTokenRefused: true,
        duplicateTokenRefused: true, forgeryRefused: true, forgeryNotPersisted: true,
        plaintextTokenAbsent: true,
      })

      const serverRuns = process.platform === 'win32' ? 10 : 1
      for (let run = 0; run < serverRuns; run += 1) await startAndProbe(directory)
    }, 360_000)
  }
})
