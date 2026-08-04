import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

const OUTPUT_LIMIT_BYTES = 64 * 1024
const DIAGNOSTIC_LIMIT = 240

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
    let stdout = ''
    let stderr = ''
    const finish = (result: ProcessResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill()
      const error = Object.assign(new Error(`process exceeded ${options.timeoutMs}ms`), { code: 'ETIMEDOUT' })
      finish({ status: null, signal: null, stdout, stderr, error })
    }, options.timeoutMs)

    child.stdout.on('data', (chunk: Buffer | string) => { stdout = appendBounded(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer | string) => { stderr = appendBounded(stderr, chunk) })
    child.once('error', (error) => finish({ status: null, signal: null, stdout, stderr, error }))
    child.once('close', (status, signal) => finish({ status, signal, stdout, stderr }))
    child.stdin.end(options.input ?? '')
  })
}

export function requireProcessSuccess(phase: string, result: ProcessResult): void {
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(processFailureDiagnostic(phase, result))
  }
}
