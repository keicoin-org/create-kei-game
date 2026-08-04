import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'

const OUTPUT_LIMIT_BYTES = 64 * 1024
const PROCESS_TABLE_LIMIT_BYTES = 4 * 1024 * 1024
const DIAGNOSTIC_LIMIT = 240
// A cold PowerShell start plus first use of the CIM module was measured at
// 2.6s, and over 4s inside a loaded test runner, so this leaves real headroom.
const PROCESS_TABLE_TIMEOUT_MS = 12_000
const EXIT_CONFIRM_TIMEOUT_MS = 2_000
const LIVENESS_POLL_MS = 25
const CLOSE_FLUSH_TIMEOUT_MS = 2_000
const TERMINATION_TIMEOUT_MS = 5_000

/**
 * Ceiling for one bounded owned-tree termination attempt plus the terminated
 * child's final stdio flush. Callers assert elapsed time against this instead of
 * a hand-picked number.
 */
export const TERMINATION_BUDGET_MS =
  PROCESS_TABLE_TIMEOUT_MS + EXIT_CONFIRM_TIMEOUT_MS + CLOSE_FLUSH_TIMEOUT_MS

export interface ProcessResult {
  readonly status: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: Error & { readonly code?: unknown }
}

export interface ProcessOptions {
  readonly cwd: string
  readonly env?: NodeJS.ProcessEnv
  readonly input?: string
  readonly timeoutMs: number
  /**
   * Test seam for proving the secondary termination deadline. A terminator that
   * hangs, rejects, or kills only the direct child must still reach the real
   * bounded fallback before `runProcess` resolves.
   */
  readonly terminate?: (child: ChildProcessWithoutNullStreams) => Promise<void>
  readonly terminationTimeoutMs?: number
}

function killDirectly(child: ChildProcessWithoutNullStreams): void {
  try {
    child.kill('SIGKILL')
  } catch {
    // It exited between the state check and the kill request.
  }
}

function killPid(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Already gone, or beyond this user's reach; liveness is confirmed below.
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but is out of reach, which is not death.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function groupAlive(group: number): boolean {
  try {
    process.kill(-group, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// Zombie and dead states run no code and hold no ports or descriptors, so they
// cannot violate the no-live-work contract; everything else is treated as live.
const REAPED_PROC_STATES = new Set(['Z', 'X', 'x'])

/**
 * Whether any member of `group` is genuinely running. A SIGKILLed descendant
 * whose reaper is slow or absent stays a zombie that `kill(-group, 0)` keeps
 * reporting, so on Linux the per-process /proc state decides instead. Returns
 * undefined where /proc is unavailable; the caller must then stay conservative
 * and keep treating the signallable group as live.
 */
function groupHasRunningMember(group: number): boolean | undefined {
  let entries: readonly string[]
  try {
    entries = readdirSync('/proc')
  } catch {
    return undefined
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    let stat: string
    try {
      stat = readFileSync(`/proc/${entry}/stat`, 'utf8')
    } catch {
      continue // It exited between the directory listing and this read.
    }
    // "pid (comm) state ppid pgrp ..." — comm may itself contain ") ", so the
    // fields are taken after the last closing parenthesis. comm never leaves
    // this function, so no process name can reach a diagnostic.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    if (Number(fields[2]) === group && !REAPED_PROC_STATES.has(fields[0]!)) return true
  }
  return false
}

async function pause(ms: number): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, ms) })
}

async function waitForProcessExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return await new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (exited: boolean): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      child.off('exit', onExit)
      resolve(exited)
    }
    const onExit = (): void => finish(true)
    timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', onExit)
    // Do not turn an exit between the fast-path check and subscription into a
    // false timeout. This is the same race the generated restart proof guards.
    if (child.exitCode !== null || child.signalCode !== null) finish(true)
  })
}

