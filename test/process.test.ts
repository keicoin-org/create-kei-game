import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  TERMINATION_BUDGET_MS,
  classifyOwnedDescendants,
  ownedDescendants,
  parseProcessTable,
  parseWmicProcessTable,
  processFailureDiagnostic,
  requireProcessSuccess,
  runProcess,
  safeOsMessage,
} from './process.js'

setDefaultTimeout(180_000)

const roots: string[] = []
const COOPERATIVE_CLEANUP_TIMEOUT_MS = 5_000

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

afterAll(async () => {
  // A stale numeric PID is not an identity, so teardown never signals one.
  // Every probe instead watches its unique stop marker and exits itself. This
  // also cleans a tree left behind by an assertion that failed before the
  // harness returned, without risking a recycled unrelated process.
  const recordedPids = new Set<number>()
  for (const root of roots) {
    const recordPath = join(root, 'pids.json')
    try {
      writeFileSync(`${recordPath}.stop`, '')
    } catch {
      // A test may have removed its temporary root before suite teardown.
    }
    try {
      const recorded = JSON.parse(readFileSync(recordPath, 'utf8')) as {
        readonly parent?: unknown
        readonly descendant?: unknown
      }
      for (const pid of [recorded.parent, recorded.descendant]) {
        if (
          typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 4 && pid !== process.pid
        ) recordedPids.add(pid)
      }
    } catch {
      // The child may have failed before recording its identities.
    }
  }

  const deadline = Date.now() + COOPERATIVE_CLEANUP_TIMEOUT_MS
  let survivors = [...recordedPids].filter(isAlive)
  while (survivors.length > 0 && Date.now() < deadline) {
    await new Promise<void>((resolve) => { setTimeout(resolve, 25) })
    survivors = survivors.filter(isAlive)
  }
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  if (survivors.length > 0) {
    throw new Error(`process probe cleanup did not converge for pids ${survivors.join(',')}`)
  }
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
const DESCENDANT_WORKER_SOURCE = [
  "const {existsSync}=require('node:fs')",
  'const stop=process.argv[1]',
  'setInterval(()=>{if(existsSync(stop))process.exit(0)},25)',
].join(';')

const DESCENDANT_SOURCE = [
  "const {spawn}=require('node:child_process')",
  "const {existsSync,writeFileSync}=require('node:fs')",
  'const record=process.argv[1]',
  "const stop=record+'.stop'",
  `const descendant=spawn(process.execPath,['-e',${JSON.stringify(DESCENDANT_WORKER_SOURCE)},stop],` +
    "{stdio:'ignore',detached:process.platform==='win32'})",
  'descendant.unref()',
  'writeFileSync(record,JSON.stringify({parent:process.pid,descendant:descendant.pid}))',
  "process.stdout.write('ready')",
  'setInterval(()=>{if(existsSync(stop))process.exit(0)},25)',
].join(';')

interface TreePids {
  readonly parent: number
  readonly descendant: number
}

function readTreePids(recordPath: string): TreePids {
  return JSON.parse(readFileSync(recordPath, 'utf8')) as TreePids
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

  test('a terminator that resolves without acting cannot settle while the tree lives', async () => {
    const node = requireNode()
    const recordPath = join(temporaryRoot(), 'pids.json')
    const observed: { parentAlive?: boolean; descendantAlive?: boolean } = {}

    const started = Date.now()
    const result = await runProcess(node, ['-e', DESCENDANT_SOURCE, recordPath], {
      cwd: process.cwd(),
      timeoutMs: 1_500,
      // Far past the elapsed assertion below, so a pass can only come from the
      // resolved claim being independently confirmed, never from the deadline.
      terminationTimeoutMs: 30_000,
      terminate: async () => {
        const pids = readTreePids(recordPath)
        observed.parentAlive = isAlive(pids.parent)
        observed.descendantAlive = isAlive(pids.descendant)
        // Resolves immediately: a false claim of complete termination.
      },
    })
    const elapsed = Date.now() - started

    // The defect's precondition: the whole tree was live when the terminator
    // claimed success.
    expect(observed.parentAlive).toBeTrue()
    expect(observed.descendantAlive).toBeTrue()

    const diagnostic = JSON.parse(processFailureDiagnostic('no-op-terminator', result)) as {
      readonly errorCode?: unknown
    }
    expect(diagnostic.errorCode).toBe('ETIMEDOUT')
    expect(elapsed).toBeLessThan(1_500 + TERMINATION_BUDGET_MS)

    const pids = readTreePids(recordPath)
    expect(isAlive(pids.parent)).toBeFalse()
    expect(isAlive(pids.descendant)).toBeFalse()
  })

  test('a terminator that kills only the parent and resolves cannot settle while its descendant lives', async () => {
    const node = requireNode()
    const recordPath = join(temporaryRoot(), 'pids.json')
    const observed: { parentAlive?: boolean; descendantAlive?: boolean } = {}

    const started = Date.now()
    const result = await runProcess(node, ['-e', DESCENDANT_SOURCE, recordPath], {
      cwd: process.cwd(),
      timeoutMs: 1_500,
      terminationTimeoutMs: 30_000,
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
        observed.parentAlive = isAlive(pids.parent)
        observed.descendantAlive = isAlive(pids.descendant)
        // Resolves here: claims completion with the descendant still running.
      },
    })
    const elapsed = Date.now() - started

    expect(observed.parentAlive).toBeFalse()
    expect(observed.descendantAlive).toBeTrue()

    const diagnostic = JSON.parse(processFailureDiagnostic('parent-only-terminator', result)) as {
      readonly errorCode?: unknown
    }
    expect(diagnostic.errorCode).toBe('ETIMEDOUT')
    expect(elapsed).toBeLessThan(1_500 + TERMINATION_BUDGET_MS)

    const pids = readTreePids(recordPath)
    expect(isAlive(pids.parent)).toBeFalse()
    expect(isAlive(pids.descendant)).toBeFalse()
  })

  test('terminator rejection text and run sentinels never reach a diagnostic', async () => {
    const node = requireNode()
    const recordPath = join(temporaryRoot(), 'pids.json')
    const rejectionSentinel = 'KEI_PRIVATE_REJECTION_9d41f7'
    const environmentSentinel = 'KEI_PRIVATE_ENV_9d41f7'
    const inputSentinel = 'KEI_PRIVATE_INPUT_9d41f7'
    const commandSentinel = 'KEI_PRIVATE_COMMAND_9d41f7'

    const result = await runProcess(node, ['-e', DESCENDANT_SOURCE, recordPath, commandSentinel], {
      cwd: process.cwd(),
      env: { ...process.env, KEI_PROCESS_SENTINEL: environmentSentinel },
      input: inputSentinel,
      timeoutMs: 1_500,
      terminationTimeoutMs: 30_000,
      terminate: async () => {
        throw new Error(`refused ${rejectionSentinel} over ${environmentSentinel} ${commandSentinel}`)
      },
    })

    expect(result.error?.code).toBe('ETERMINATE')
    // Exact stable prose: the callback's rejection text is replaced, not scrubbed.
    expect(result.error?.message).toBe('configured process-tree termination failed')
    const diagnostic = processFailureDiagnostic('sentinel-redaction', result)
    for (const sentinel of [rejectionSentinel, environmentSentinel, inputSentinel, commandSentinel]) {
      expect(result.error?.message).not.toContain(sentinel)
      expect(diagnostic).not.toContain(sentinel)
    }

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

describe('Windows owned-tree ownership graph', () => {
  // The harness recorded Date.now() = 1000 just before spawning root PID 100.
  const SPAWNED_AT = 1_000

  function tableOf(rows: readonly (readonly [pid: number, parent: number, created: number])[]) {
    return parseProcessTable(rows.map(([pid, parent, created]) => `${pid} ${parent} ${created}`).join('\n'))
  }

  function generation(createdAtMs: number, knownAliveAtMs: number) {
    return { createdAtMs, knownAliveAtMs }
  }

  test('a live root owns children created at or after it, however late, and none created before it', () => {
    const table = tableOf([
      [100, 4, 1_010], // the root itself, still running
      [200, 100, 1_500], // owned child
      [300, 100, 500], // survivor from an older use of PID 100, never owned
      [400, 200, 1_600], // owned grandchild
      [500, 200, 900], // grandchild-position PID predating its parent: recycled
      [600, 100, 9_000], // late child long after spawn: owned while the root lives
    ])
    expect(ownedDescendants(table, {
      root: 100, spawnedAtMs: SPAWNED_AT, rootKnownAliveAtMs: 2_000,
    }))
      .toEqual([200, 600, 400])
  })

  test('a dead unrecycled root still owns its orphans from the recorded spawn instant', () => {
    const table = tableOf([
      [100, 4, 1_010], // the original root still has a table entry while exiting
      [200, 100, 1_500], // orphan still listing the dead root as its parent
      [300, 100, 500], // unrelated survivor from an older use of PID 100
      [400, 200, 1_600], // the orphan's own child
    ])
    expect(ownedDescendants(table, {
      root: 100,
      spawnedAtMs: SPAWNED_AT,
      rootGeneration: generation(1_010, 2_000),
    }))
      .toEqual([200, 400])
  })

  test('an absent root still owns a genuine late child inside its captured generation', () => {
    const table = tableOf([
      [200, 100, 2_500], // created late, but before the root's proven-alive boundary
      [400, 200, 2_600],
    ])
    expect(classifyOwnedDescendants(table, {
      root: 100,
      spawnedAtMs: SPAWNED_AT,
      rootGeneration: generation(1_010, 3_000),
    })).toEqual({ descendants: [200, 400], ambiguous: false })
  })

  test('an absent root fails closed for a child outside its captured generation', () => {
    const table = tableOf([
      // This could be an original orphan or a child of a successor that already
      // exited. Creation times in this one snapshot cannot distinguish them.
      [200, 100, 2_500],
    ])
    expect(classifyOwnedDescendants(table, {
      root: 100,
      spawnedAtMs: SPAWNED_AT,
      rootGeneration: generation(1_010, 2_000),
    })).toEqual({ descendants: [], ambiguous: true })
  })

  test("one root-PID reuse keeps proven orphans and never touches the successor's children", () => {
    const table = tableOf([
      [100, 4, 5_000], // unrelated process now holding the dead root's PID
      [200, 100, 1_500], // original orphan, created before the recycled process
      [600, 100, 6_000], // the recycled process' own child
      [700, 600, 6_100], // ...whose subtree must never even be traversed
      [210, 200, 1_800], // the orphan's child, still owned
    ])
    const owned = ownedDescendants(table, {
      root: 100,
      spawnedAtMs: SPAWNED_AT,
      rootGeneration: generation(1_010, 2_000),
    })
    expect(owned).toEqual([200, 210])
    expect(owned).not.toContain(600)
    expect(owned).not.toContain(700)
  })

  test('the captured interval excludes an unproven gap before the current holder', () => {
    const table = tableOf([
      [100, 4, 5_000], // recycled holder of the dead root's PID
      [200, 100, 1_010], // exact generation floor: owned
      [300, 100, 1_009], // before the root generation: not owned
      [400, 100, 5_000], // current holder's child: not owned
      [500, 100, 4_999], // could belong to any intervening PID generation
    ])
    expect(classifyOwnedDescendants(table, {
      root: 100,
      spawnedAtMs: SPAWNED_AT,
      rootGeneration: generation(1_010, 2_000),
    })).toEqual({ descendants: [200], ambiguous: true })
  })

  test('multiple root-PID reuses never select an intervening holder\'s child', () => {
    const table = tableOf([
      [100, 4, 5_000], // current successor B
      [600, 100, 3_500], // child of vanished successor A, which held PID 100 at 3000
    ])
    expect(classifyOwnedDescendants(table, {
      root: 100,
      spawnedAtMs: SPAWNED_AT,
      rootGeneration: generation(1_010, 2_000),
    })).toEqual({ descendants: [], ambiguous: true })
  })

  test('a root listed under its own recorded instant keeps its children after the handle exits', () => {
    // The snapshot that catches a root exiting mid-read still lists it, under
    // the very instant an earlier snapshot recorded while it was alive.
    const table = tableOf([
      [100, 4, 1_010],
      [200, 100, 1_500], // a child, and so created after the root by definition
    ])

    // The known-alive boundary proves the entry predates any possible
    // successor, so the root resolves as itself.
    expect(ownedDescendants(table, {
      root: 100, spawnedAtMs: SPAWNED_AT, rootKnownAliveAtMs: 2_000,
    }))
      .toEqual([200])
    // Sampled after the read instead, the recorded instant is what still
    // identifies the entry as the root rather than a successor.
    expect(ownedDescendants(table, {
      root: 100,
      spawnedAtMs: SPAWNED_AT,
      rootGeneration: generation(1_010, 2_000),
    })).toEqual([200])
    // The boundary also works when no earlier table captured the exact root
    // creation instant, as with a parent-only custom terminator.
    expect(ownedDescendants(table, {
      root: 100, spawnedAtMs: SPAWNED_AT, rootKnownAliveAtMs: 2_000,
    })).toEqual([200])
  })

  test('a recorded root instant still exposes a successor holding the same PID', () => {
    const table = tableOf([
      [100, 4, 5_000], // a different process: the instant does not match
      [200, 100, 1_500], // the original root's orphan
      [600, 100, 6_000], // the successor's own child
    ])
    expect(ownedDescendants(table, {
      root: 100, spawnedAtMs: SPAWNED_AT,
      rootGeneration: generation(1_010, 2_000),
    })).toEqual([200])
  })

  test('a PID holder created at the known-alive boundary is treated as a successor', () => {
    const table = tableOf([
      [100, 4, 2_000], // cannot be the root that was already alive at this instant
      [200, 100, 1_999], // original orphan immediately below the ceiling
      [300, 100, 2_000], // ambiguous boundary child: never touched
      [400, 100, 2_001], // successor child
    ])
    expect(ownedDescendants(table, {
      root: 100,
      spawnedAtMs: SPAWNED_AT,
      rootGeneration: generation(1_010, 2_000),
    })).toEqual([200])
  })

  test('a truncated process table is rejected instead of narrowing ownership', () => {
    expect(() => parseProcessTable('100 4 1010\n200 100 1500', true))
      .toThrow('the Windows process table exceeded its bounded size')
    expect(() => parseProcessTable('not a process table'))
      .toThrow('the Windows process table contained no valid records')
    expect(() => parseProcessTable('100 4 0'))
      .toThrow('the Windows process table contained an invalid record')
    expect(() => parseProcessTable('100 4 1010\nmalformed owned row\n200 100 1500'))
      .toThrow('the Windows process table contained an invalid record')
  })

  test('WMIC timestamps are normalized to epoch milliseconds without accepting malformed output', () => {
    const table = parseWmicProcessTable([
      'CreationDate=20260804123045.123456-240',
      'ParentProcessId=100',
      'ProcessId=200',
    ].join('\r\n\r\n'))
    expect(table.parents.get(200)).toBe(100)
    expect(table.created.get(200)).toBe(Date.UTC(2026, 7, 4, 16, 30, 45, 123))
    expect(() => parseWmicProcessTable('CreationDate=bad\nParentProcessId=1\nProcessId=2'))
      .toThrow('the Windows process table contained an invalid creation time')
    expect(() => parseWmicProcessTable([
      'CreationDate=20260804123045.123456-240',
      'ParentProcessId=100',
      'ProcessId=200',
      'malformed owned record',
      'CreationDate=20260804123046.123456-240',
      'ParentProcessId=200',
      'ProcessId=300',
    ].join('\r\n'))).toThrow('the Windows process table contained an invalid record')
  })

  test('repeated snapshots reach late children through revalidated intermediaries and converge', () => {
    // Snapshot 1: the live root and one descendant.
    const first = tableOf([
      [100, 4, 1_010],
      [200, 100, 1_500],
    ])
    const priorOwned = new Map<number, ReturnType<typeof generation>>()
    const firstPass = ownedDescendants(first, {
      root: 100, spawnedAtMs: SPAWNED_AT, rootKnownAliveAtMs: 2_000,
    })
    expect(firstPass).toEqual([200])
    for (const pid of firstPass) priorOwned.set(pid, generation(first.created.get(pid)!, 2_000))

    // Snapshot 2, after the first signals: the intermediary survived under the
    // exact recorded creation identity and exposed a child that did not exist in
    // snapshot 1. The fresh identity match makes both re-signalling and traversal
    // safe; a missing/recycled intermediary is covered by fail-closed fixtures.
    const second = tableOf([
      [200, 100, 1_500], // the same owned intermediary survived the first signal
      [210, 200, 1_990],
    ])
    const secondPass = ownedDescendants(second, {
      root: 100, spawnedAtMs: SPAWNED_AT,
      rootGeneration: generation(1_010, 2_000), priorOwned,
    })
    expect(secondPass).toEqual([200, 210])
    for (const pid of secondPass) {
      priorOwned.set(pid, generation(second.created.get(pid)!, 2_000))
    }

    // Snapshot 3: the dead descendant's PID has been recycled by an unrelated
    // process with a child of its own. Nothing is owned: the sweep converged
    // without aiming at the recycled tree.
    const third = tableOf([
      [200, 4, 9_000],
      [220, 200, 9_100],
    ])
    expect(ownedDescendants(third, {
      root: 100, spawnedAtMs: SPAWNED_AT,
      rootGeneration: generation(1_010, 2_000), priorOwned,
    })).toEqual([])
  })

  test('an unrecorded child of a vanished prior holder is also ambiguous', () => {
    const table = tableOf([
      [210, 200, 1_990],
    ])
    expect(classifyOwnedDescendants(table, {
      root: 100,
      spawnedAtMs: SPAWNED_AT,
      rootGeneration: generation(1_010, 2_000),
      priorOwned: new Map([[200, generation(1_500, 1_900)]]),
    })).toEqual({ descendants: [], ambiguous: true })
  })
})
