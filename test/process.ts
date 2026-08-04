import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

const OUTPUT_LIMIT_BYTES = 64 * 1024
const DIAGNOSTIC_LIMIT = 240
const TASKKILL_TIMEOUT_MS = 2_000
const TERMINATION_CONFIRM_TIMEOUT_MS = 2_000
const TERMINATION_TIMEOUT_MS = 5_000

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
  /** Test seam for proving the secondary termination deadline. */
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

async function terminateTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      let killer: ChildProcessWithoutNullStreams
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (): void => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        resolve()
      }
      try {
        killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          windowsHide: true,
          stdio: 'pipe',
        })
      } catch {
        killDirectly(child)
        finish()
        return
      }
      killer.once('error', () => {
        killDirectly(child)
        finish()
      })
      killer.once('close', (status) => {
        if (status !== 0) killDirectly(child)
        finish()
      })
      killer.stdin.end()
      killer.stdout.resume()
      killer.stderr.resume()
      timer = setTimeout(() => {
        killDirectly(killer)
        killDirectly(child)
        finish()
      }, TASKKILL_TIMEOUT_MS)
    })
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      killDirectly(child)
    }
  }

  if (!(await waitForProcessExit(child, TERMINATION_CONFIRM_TIMEOUT_MS))) {
    throw new Error('process did not exit after bounded tree termination')
  }
}

function boundedText(value: unknown, limit = DIAGNOSTIC_LIMIT): string {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

class BoundedOutput {
  readonly #chunks: Buffer[] = []
  #bytes = 0

  append(chunk: Buffer | string): void {
    if (this.#bytes >= OUTPUT_LIMIT_BYTES) return
    const retained = Buffer.from(chunk).subarray(0, OUTPUT_LIMIT_BYTES - this.#bytes)
    if (retained.length === 0) return
    this.#chunks.push(retained)
    this.#bytes += retained.length
  }

  text(): string {
    const decoded = Buffer.concat(this.#chunks, this.#bytes).toString('utf8')
    if (Buffer.byteLength(decoded) <= OUTPUT_LIMIT_BYTES) return decoded

    // A raw byte cap may end inside a UTF-8 sequence. Decoding that suffix as
    // U+FFFD expands it to three bytes, so find the largest complete string
    // prefix that still honors the advertised encoded-byte bound.
    let low = 0
    let high = decoded.length
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (Buffer.byteLength(decoded.slice(0, middle)) <= OUTPUT_LIMIT_BYTES) low = middle
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
  const errorCode = typeof rawCode === 'string' && /^[A-Z0-9_]+$/.test(rawCode)
    ? rawCode
    : result.error === undefined ? undefined : 'UNKNOWN'
  return JSON.stringify({
    event: 'test_process_failed',
    phase: boundedText(phase, 48),
    status: result.status,
    signal: result.signal,
    errorCode,
    message: result.error === undefined ? undefined : boundedText(result.error.message),
  })
}

export async function runProcess(
  executable: string,
  args: readonly string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  return await new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams
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

    let settled = false
    let timeoutError: (Error & { readonly code: 'ETIMEDOUT' }) | undefined
    let terminationDeadlineError: (Error & { readonly code: 'ETERMINATE' }) | undefined
    let terminationTimer: ReturnType<typeof setTimeout> | undefined
    const stdout = new BoundedOutput()
    const stderr = new BoundedOutput()
    const output = () => ({ stdout: stdout.text(), stderr: stderr.text() })
    const finish = (result: ProcessResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (terminationTimer !== undefined) clearTimeout(terminationTimer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      timeoutError = Object.assign(new Error(`process exceeded ${options.timeoutMs}ms`), {
        code: 'ETIMEDOUT' as const,
      })
      terminationTimer = setTimeout(() => {
        terminationDeadlineError = Object.assign(
          new Error('process tree did not close before the secondary termination deadline'),
          { code: 'ETERMINATE' as const },
        )
        // The configured terminator may itself be hung. Run the real bounded
        // tree terminator as an independent fallback and do not resolve until
        // it has confirmed that the direct child exited.
        void terminateTree(child).then(
          () => finish({
            status: null,
            signal: child.signalCode,
            ...output(),
            error: terminationDeadlineError,
          }),
          (fallbackError: unknown) => finish({
            status: null,
            signal: child.signalCode,
            ...output(),
            error: Object.assign(
              new Error(
                `${terminationDeadlineError?.message ?? 'process termination deadline exceeded'}; fallback failed: ${boundedText(
                  fallbackError instanceof Error ? fallbackError.message : fallbackError,
                )}`,
              ),
              { code: 'ETERMINATE' },
            ),
          }),
        )
      }, options.terminationTimeoutMs ?? TERMINATION_TIMEOUT_MS)
      void (options.terminate ?? terminateTree)(child).catch((terminationError: unknown) => finish({
        status: null,
        signal: child.signalCode,
        ...output(),
        error: Object.assign(
          terminationError instanceof Error
            ? terminationError
            : new Error('process-tree termination failed with a non-Error value'),
          { code: 'ETERMINATE' },
        ),
      }))
    }, options.timeoutMs)

    child.stdout.on('data', (chunk: Buffer | string) => { stdout.append(chunk) })
    child.stderr.on('data', (chunk: Buffer | string) => { stderr.append(chunk) })
    child.once('error', (error) => finish({
      status: null,
      signal: null,
      ...output(),
      error: timeoutError ?? error,
    }))
    child.once('close', (status, signal) => finish({
      status: timeoutError === undefined ? status : null,
      signal,
      ...output(),
      error: terminationDeadlineError ?? timeoutError,
    }))
    child.stdin.end(options.input ?? '')
  })
}

/**
 * Assert the exit a phase was written against. A child that never reached an
 * exit status reports the bounded diagnostic rather than the bare
 * `Expected: 1 / Received: undefined` that hid the real OS error.
 */
export function requireProcessExit(phase: string, result: ProcessResult, status: number): void {
  if (result.error !== undefined || result.status !== status) {
    throw new Error(processFailureDiagnostic(phase, result))
  }
}

export function requireProcessSuccess(phase: string, result: ProcessResult): void {
  requireProcessExit(phase, result, 0)
}

let resolvedNode: string | undefined

/** Resolve `node` once so every child uses the same explicit executable. */
export function nodeExecutable(): string {
  if (resolvedNode !== undefined) return resolvedNode
  const found = Bun.which('node')
  if (found === null) {
    throw new Error(
      JSON.stringify({ event: 'test_process_failed', phase: 'resolve-node', errorCode: 'ENOENT' }),
    )
  }
  resolvedNode = found
  return found
}
