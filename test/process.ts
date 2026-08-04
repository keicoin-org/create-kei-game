import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'

const OUTPUT_LIMIT_BYTES = 64 * 1024
const PROCESS_TABLE_LIMIT_BYTES = 4 * 1024 * 1024
const DIAGNOSTIC_LIMIT = 240
// Each process-table reader is independently bounded. WMIC is the fast primary
// on Windows versions that still ship it; PowerShell/CIM is the portable
// fallback. A complete read can consume both budgets when WMIC is unavailable.
const PROCESS_TABLE_TIMEOUT_MS = 20_000
const PROCESS_TABLE_READ_BUDGET_MS = PROCESS_TABLE_TIMEOUT_MS * 2
const EXIT_CONFIRM_TIMEOUT_MS = 2_000
const LIVENESS_POLL_MS = 25
const CLOSE_FLUSH_TIMEOUT_MS = 2_000
const TERMINATION_TIMEOUT_MS = 5_000
// The Windows sweep re-reads the process table until a snapshot shows nothing
// owned, so a child spawned between a snapshot and its kills is still caught.
// Convergence needs one clean snapshot; this cap allows one late-child round on
// top of that before the sweep reports failure instead of looping.
const SWEEP_SNAPSHOT_LIMIT = 3

/**
 * Ceiling for one bounded owned-tree termination plus the terminated child's
 * final stdio flush. The termination itself may take up to
 * `SWEEP_SNAPSHOT_LIMIT` table snapshots with a kill-confirmation window after
 * every non-empty one, plus one pre-terminator identity capture on Windows.
 * Callers assert elapsed time against this instead of a hand-picked number.
 */
export const TERMINATION_BUDGET_MS =
  (SWEEP_SNAPSHOT_LIMIT + 1) * PROCESS_TABLE_READ_BUDGET_MS +
  SWEEP_SNAPSHOT_LIMIT * EXIT_CONFIRM_TIMEOUT_MS +
  CLOSE_FLUSH_TIMEOUT_MS

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
   * Test seam for proving the secondary termination deadline. Every outcome of
   * a configured terminator — resolving (even without doing anything), killing
   * only the direct child, rejecting, or hanging — is followed by the real
   * internally bounded full-tree sweep before `runProcess` resolves, and no
   * rejection text from the callback is ever reflected in a diagnostic.
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

/**
 * Waits, without signalling anything, for pids the caller already killed to
 * leave the table. Re-signalling here would be unsound: a bare PID carries no
 * identity on Windows, so a pid recycled inside this window would be terminated
 * as if it were still the owned process. Every kill is therefore issued only
 * against a pid a fresh snapshot just proved owned by creation instant, and
 * this wait exists purely so the next snapshot is not spent on processes that
 * are already on their way out. Timing out is not a failure; the next
 * creation-validated snapshot is what decides whether the tree is gone.
 */
async function waitForPidsExit(pids: readonly number[], timeoutMs: number): Promise<void> {
  if (pids.length === 0) return
  const deadline = Date.now() + timeoutMs
  while (pids.some(pidAlive)) {
    if (Date.now() >= deadline) return
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

export interface ProcessTable {
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

export function parseProcessTable(text: string, truncated = false): ProcessTable {
  if (truncated) throw new Error('the Windows process table exceeded its bounded size')
  const children = new Map<number, number[]>()
  const parents = new Map<number, number>()
  const created = new Map<number, number>()
  let malformed = false
  for (const line of text.split(/\r?\n/)) {
    const record = line.trim()
    if (record === '') continue
    const triple = /^(\d+) (\d+) (\d+)$/.exec(record)
    if (triple === null) {
      malformed = true
      continue
    }
    const pid = Number(triple[1])
    const parent = Number(triple[2])
    const createdAt = Number(triple[3])
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parent) || createdAt <= 0) {
      throw new Error('the Windows process table contained an invalid record')
    }
    parents.set(pid, parent)
    created.set(pid, createdAt)
    const siblings = children.get(parent)
    if (siblings === undefined) children.set(parent, [pid])
    else siblings.push(pid)
  }
  if (created.size === 0) throw new Error('the Windows process table contained no valid records')
  if (malformed) throw new Error('the Windows process table contained an invalid record')
  return { children, parents, created }
}

function dmtfTimestampMs(value: string): number | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{6})([+-])(\d{3})$/.exec(value)
  if (match === null) return undefined
  const local = Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]),
    Number(match[7]!.slice(0, 3)),
  )
  const offsetMinutes = Number(match[9]) * (match[8] === '+' ? 1 : -1)
  return local - offsetMinutes * 60_000
}

