import { describe, expect, test } from 'bun:test'

import { processFailureDiagnostic, requireProcessSuccess, runProcess } from './process.js'

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

  test('the asynchronous harness bounds output and awaits a clean child close', async () => {
    const node = Bun.which('node')
    expect(node).not.toBeNull()
    if (node === null) throw new Error('Node.js executable is unavailable')

    const result = await runProcess(
      node,
      ['-e', "process.stdout.write(process.env.KEI_PROCESS_PROBE + '\\n' + 'x'.repeat(96 * 1024))"],
      {
        cwd: process.cwd(),
        env: { ...process.env, KEI_PROCESS_PROBE: 'probe-ok' },
        timeoutMs: 10_000,
      },
    )

    requireProcessSuccess('bounded-output', result)
    expect(result.stdout.startsWith('probe-ok\n')).toBeTrue()
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(64 * 1024)
    expect(result.stderr).toBe('')
  })

  test('a timeout kills the complete child process tree before it resolves', async () => {
    const node = Bun.which('node')
    expect(node).not.toBeNull()
    if (node === null) throw new Error('Node.js executable is unavailable')

    const source = [
      "const {spawn}=require('node:child_process')",
      "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})",
      "process.stdout.write(JSON.stringify({parent:process.pid,child:child.pid})+'\\n')",
      'setInterval(()=>{},1000)',
    ].join(';')
    const result = await runProcess(node, ['-e', source], {
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

  test('a hung tree terminator reaches a bounded direct-kill fallback', async () => {
    const node = Bun.which('node')
    expect(node).not.toBeNull()
    if (node === null) throw new Error('Node.js executable is unavailable')

    const started = Date.now()
    const result = await runProcess(
      node,
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
    const deadline = Date.now() + 2_000
    while (isAlive(pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(isAlive(pid)).toBeFalse()
  })
})
