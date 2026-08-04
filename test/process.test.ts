import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  TERMINATION_BUDGET_MS,
  processFailureDiagnostic,
  requireProcessSuccess,
  runProcess,
  safeOsMessage,
} from './process.js'

setDefaultTimeout(60_000)

const roots: string[] = []
const ownedPids: number[] = []

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  if (process.platform !== 'linux') return true
  // A SIGKILLed descendant can linger as an unreaped zombie that kill(pid, 0)
  // still reports. A zombie runs no code and holds no ports, so only genuinely
  // running states count as alive; this mirrors the harness' own distinction.
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]
    return state !== 'Z' && state !== 'X' && state !== 'x'
  } catch {
    return false // It was reaped between the signal probe and this read.
  }
}

afterAll(() => {
  // Nothing this suite spawned may outlive it, including a descendant left
  // behind by an assertion that failed before the harness returned.
  for (const pid of ownedPids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already reaped by the harness under test.
    }
  }
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kei-process-'))
  roots.push(root)
  return root
}

/**
 * A child that records its own PID plus one descendant built to outlive it.
 * Windows only keeps a descendant running past its parent's death when that
 * descendant was detached; on POSIX the descendant has to stay in the child's
 * process group, so detaching there would take it out of the owned tree.
 */
const DESCENDANT_SOURCE = [
  "const {spawn}=require('node:child_process')",
  "const {writeFileSync}=require('node:fs')",
  "const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)']," +
    "{stdio:'ignore',detached:process.platform==='win32'})",
  'descendant.unref()',
  'writeFileSync(process.argv[1],JSON.stringify({parent:process.pid,descendant:descendant.pid}))',
  "process.stdout.write('ready')",
  'setInterval(()=>{},1000)',
].join(';')

interface TreePids {
  readonly parent: number
  readonly descendant: number
}

function readTreePids(recordPath: string): TreePids {
  const pids = JSON.parse(readFileSync(recordPath, 'utf8')) as TreePids
  ownedPids.push(pids.parent, pids.descendant)
  return pids
}

