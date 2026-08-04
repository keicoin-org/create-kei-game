import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { planFiles, scaffoldWorkspace } from '../src/source.js'
import { planFor } from './fixtures.js'

const roots: string[] = []
const COMMAND_TIMEOUT_MS = 120_000
const READY_TIMEOUT_MS = 45_000
const BUN = process.execPath

setDefaultTimeout(240_000)

interface FailureDetails {
  readonly code: string
  readonly phase: string
  readonly message: string
  readonly status?: number | null
  readonly signal?: string | null
  readonly stdout?: string
  readonly stderr?: string
}

class SmokeFailure extends Error {
  constructor(details: FailureDetails) {
    super(JSON.stringify({ event: 'generated_project_smoke_failed', ...details }))
    this.name = 'SmokeFailure'
  }
}

function run(directory: string, phase: string, args: readonly string[]): string {
  const result = spawnSync(BUN, [...args], {
    cwd: directory,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' },
  })
  if (result.error !== undefined || result.status !== 0) {
    throw new SmokeFailure({
      code: result.error?.name === 'Error' && 'code' in result.error && result.error.code === 'ETIMEDOUT'
        ? `${phase}_timed_out`
        : `${phase}_failed`,
      phase,
      message: result.error?.message ?? `bun exited ${String(result.status)}`,
      status: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
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

function terminateTree(child: ChildProcessWithoutNullStreams): void {
  if (child.pid === undefined || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      // It exited between the exitCode check and the signal.
    }
  }
}

async function startAndProbe(directory: string): Promise<void> {
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
              record.service === 'kei-dev-server' &&
              typeof record.url === 'string' &&
              typeof record.socketUrl === 'string' &&
              typeof record.host === 'string' &&
              typeof record.port === 'number' &&
              record.protocol === 1
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
    expect(ready.protocol).toBe(1)
    expect(new URL(ready.url).hostname).toBe('127.0.0.1')
    expect(new URL(ready.socketUrl).hostname).toBe('127.0.0.1')

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
        service: 'kei-dev-server',
        root: 'dist',
        entry: 'client/main.js',
        socketPath: '/game',
        protocol: 1,
      })

      const wrongProtocol = new URL(ready.socketUrl)
      wrongProtocol.searchParams.set('protocol', '2')
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
      expect(mismatch.message).toEqual({ v: 1, type: 'refused', code: 'protocol_mismatch' })
      expect(mismatch.closeCode).toBe(4001)

      const invalidHello = await new Promise<{ readonly message: Record<string, unknown>; readonly closeCode: number }>(
        (resolve, reject) => {
          const socket = new WebSocket(ready.socketUrl)
          let message: Record<string, unknown> | null = null
          const timeout = setTimeout(() => {
            socket.close()
            reject(new Error('invalid hello socket did not close in time'))
          }, 10_000)
          socket.addEventListener('open', () => socket.send(JSON.stringify({ v: 1, type: 'hello', extra: true })))
          socket.addEventListener('message', (event) => {
            message = JSON.parse(String(event.data)) as Record<string, unknown>
          })
          socket.addEventListener('close', (event) => {
            clearTimeout(timeout)
            if (message === null) reject(new Error('invalid hello closed without a refusal'))
            else resolve({ message, closeCode: event.code })
          })
          socket.addEventListener('error', () => {
            clearTimeout(timeout)
            reject(new Error('invalid hello failed before its refusal'))
          })
        },
      )
      expect(invalidHello.message).toEqual({ v: 1, type: 'refused', code: 'invalid_message' })
      expect(invalidHello.closeCode).toBe(4002)

      const headless = run(directory, 'headless_connect', ['run', 'headless', '--', ready.socketUrl])
      const evidence = headless
        .split(/\r?\n/)
        .filter((line) => line.trim().startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((line) => line.event === 'headless_connected')
      expect(evidence).toMatchObject({
        event: 'headless_connected',
        protocol: 1,
        tick: 0,
        cleanDisconnect: true,
      })
      expect(evidence?.playerId).toBeString()
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
    terminateTree(child)
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
      if (dimension === '3d') expect(manifest.dependencies?.['@babylonjs/core']).toMatch(/^\^9\./)
      else expect(manifest.dependencies?.['@babylonjs/core']).toBeUndefined()

      // The harness install populated Bun's global cache. Offline mode proves
      // this generated-project check cannot silently depend on registry access.
      run(directory, 'install', ['install', '--offline'])
      run(directory, 'build', ['run', 'build'])
      expect(existsSync(join(directory, 'dist', 'client', 'main.js'))).toBeTrue()
      expect(existsSync(join(directory, 'dist', 'server', 'main.js'))).toBeTrue()
      expect(existsSync(join(directory, 'dist', 'headless', 'headless.js'))).toBeTrue()

      expectPublicHostRefused(directory)

      if (dimension === '3d') {
        const dependencyTree = run(directory, 'dependency_tree', ['pm', 'ls', '--all'])
        expect(dependencyTree).not.toContain('create-kei-mmo')
      }

      const ownedSource = [
        'scripts/build.mjs',
        'src/client/connection.ts',
        'src/client/headless.ts',
        'src/client/main.ts',
        'src/server/dev-server.mjs',
        'src/server/main.ts',
        'src/shared/simulation.ts',
        'src/shared/protocol.ts',
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

      await startAndProbe(directory)
    }, 240_000)
  }
})