export function parseWmicProcessTable(text: string, truncated = false): ProcessTable {
  if (truncated) throw new Error('the Windows process table exceeded its bounded size')
  const triples: string[] = []
  const records = /CreationDate=([^\r\n]*)\s+ParentProcessId=(\d+)\s+ProcessId=(\d+)/g
  let cursor = 0
  for (const match of text.matchAll(records)) {
    if (text.slice(cursor, match.index).trim() !== '') {
      throw new Error('the Windows process table contained an invalid record')
    }
    const created = dmtfTimestampMs(match[1]!)
    if (created === undefined) {
      throw new Error('the Windows process table contained an invalid creation time')
    }
    triples.push(`${match[3]} ${match[2]} ${created}`)
    cursor = match.index + match[0].length
  }
  if (text.slice(cursor).trim() !== '') {
    throw new Error('the Windows process table contained an invalid record')
  }
  return parseProcessTable(triples.join('\n'))
}

interface ProcessTableReaderResult {
  readonly text: string
  readonly truncated: boolean
}

async function runProcessTableReader(
  executable: string,
  args: readonly string[],
): Promise<ProcessTableReaderResult> {
  return await new Promise<ProcessTableReaderResult>(
    (resolve, reject) => {
      let reader: ChildProcessWithoutNullStreams
      try {
        reader = spawn(executable, [...args], { windowsHide: true, stdio: 'pipe' })
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
        if (status !== 0) {
          reject(new Error(`the Windows process table reader exited ${String(status)}`))
        } else resolve({ text: table.text(), truncated: table.truncated })
      }))
      reader.stdin.end()
    },
  )
}

async function readWindowsProcessTable(): Promise<ProcessTable> {
  try {
    const result = await runProcessTableReader('wmic.exe', [
      'process', 'get', 'CreationDate,ParentProcessId,ProcessId', '/FORMAT:LIST',
    ])
    return parseWmicProcessTable(result.text, result.truncated)
  } catch {
    // WMIC is optional on current Windows releases. Fall back to CIM with an
    // encoded script so no caller-controlled text crosses the shell boundary.
  }
  const encoded = Buffer.from(PROCESS_TABLE_SCRIPT, 'utf16le').toString('base64')
  const result = await runProcessTableReader('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded,
  ])
  return parseProcessTable(result.text, result.truncated)
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

export interface OwnedTreeQuery {
  /** PID the harness spawned as the tree root. */
  readonly root: number
  /** Date.now() instant just before the root was spawned; 0 disables the floor. */
  readonly spawnedAtMs: number
  /**
   * Latest instant at which the child handle still proved the original root
   * alive. A process currently holding the same PID but created at or after
   * this instant is necessarily a successor, never the owned root.
   */
  readonly rootKnownAliveAtMs?: number
  /**
   * The exact root generation captured while its child handle/table identity
   * still proved it owned. Once the PID is absent or recycled, only children
   * created inside this proven interval can be attributed to the root without
   * confusing them with an intervening holder of the same numeric PID.
   */
  readonly rootGeneration?: OwnedProcessGeneration
  /**
   * Generations this sweep already proved owned. A later snapshot can safely
   * re-signal an exact identity or reach children created inside its captured
   * alive interval even after the holder disappeared.
   */
  readonly priorOwned?: ReadonlyMap<number, OwnedProcessGeneration>
}