function requireNode(): string {
  const node = Bun.which('node')
  expect(node).not.toBeNull()
  if (node === null) throw new Error('Node.js executable is unavailable')
  return node
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

  test('a missing executable is reported without its absolute path or private segments', async () => {
    const secret = 'kei-private-9d41f7'
    const executable = join(temporaryRoot(), secret, 'absent-harness-binary.exe')

    const result = await runProcess(executable, [], { cwd: process.cwd(), timeoutMs: 10_000 })
    expect(result.error).toBeDefined()

    const diagnostic = processFailureDiagnostic('missing-executable', result)
    const parsed = JSON.parse(diagnostic) as { readonly message?: unknown }
    expect(parsed).toMatchObject({
      event: 'test_process_failed',
      phase: 'missing-executable',
      status: null,
      signal: null,
      errorCode: 'ENOENT',
    })
    expect(typeof parsed.message).toBe('string')
    expect(String(parsed.message)).not.toMatch(/[\\/]/)
    expect(diagnostic).not.toContain(secret)
    expect(diagnostic).not.toContain('absent-harness-binary')
    expect(diagnostic).not.toContain(tmpdir())
  })

  test('path-bearing OS messages are withheld on either platform shape', () => {
    const secret = 'kei-private-3ab882'
    const posix = Object.assign(new Error(`spawn /home/runner/${secret}/game-harness ENOENT`), {
      code: 'ENOENT',
    })
    const diagnostic = processFailureDiagnostic('posix-path', {
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      error: posix,
    })
    expect(JSON.parse(diagnostic)).toMatchObject({ errorCode: 'ENOENT' })
    expect(diagnostic).not.toContain(secret)
    expect(diagnostic).not.toContain('/home/runner')

    // A Windows path containing spaces spreads its segments over several
    // tokens, so no single segment may survive either.
    const spaced = safeOsMessage(`spawn C:\\Program Files\\${secret}\\harness.exe ENOENT`)
    expect(spaced).not.toContain(secret)
    expect(spaced).not.toContain('Files')
    expect(spaced).not.toContain('C:')

    // A message with no path at all keeps its safe operating-system text.
    expect(safeOsMessage('resource temporarily unavailable')).toBe('resource temporarily unavailable')
  })

  test('the asynchronous harness bounds output and awaits a clean child close', async () => {
    const node = requireNode()

    const result = await runProcess(
      node,
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
    const node = requireNode()
    const recordPath = join(temporaryRoot(), 'pids.json')

    const started = Date.now()
    const result = await runProcess(node, ['-e', DESCENDANT_SOURCE, recordPath], {
      cwd: process.cwd(),
      timeoutMs: 1_500,
    })
    const elapsed = Date.now() - started

    const diagnostic = JSON.parse(processFailureDiagnostic('timeout-tree', result)) as {
      readonly errorCode?: unknown
    }
    expect(diagnostic.errorCode).toBe('ETIMEDOUT')
    expect(elapsed).toBeLessThan(1_500 + TERMINATION_BUDGET_MS)

    const pids = readTreePids(recordPath)
    expect(isAlive(pids.parent)).toBeFalse()
    expect(isAlive(pids.descendant)).toBeFalse()
  })

  test('a terminator that kills only the parent and hangs still loses its descendant to the fallback', async () => {
    const node = requireNode()
    const recordPath = join(temporaryRoot(), 'pids.json')
    const observed: { parentAlive?: boolean; descendantAlive?: boolean; descendant?: number } = {}

    const started = Date.now()
    const result = await runProcess(node, ['-e', DESCENDANT_SOURCE, recordPath], {
      cwd: process.cwd(),
      timeoutMs: 1_500,
      terminationTimeoutMs: 250,
      terminate: async (child) => {
        child.kill('SIGKILL')
        await new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve()
            return
          }
          const timer = setTimeout(resolve, 2_000)
          child.once('exit', () => { clearTimeout(timer); resolve() })
        })
        const pids = readTreePids(recordPath)
        observed.descendant = pids.descendant
        observed.parentAlive = isAlive(pids.parent)
        observed.descendantAlive = isAlive(pids.descendant)
        // The configured terminator never completes the tree.
        await new Promise<void>(() => {})
      },
    })
    const elapsed = Date.now() - started

    // The defect's precondition: the direct child is gone while the descendant
    // this harness owns is still running.
    expect(observed.parentAlive).toBeFalse()
    expect(observed.descendantAlive).toBeTrue()

    const diagnostic = JSON.parse(processFailureDiagnostic('partial-terminator', result)) as {
      readonly errorCode?: unknown
    }
    expect(diagnostic.errorCode).toBe('ETERMINATE')
    expect(elapsed).toBeLessThan(1_500 + 250 + TERMINATION_BUDGET_MS)

    // Immediate on purpose. A caller may start its next phase as soon as
    // runProcess resolves, so eventual cleanup would not be a fix.
    expect(isAlive(observed.descendant!)).toBeFalse()
  })

  test('a rejected terminator reaches the same bounded fallback', async () => {
    const node = requireNode()
    const recordPath = join(temporaryRoot(), 'pids.json')

    const started = Date.now()
    const result = await runProcess(node, ['-e', DESCENDANT_SOURCE, recordPath], {
      cwd: process.cwd(),
      timeoutMs: 1_500,
      terminationTimeoutMs: 30_000,
      terminate: async () => {
        throw new Error('injected terminator refused to run')
      },
    })
    const elapsed = Date.now() - started

    const diagnostic = JSON.parse(processFailureDiagnostic('rejected-terminator', result)) as {
      readonly errorCode?: unknown
    }
    expect(diagnostic.errorCode).toBe('ETERMINATE')
    // The rejection must not wait out the secondary deadline it bypassed.
    expect(elapsed).toBeLessThan(1_500 + TERMINATION_BUDGET_MS)

    const pids = readTreePids(recordPath)
    expect(isAlive(pids.parent)).toBeFalse()
    expect(isAlive(pids.descendant)).toBeFalse()
  })
})
