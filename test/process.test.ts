import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'

import {
  nodeExecutable,
  processFailureDiagnostic,
  requireProcessExit,
  requireProcessSuccess,
  runProcess,
} from './process.js'

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('bounded process diagnostics', () => {
  test('an injected spawn error reports its safe OS fields instead of an undefined status assertion', () => {
    const error = Object.assign(
      new Error(`spawn failed\n${'x'.repeat(400)}`),
      { code: 'EAGAIN' },
    )
    const result = {
      status: null,
      signal: null,
      stdout: 'request body that must not be reported',
      stderr: 'generated secret that must not be reported',
      error,
    } as const

    const diagnostic = processFailureDiagnostic('runtime-cli', result)
    expect(diagnostic.length).toBeLessThan(400)
    expect(JSON.parse(diagnostic)).toMatchObject({
      event: 'test_process_failed',
      phase: 'runtime-cli',
      status: null,
      signal: null,
      errorCode: 'EAGAIN',
    })
    expect(diagnostic).toContain('spawn failed')
    expect(diagnostic).not.toContain('\n')
    expect(diagnostic).not.toContain('request body')
    expect(diagnostic).not.toContain('generated secret')
    expect(() => requireProcessSuccess('runtime-cli', result)).toThrow(diagnostic)
  })

  test('the node executable is resolved to an absolute path once, not searched per spawn', () => {
    const node = nodeExecutable()
    expect(isAbsolute(node)).toBeTrue()
    expect(existsSync(node)).toBeTrue()
    expect(nodeExecutable()).toBe(node)
  })

  test('a phase that expects a refusal reads the exit status, not an undefined one', async () => {
    // The gate tests assert exit 1. Before the boundary was bounded, a child
    // that never reached an exit reported `Expected: 1 / Received: undefined`
    // and threw the real OS error away.
    const refused = await runProcess(
      nodeExecutable(),
      ['-e', "process.stderr.write('generator_output_missing: text-to-3d');process.exit(1)"],
      { cwd: process.cwd(), timeoutMs: 10_000 },
    )
    requireProcessExit('content-check', refused, 1)
    expect(refused.stderr).toBe('generator_output_missing: text-to-3d')
    expect(() => requireProcessSuccess('content-check', refused)).toThrow(
      processFailureDiagnostic('content-check', refused),
    )

    const statusless = {
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('spawn node ENOENT'), { code: 'ENOENT' }),
    } as const
    expect(() => requireProcessExit('content-check', statusless, 1)).toThrow(
      processFailureDiagnostic('content-check', statusless),
    )
    expect(processFailureDiagnostic('content-check', statusless)).toContain('"errorCode":"ENOENT"')
  })

  test('the asynchronous harness bounds output and awaits a clean child close', async () => {
    const result = await runProcess(
      nodeExecutable(),
      ['-e', "process.stdout.write(process.env.KEI_PROCESS_PROBE + '\\n' + '\u20ac'.repeat(32 * 1024))"],
      {
        cwd: process.cwd(),
        env: { ...process.env, KEI_PROCESS_PROBE: 'probe-ok' },
        timeoutMs: 10_000,
      },
    )

    requireProcessSuccess('bounded-output', result)
    expect(result.stdout.startsWith('probe-ok\n')).toBeTrue()
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(64 * 1024)
    expect(result.stdout).not.toContain('\uFFFD')
    expect(result.stderr).toBe('')
  })

  test('a timeout kills the complete child process tree before it resolves', async () => {
    const source = [
      "const {spawn}=require('node:child_process')",
      "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})",
      "process.stdout.write(JSON.stringify({parent:process.pid,child:child.pid})+'\\n')",
      'setInterval(()=>{},1000)',
    ].join(';')
    const result = await runProcess(nodeExecutable(), ['-e', source], {
      cwd: process.cwd(),
      timeoutMs: 500,
    })

    const diagnostic = JSON.parse(processFailureDiagnostic('timeout-tree', result)) as {
      readonly errorCode?: unknown
    }
    expect(diagnostic.errorCode).toBe('ETIMEDOUT')
    const pids = JSON.parse(result.stdout.trim()) as { readonly parent: number; readonly child: number }

    expect(isAlive(pids.parent)).toBeFalse()
    expect(isAlive(pids.child)).toBeFalse()
  })

  test('a hung tree terminator reaches a bounded fallback before the harness resolves', async () => {
    const started = Date.now()
    const result = await runProcess(
      nodeExecutable(),
      ['-e', "process.stdout.write(String(process.pid));setInterval(()=>{},1000)"],
      {
        cwd: process.cwd(),
        timeoutMs: 100,
        terminationTimeoutMs: 150,
        terminate: async () => await new Promise<void>(() => {}),
      },
    )
    const elapsed = Date.now() - started
    const diagnostic = JSON.parse(processFailureDiagnostic('hung-terminator', result)) as {
      readonly errorCode?: unknown
    }
    expect(diagnostic.errorCode).toBe('ETERMINATE')
    expect(elapsed).toBeLessThan(1_500)

    const pid = Number(result.stdout)
    // The fallback contract is stronger than eventual cleanup: callers may
    // start the next phase as soon as runProcess resolves, so the PID must
    // already be gone at this boundary.
    expect(isAlive(pid)).toBeFalse()
  })
})