export interface OwnedProcessGeneration {
  /** Exact creation instant from the Windows process table. */
  readonly createdAtMs: number
  /**
   * Exclusive child-creation ceiling sampled while this exact holder was known
   * alive. A child below it cannot belong to a later generation of the PID.
   */
  readonly knownAliveAtMs: number
}

interface OwnedSeed {
  readonly pid: number
  /** Children created before this instant belong to an older use of the PID. */
  readonly floor: number
  /** Children below this instant are proven to belong to this generation. */
  readonly ownedCeiling: number
  /** Children at or above this instant belong to the current recycled holder. */
  readonly ambiguityCeiling: number
}

export interface OwnedTreeSnapshot {
  readonly descendants: readonly number[]
  /** An unrecorded child falls outside every captured generation interval. */
  readonly ambiguous: boolean
}

/**
 * Breadth-first owned descendants for one table snapshot, shallowest first.
 * Windows recycles PIDs quickly, so ownership is decided by creation instants:
 *
 * - A live root appears in the table as itself, and a candidate child is owned
 *   only when it was created at or after its parent.
 * - Once a holder disappears or is recycled, its captured known-alive instant
 *   closes the owned generation. Children inside `[creation, known-alive)` are
 *   still provably owned. Children between that boundary and the current
 *   holder's creation are ambiguous: any number of intervening PID generations
 *   may have existed, so they are never touched or traversed.
 * - An identity recorded by an earlier snapshot remains safe even when it falls
 *   in such a gap. This is how a late child captured while the root was live is
 *   revalidated and terminated after a parent-only configured terminator.
 *
 * The same explicit generation interval guards every previously owned pid in
 * `priorOwned`, so a descendant's PID recycled between snapshots cannot aim the
 * sweep at an unrelated tree either.
 */
export function classifyOwnedDescendants(
  table: ProcessTable,
  query: OwnedTreeQuery,
): OwnedTreeSnapshot {
  const seeds: OwnedSeed[] = []
  const order: number[] = []
  const seen = new Set<number>([query.root])
  const rootCreated = table.created.get(query.root)
  const rootIsOriginal = rootCreated !== undefined && (
    rootCreated === query.rootGeneration?.createdAtMs || (
      query.rootGeneration === undefined &&
      query.rootKnownAliveAtMs !== undefined &&
      rootCreated >= query.spawnedAtMs &&
      rootCreated < query.rootKnownAliveAtMs
    )
  )
  if (rootCreated !== undefined && rootIsOriginal) {
    // The entry is the root itself, even if its handle reported exit while the
    // table was being read. Its children therefore have no recycling ceiling.
    seeds.push({
      pid: query.root,
      floor: rootCreated,
      ownedCeiling: Infinity,
      ambiguityCeiling: Infinity,
    })
  } else {
    const generation = query.rootGeneration
    const ambiguityCeiling = rootCreated ?? Infinity
    const provenAliveCeiling = generation?.knownAliveAtMs ??
      query.rootKnownAliveAtMs ?? query.spawnedAtMs
    seeds.push({
      pid: query.root,
      floor: generation?.createdAtMs ?? query.spawnedAtMs,
      ownedCeiling: Math.min(provenAliveCeiling, ambiguityCeiling),
      ambiguityCeiling,
    })
  }
  for (const [pid, generation] of query.priorOwned ?? []) {
    if (pid === query.root) continue
    const current = table.created.get(pid)
    seen.add(pid)
    if (current === generation.createdAtMs) {
      // It survived the previous signal. The fresh creation-time match makes
      // re-signalling this PID safe and prevents false convergence.
      order.push(pid)
      seeds.push({
        pid,
        floor: generation.createdAtMs,
        ownedCeiling: Infinity,
        ambiguityCeiling: Infinity,
      })
    } else {
      const ambiguityCeiling = current ?? Infinity
      seeds.push({
        pid,
        floor: generation.createdAtMs,
        ownedCeiling: Math.min(generation.knownAliveAtMs, ambiguityCeiling),
        ambiguityCeiling,
      })
    }
  }

  let ambiguous = false
  const queue = [...seeds]
  while (queue.length > 0) {
    const { pid: parent, floor, ownedCeiling, ambiguityCeiling } = queue.shift()!
    for (const pid of table.children.get(parent) ?? []) {
      if (pid <= 4) continue
      const created = table.created.get(pid) ?? 0
      if (created < floor || created >= ambiguityCeiling) continue
      const wasRecorded = query.priorOwned?.get(pid)?.createdAtMs === created
      if (created >= ownedCeiling && !wasRecorded) {
        ambiguous = true
        continue
      }
      if (seen.has(pid)) continue
      seen.add(pid)
      order.push(pid)
      queue.push({
        pid,
        floor: created,
        ownedCeiling: Infinity,
        ambiguityCeiling: Infinity,
      })
    }
  }
  return { descendants: order, ambiguous }
}