async function waitForPidsGone(pids: readonly number[], timeoutMs: number): Promise<boolean> {
  if (pids.length === 0) return true
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const alive = pids.filter(pidAlive)
    if (alive.length === 0) return true
    if (Date.now() >= deadline) return false
    // Deepest first: terminating a middle process would otherwise orphan the
    // level below it out of the parent chain this sweep walked.
    for (let index = alive.length - 1; index >= 0; index -= 1) killPid(alive[index]!)
    await pause(LIVENESS_POLL_MS)
  }
}

async function waitForGroupGone(group: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (!groupAlive(group)) return true
    if (groupHasRunningMember(group) === false) return true
    if (Date.now() >= deadline) return false
    try {
      process.kill(-group, 'SIGKILL')
    } catch {
      // The group emptied between the liveness check and the signal.
    }
    await pause(LIVENESS_POLL_MS)
  }
}

interface ProcessTable {
  readonly children: ReadonlyMap<number, readonly number[]>
  readonly parents: ReadonlyMap<number, number>
  readonly created: ReadonlyMap<number, number>
}

// Only numeric pid/parent/creation triples cross this boundary, so no path,
// command line, or environment text from an unrelated process can reach a
// diagnostic. The creation instant (Unix milliseconds, same clock as Date.now)
// is what lets the sweep reject a recycled PID.
const PROCESS_TABLE_SCRIPT =
  'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate | ' +
  'ForEach-Object { $t = 0; if ($_.CreationDate) ' +
  '{ $t = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }; ' +
  '"$($_.ProcessId) $($_.ParentProcessId) $t" }'

function parseProcessTable(text: string): ProcessTable {
  const children = new Map<number, number[]>()
  const parents = new Map<number, number>()
  const created = new Map<number, number>()
  for (const line of text.split(/\r?\n/)) {
    const triple = /^(\d+) (\d+) (\d+)$/.exec(line.trim())
    if (triple === null) continue
    const pid = Number(triple[1])
    const parent = Number(triple[2])
    parents.set(pid, parent)
    created.set(pid, Number(triple[3]))
    const siblings = children.get(parent)
    if (siblings === undefined) children.set(parent, [pid])
    else siblings.push(pid)
  }
  return { children, parents, created }
}

async function readWindowsProcessTable(): Promise<ProcessTable> {
  // -EncodedCommand keeps the script a single argv token, so no quoting of the
  // caller's data is involved.
  const encoded = Buffer.from(PROCESS_TABLE_SCRIPT, 'utf16le').toString('base64')
  const text = await new Promise<string>((resolve, reject) => {
    let reader: ChildProcessWithoutNullStreams
    try {
      reader = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded,
      ], { windowsHide: true, stdio: 'pipe' })
    } catch {
      reject(new Error('the Windows process table reader could not be started'))
      return
    }

    const table = new BoundedOutput(PROCESS_TABLE_LIMIT_BYTES)
    let settled = false
    const finish = (complete: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      complete()
    }
    const timer = setTimeout(() => finish(() => {
      killDirectly(reader)
      reject(new Error('the Windows process table was not read within its bounded budget'))
    }), PROCESS_TABLE_TIMEOUT_MS)

    reader.stdout.on('data', (chunk: Buffer | string) => { table.append(chunk) })
    // CLIXML progress records land on stderr and are never reported.
    reader.stderr.resume()
    reader.stdin.on('error', () => {
      // The reader can exit before its stdin is closed.
    })
    reader.once('error', () => finish(() => {
      reject(new Error('the Windows process table reader failed to run'))
    }))
    reader.once('close', (status) => finish(() => {
      if (status !== 0) reject(new Error(`the Windows process table reader exited ${String(status)}`))
      // A truncated table could hide a live descendant, so it must fail the
      // sweep instead of silently narrowing it.
      else if (table.truncated) reject(new Error('the Windows process table exceeded its bounded size'))
      else resolve(table.text())
    }))
    reader.stdin.end()
  })
  return parseProcessTable(text)
}

/** Keeps a recycled root PID from ever aiming a sweep at this test runner. */
function ownAncestry(parents: ReadonlyMap<number, number>): ReadonlySet<number> {
  const protectedPids = new Set<number>([process.pid])
  let walk = parents.get(process.pid)
  while (walk !== undefined && walk > 4 && !protectedPids.has(walk)) {
    protectedPids.add(walk)
    walk = parents.get(walk)
  }
  return protectedPids
}

