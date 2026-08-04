import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

const OUTPUT_LIMIT_BYTES = 64 * 1024
const DIAGNOSTIC_LIMIT = 240
const TASKKILL_TIMEOUT_MS = 2_000
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
}

function boundedText(value: unknown, limit = DIAGNOSTIC_LIMIT): string {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function appendBounded(current: string, chunk: Buffer | string): string {
  if (Buffer.byteLength(current) >= OUTPUT_LIMIT_BYTES) return current
  const remaining = OUTPUT_LIMIT_BYTES - Buffer.byteLength(current)
  return current + Buffer.from(chunk).subarray(0, remaining).toString('utf8')
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
    let terminationTimer: ReturnType<typeof setTimeout> | undefined
    let stdout = ''
    let stderr = ''
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
        killDirectly(child)
        finish({
          status: null,
          signal: child.signalCode,
          stdout,
          stderr,
          error: Object.assign(
            new Error('process tree did not close before the secondary termination deadline'),
            { code: 'ETERMINATE' },
          ),
        })
      }, options.terminationTimeoutMs ?? TERMINATION_TIMEOUT_MS)
      void (options.terminate ?? terminateTree)(child).catch((terminationError: unknown) => finish({
        status: null,
        signal: child.signalCode,
        stdout,
        stderr,
        error: Object.assign(
          terminationError instanceof Error
            ? terminationError
            : new Error('process-tree termination failed with a non-Error value'),
          { code: 'ETERMINATE' },
        ),
      }))
    }, options.timeoutMs)

    child.stdout.on('data', (chunk: Buffer | string) => { stdout = appendBounded(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer | string) => { stderr = appendBounded(stderr, chunk) })
    child.once('error', (error) => finish({
      status: null,
      signal: null,
      stdout,
      stderr,
      error: timeoutError ?? error,
    }))
    child.once('close', (status, signal) => finish({
      status: timeoutError === undefined ? status : null,
      signal,
      stdout,
      stderr,
      error: timeoutError,
    }))
    child.stdin.end(options.input ?? '')
  })
}

export function requireProcessSuccess(phase: string, result: ProcessResult): void {
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(processFailureDiagnostic(phase, result))
  }
}