export function ownedDescendants(table: ProcessTable, query: OwnedTreeQuery): readonly number[] {
  return classifyOwnedDescendants(table, query).descendants
}

interface WindowsOwnershipContext {
  readonly rootGeneration?: OwnedProcessGeneration
  readonly priorOwned: ReadonlyMap<number, OwnedProcessGeneration>
}

function captureGeneration(
  createdAtMs: number,
  knownAliveAtMs: number,
  previous?: OwnedProcessGeneration,
): OwnedProcessGeneration {
  const capturedThrough = Math.max(createdAtMs, knownAliveAtMs)
  if (previous?.createdAtMs === createdAtMs) {
    return {
      createdAtMs,
      knownAliveAtMs: Math.max(previous.knownAliveAtMs, capturedThrough),
    }
  }
  return { createdAtMs, knownAliveAtMs: capturedThrough }
}

/**
 * Captures identities while the configured terminator has not yet been allowed
 * to remove the root. A parent-only terminator can then leave a known orphan
 * that the confirmation sweep may safely revalidate by creation instant.
 */
async function captureWindowsOwnership(
  root: number,
  spawnedAtMs: number,
  rootKnownAliveAtMs: number,
): Promise<WindowsOwnershipContext> {
  const snapshotStartedAtMs = Date.now()
  const table = await readWindowsProcessTable()
  const currentRootCreated = table.created.get(root)
  const rootGeneration = currentRootCreated !== undefined &&
    currentRootCreated >= spawnedAtMs && currentRootCreated < rootKnownAliveAtMs
    ? captureGeneration(
        currentRootCreated,
        Math.max(rootKnownAliveAtMs, snapshotStartedAtMs),
      )
    : undefined
  const snapshot = classifyOwnedDescendants(table, {
    root,
    spawnedAtMs,
    rootKnownAliveAtMs,
    rootGeneration,
  })
  if (snapshot.ambiguous) {
    throw new Error('the owned process tree identity was ambiguous before configured termination')
  }
  const protectedPids = ownAncestry(table.parents)
  const priorOwned = new Map<number, OwnedProcessGeneration>()
  for (const pid of snapshot.descendants) {
    const createdAtMs = table.created.get(pid)
    if (createdAtMs !== undefined && !protectedPids.has(pid)) {
      priorOwned.set(pid, captureGeneration(createdAtMs, snapshotStartedAtMs))
    }
  }
  return { rootGeneration, priorOwned }
}