/**
 * Breadth-first owned descendants of `root`, shallowest first. Windows recycles
 * PIDs quickly, so a candidate only counts as owned when it was created after
 * its parent — or, where the parent is already dead and so absent from the
 * table, after the instant the harness spawned the root. A recycled PID names
 * an older process and fails that ordering.
 */
function descendantsOf(table: ProcessTable, root: number, rootFloor: number): readonly number[] {
  const order: number[] = []
  const seen = new Set<number>([root])
  const queue = [{ pid: root, floor: rootFloor }]
  while (queue.length > 0) {
    const { pid: parent, floor } = queue.shift()!
    const parentFloor = table.created.get(parent) ?? floor
    for (const pid of table.children.get(parent) ?? []) {
      if (pid <= 4 || seen.has(pid)) continue
      if ((table.created.get(pid) ?? 0) < parentFloor) continue
      seen.add(pid)
      order.push(pid)
      queue.push({ pid, floor: parentFloor })
    }
  }
  return order
}

async function terminateWindowsTree(
  child: ChildProcessWithoutNullStreams,
  root: number,
  spawnedAtMs: number,
): Promise<void> {
  // Windows leaves a dead process' PID in its children's ParentProcessId, so the
  // owned tree stays reachable after a terminator killed only the direct child.
  // `taskkill /t` cannot do that: it refuses an already-exited root and so never
  // reaches the orphaned descendants.
  const table = await readWindowsProcessTable()
  const protectedPids = ownAncestry(table.parents)
  const descendants = descendantsOf(table, root, spawnedAtMs).filter((pid) => !protectedPids.has(pid))
  const rootAlive = child.exitCode === null && child.signalCode === null

  for (let index = descendants.length - 1; index >= 0; index -= 1) killPid(descendants[index]!)
  // A dead root's PID may already belong to an unrelated process, so the only
  // root ever signalled is the child handle this harness owns.
  if (rootAlive) killDirectly(child)

  const [exited, swept] = await Promise.all([
    waitForProcessExit(child, EXIT_CONFIRM_TIMEOUT_MS),
    waitForPidsGone(descendants, EXIT_CONFIRM_TIMEOUT_MS),
  ])
  if (!exited || !swept) {
    throw new Error('the owned process tree was still alive after bounded termination')
  }
}

async function terminatePosixTree(
  child: ChildProcessWithoutNullStreams,
  root: number,
): Promise<void> {
  // The child leads its own process group, and a group outlives its leader, so
  // one group signal still reaches descendants after a partial termination.
  try {
    process.kill(-root, 'SIGKILL')
  } catch {
    killDirectly(child)
  }
  const [exited, swept] = await Promise.all([
    waitForProcessExit(child, EXIT_CONFIRM_TIMEOUT_MS),
    waitForGroupGone(root, EXIT_CONFIRM_TIMEOUT_MS),
  ])
  if (!exited || !swept) {
    throw new Error('the owned process group was still alive after bounded termination')
  }
}

/**
 * Kills the whole owned tree and confirms it is gone. Unlike a direct kill this
 * does not short-circuit once the direct child has exited, because that is
 * precisely the state a partial terminator leaves behind. `spawnedAtMs` is the
 * Date.now() instant just before the root was spawned; it anchors the Windows
 * PID-recycling guard, and omitting it disables only that guard.
 */
export async function terminateProcessTree(
  child: ChildProcessWithoutNullStreams,
  spawnedAtMs = 0,
): Promise<void> {
  const root = child.pid
  if (root === undefined) return
  if (process.platform === 'win32') await terminateWindowsTree(child, root, spawnedAtMs)
  else await terminatePosixTree(child, root)
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// A token holding a path separator or a drive prefix can name a private
// directory, and a path with spaces spreads its segments over several tokens.
const PATH_BEARING_TOKEN = /[\\/]|^[A-Za-z]:/
const WITHHELD_MESSAGE = 'os message withheld: it referenced a file-system path'

function boundedText(value: unknown, limit = DIAGNOSTIC_LIMIT): string {
  const text = normalizeText(value)
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

/**
 * Bounds an operating-system message and refuses to report one that carries a
 * file-system path. The whole message is replaced rather than patched, because
 * one segment of an absolute path is enough to disclose a private directory and
 * a truncated path would still leak its leading segments.
 */
export function safeOsMessage(value: unknown, limit = DIAGNOSTIC_LIMIT): string {
  const text = normalizeText(value)
  if (text.split(' ').some((token) => PATH_BEARING_TOKEN.test(token))) return WITHHELD_MESSAGE
  return boundedText(text, limit)
}

class BoundedOutput {
  readonly #chunks: Buffer[] = []
  readonly #limit: number
  #bytes = 0
  #truncated = false

  constructor(limit = OUTPUT_LIMIT_BYTES) {
    this.#limit = limit
  }

  get truncated(): boolean {
    return this.#truncated
  }

  append(chunk: Buffer | string): void {
    const incoming = Buffer.from(chunk)
    if (this.#bytes >= this.#limit) {
      if (incoming.length > 0) this.#truncated = true
      return
    }
    const retained = incoming.subarray(0, this.#limit - this.#bytes)
    if (retained.length < incoming.length) this.#truncated = true
    if (retained.length === 0) return
    this.#chunks.push(retained)
    this.#bytes += retained.length
  }

  text(): string {
    const decoded = Buffer.concat(this.#chunks, this.#bytes).toString('utf8')
    if (Buffer.byteLength(decoded) <= this.#limit) return decoded

    // A raw byte cap may end inside a UTF-8 sequence. Decoding that suffix as
    // U+FFFD expands it to three bytes, so find the largest complete string
    // prefix that still honors the advertised encoded-byte bound.
    let low = 0
    let high = decoded.length
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (Buffer.byteLength(decoded.slice(0, middle)) <= this.#limit) low = middle
      else high = middle - 1
    }
    if (
      low > 0 && low < decoded.length &&
      decoded.charCodeAt(low - 1) >= 0xD800 && decoded.charCodeAt(low - 1) <= 0xDBFF &&
      decoded.charCodeAt(low) >= 0xDC00 && decoded.charCodeAt(low) <= 0xDFFF
    ) low -= 1
    return decoded.slice(0, low).replace(/\uFFFD$/, '')
  }
}

export function processFailureDiagnostic(phase: string, result: ProcessResult): string {
  const rawCode = result.error?.code
  const errorCode = typeof rawCode === 'string' && /^[A-Z0-9_]{1,32}$/.test(rawCode)
    ? rawCode
    : result.error === undefined ? undefined : 'UNKNOWN'
  return JSON.stringify({
    event: 'test_process_failed',
    phase: boundedText(phase, 48),
    status: result.status,
    signal: result.signal,
    errorCode,
    message: result.error === undefined ? undefined : safeOsMessage(result.error.message),
  })
}

export async function runProcess(
  executable: string,
  args: readonly string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  return await new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams
    const spawnedAt = Date.now()
    try {
      child = spawn(executable, [...args], {
        cwd: options.cwd,
        detached: process.platform !== 'win32',
        env: options.env,
        windowsHide: true,
        stdio: 'pipe',
      })
    } catch (error) {
      resolve({
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        error: error instanceof Error ? error : new Error('process spawn threw a non-Error value'),
      })
      return
    }

    const stdout = new BoundedOutput()
    const stderr = new BoundedOutput()
    let settled = false
    let timeoutError: (Error & { readonly code: 'ETIMEDOUT' }) | undefined
    let closed: { readonly status: number | null; readonly signal: NodeJS.Signals | null } | undefined
    let childError: Error | undefined
    let pendingError: Error | undefined
    let fallbackStarted = false
    let terminationTimer: ReturnType<typeof setTimeout> | undefined
    let flushTimer: ReturnType<typeof setTimeout> | undefined

    function onStdout(chunk: Buffer | string): void { stdout.append(chunk) }
    function onStderr(chunk: Buffer | string): void { stderr.append(chunk) }

    function onClose(status: number | null, signal: NodeJS.Signals | null): void {
      closed = { status, signal }
      // After a timeout the direct child's close is only evidence about that one
      // process. A caller may start its next phase the moment this promise
      // settles, so the run keeps waiting until the owned tree is provably gone.
      if (timeoutError === undefined) finish(undefined)
      else if (pendingError !== undefined) finish(pendingError)
    }

    function onError(error: Error): void {
      childError = error
      if (timeoutError === undefined) finish(error)
      else if (pendingError !== undefined) finish(pendingError)
    }

    const finish = (error: Error | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (terminationTimer !== undefined) clearTimeout(terminationTimer)
      if (flushTimer !== undefined) clearTimeout(flushTimer)
      child.off('close', onClose)
      child.off('error', onError)
      child.stdout.off('data', onStdout)
      child.stderr.off('data', onStderr)
      resolve({
        status: timeoutError === undefined ? closed?.status ?? null : null,
        signal: closed?.signal ?? child.signalCode,
        stdout: stdout.text(),
        stderr: stderr.text(),
        error,
      })
    }

    /** Settles once termination completed, allowing a bounded final stdio flush. */
    const settleAfterTermination = (error: Error): void => {
      if (settled) return
      pendingError = error
      if (closed !== undefined || childError !== undefined) {
        finish(error)
        return
      }
      if (flushTimer !== undefined) return
      flushTimer = setTimeout(() => finish(error), CLOSE_FLUSH_TIMEOUT_MS)
    }

    const runFallback = (deadlineError: Error & { readonly code: 'ETERMINATE' }): void => {
      if (settled || fallbackStarted) return
      fallbackStarted = true
      if (terminationTimer !== undefined) clearTimeout(terminationTimer)
      void terminateProcessTree(child, spawnedAt).then(
        () => settleAfterTermination(deadlineError),
        (fallbackError: unknown) => settleAfterTermination(Object.assign(
          new Error(`${deadlineError.message}; bounded fallback failed: ${safeOsMessage(
            fallbackError instanceof Error ? fallbackError.message : fallbackError,
          )}`),
          { code: 'ETERMINATE' as const },
        )),
      )
    }

    const timer = setTimeout(() => {
      const timedOut = Object.assign(new Error(`process exceeded ${options.timeoutMs}ms`), {
        code: 'ETIMEDOUT' as const,
      })
      timeoutError = timedOut
      terminationTimer = setTimeout(() => runFallback(Object.assign(
        new Error('process tree did not close before the secondary termination deadline'),
        { code: 'ETERMINATE' as const },
      )), options.terminationTimeoutMs ?? TERMINATION_TIMEOUT_MS)

      const terminate = options.terminate ??
        (async (target: ChildProcessWithoutNullStreams) => { await terminateProcessTree(target, spawnedAt) })
      void (async () => { await terminate(child) })().then(
        () => {
          if (fallbackStarted) return
          if (terminationTimer !== undefined) clearTimeout(terminationTimer)
          settleAfterTermination(timedOut)
        },
        (terminationError: unknown) => {
          // A rejected terminator has not proven the tree is dead either, so the
          // real bounded fallback still runs instead of settling here.
          runFallback(Object.assign(
            new Error(`configured process-tree termination failed: ${safeOsMessage(
              terminationError instanceof Error ? terminationError.message : terminationError,
            )}`),
            { code: 'ETERMINATE' as const },
          ))
        },
      )
    }, options.timeoutMs)

    child.stdout.on('data', onStdout)
    child.stderr.on('data', onStderr)
    child.once('error', onError)
    child.once('close', onClose)
    child.stdin.on('error', () => {
      // A failed spawn closes stdin before the harness writes its input.
    })
    child.stdin.end(options.input ?? '')
  })
}

export function requireProcessSuccess(phase: string, result: ProcessResult): void {
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(processFailureDiagnostic(phase, result))
  }
}