async function terminateWindowsTree(
  child: ChildProcessWithoutNullStreams,
  root: number,
  spawnedAtMs: number,
  initialRootKnownAliveAtMs?: number,
  initialContext?: WindowsOwnershipContext,
): Promise<void> {
  // Windows leaves a dead process' PID in its children's ParentProcessId, so the
  // owned tree stays reachable after a terminator killed only the direct child.
  // `taskkill /t` cannot do that: it refuses an already-exited root and so never
  // reaches the orphaned descendants.
  const priorOwned = new Map(initialContext?.priorOwned)
  let rootGeneration = initialContext?.rootGeneration
  let rootKnownAliveAtMs = initialRootKnownAliveAtMs
  for (let snapshot = 1; ; snapshot += 1) {
    // Sampled before the read, so a root that exits mid-read is still resolved
    // as itself rather than mistaken for a successor holding its PID.
    const snapshotStartedAtMs = Date.now()
    const rootAlive = child.exitCode === null && child.signalCode === null
    if (rootAlive) rootKnownAliveAtMs = snapshotStartedAtMs
    const table = await readWindowsProcessTable()
    const protectedPids = ownAncestry(table.parents)
    const currentRootCreated = table.created.get(root)
    const currentIsOriginal = currentRootCreated !== undefined && (
      currentRootCreated === rootGeneration?.createdAtMs || (
        rootGeneration === undefined &&
        rootKnownAliveAtMs !== undefined &&
        currentRootCreated >= spawnedAtMs &&
        currentRootCreated < rootKnownAliveAtMs
      )
    )
    if (currentRootCreated !== undefined && currentIsOriginal) {
      rootGeneration = captureGeneration(
        currentRootCreated,
        Math.max(rootKnownAliveAtMs ?? currentRootCreated, snapshotStartedAtMs),
        rootGeneration,
      )
    }
    const ownership = classifyOwnedDescendants(table, {
      root, spawnedAtMs, rootKnownAliveAtMs, rootGeneration, priorOwned,
    })
    const descendants = ownership.descendants.filter((pid) => !protectedPids.has(pid))

    // Only a snapshot that finds nothing owned proves the tree complete, and
    // only once the root was already dead before that snapshot was taken:
    // a still-live root could spawn a child the moment the read finished, and a
    // child spawned between the previous snapshot and its kills is owned but
    // was invisible to that snapshot.
    if (!ownership.ambiguous && !rootAlive && descendants.length === 0) return
    for (const pid of descendants) {
      const createdAtMs = table.created.get(pid)
      if (createdAtMs !== undefined) {
        priorOwned.set(
          pid,
          captureGeneration(createdAtMs, snapshotStartedAtMs, priorOwned.get(pid)),
        )
      }
    }
    // Deepest first: terminating a middle process would otherwise orphan the
    // level below it out of the parent chain this snapshot walked.
    for (let index = descendants.length - 1; index >= 0; index -= 1) killPid(descendants[index]!)
    // A dead root's PID may already belong to an unrelated process, so the only
    // root ever signalled is the child handle this harness owns.
    if (rootAlive) killDirectly(child)

    const [exited] = await Promise.all([
      waitForProcessExit(child, EXIT_CONFIRM_TIMEOUT_MS),
      waitForPidsExit(descendants, EXIT_CONFIRM_TIMEOUT_MS),
    ])
    // The handle proves the root's death outright, so a root still running here
    // will never converge. Descendants get no such verdict from a bare PID and
    // are judged by the next snapshot instead.
    if (!exited) {
      throw new Error('the owned process tree was still alive after bounded termination')
    }
    // Ambiguity is a fail-closed verdict, but it does not excuse leaving other
    // identities from this same snapshot running after they were independently
    // revalidated. Clean those known processes first, then report the stable
    // failure without ever signalling the ambiguous candidate.
    if (ownership.ambiguous) {
      throw new Error('the owned process tree identity became ambiguous during bounded termination')
    }
    // A final non-empty snapshot cannot prove convergence, but every identity
    // it did prove owned has still been signalled and given the normal bounded
    // exit window. Returning failure without cleaning already-known work would
    // make the failure path itself leak processes.
    if (snapshot === SWEEP_SNAPSHOT_LIMIT) {
      throw new Error('the owned process tree was still alive after bounded termination')
    }
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
 * Date.now() instant just before the root was spawned. It only identifies a
 * still-visible original root; after recycling, signalling requires the exact
 * generation interval captured by the bounded sweep.
 */
export async function terminateProcessTree(
  child: ChildProcessWithoutNullStreams,
  spawnedAtMs = 0,
  rootKnownAliveAtMs?: number,
): Promise<void> {
  await terminateOwnedProcessTree(child, spawnedAtMs, rootKnownAliveAtMs)
}

async function terminateOwnedProcessTree(
  child: ChildProcessWithoutNullStreams,
  spawnedAtMs: number,
  rootKnownAliveAtMs?: number,
  windowsContext?: WindowsOwnershipContext,
): Promise<void> {
  const root = child.pid
  if (root === undefined) return
  if (process.platform === 'win32') {
    await terminateWindowsTree(child, root, spawnedAtMs, rootKnownAliveAtMs, windowsContext)
  }
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
    let sweepStarted = false
    let rootKnownAliveAtMs: number | undefined
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

    /**
     * The real, internally bounded owned-tree sweep. Every route out of a
     * timed-out run funnels through here exactly once: a configured
     * terminator's resolution is only a claim, so nothing it reports is
     * trusted until this sweep has independently proven the tree gone. The run
     * settles with `outcome` only on that proof; a failed sweep replaces it
     * with the sweep's own diagnosis.
     */
    const confirmOwnedTreeGone = (
      outcome: Error,
      windowsContext?: WindowsOwnershipContext,
    ): void => {
      if (settled || sweepStarted) return
      sweepStarted = true
      if (terminationTimer !== undefined) clearTimeout(terminationTimer)
      void terminateOwnedProcessTree(
        child,
        spawnedAt,
        rootKnownAliveAtMs,
        windowsContext,
      ).then(
        () => settleAfterTermination(outcome),
        () => settleAfterTermination(Object.assign(
          new Error('bounded process-tree termination could not be confirmed'),
          { code: 'ETERMINATE' as const },
        )),
      )
    }

    const timer = setTimeout(() => {
      const timedOut = Object.assign(new Error(`process exceeded ${options.timeoutMs}ms`), {
        code: 'ETIMEDOUT' as const,
      })
      timeoutError = timedOut
      if (child.exitCode === null && child.signalCode === null) {
        rootKnownAliveAtMs = Date.now()
      }
      const configured = options.terminate
      if (configured === undefined) {
        confirmOwnedTreeGone(timedOut)
        return
      }
      void (async () => {
        let windowsContext: WindowsOwnershipContext | undefined
        if (
          process.platform === 'win32' &&
          child.pid !== undefined &&
          rootKnownAliveAtMs !== undefined
        ) {
          try {
            windowsContext = await captureWindowsOwnership(
              child.pid,
              spawnedAt,
              rootKnownAliveAtMs,
            )
          } catch {
            confirmOwnedTreeGone(Object.assign(
              new Error('configured process-tree termination could not start safely'),
              { code: 'ETERMINATE' as const },
            ))
            return
          }
        }
        if (settled || sweepStarted) return
        terminationTimer = setTimeout(() => confirmOwnedTreeGone(Object.assign(
          new Error('process tree did not close before the secondary termination deadline'),
          { code: 'ETERMINATE' as const },
        ), windowsContext), options.terminationTimeoutMs ?? TERMINATION_TIMEOUT_MS)
        try {
          await configured(child)
          confirmOwnedTreeGone(timedOut, windowsContext)
        } catch {
          // Rejection text can carry command lines, environment values, or
          // captured input. It is replaced, never scrubbed or reflected.
          confirmOwnedTreeGone(Object.assign(
            new Error('configured process-tree termination failed'),
            { code: 'ETERMINATE' as const },
          ), windowsContext)
        }
      })()
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
