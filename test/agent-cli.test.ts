import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url))
const temporary: string[] = []
const secret = 'sk-cli-secret-never-print'

beforeAll(() => {
  const built = spawnSync(process.execPath, ['run', 'build'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (built.error) throw built.error
  if (built.status !== 0) throw new Error(`CLI test build failed: ${built.stderr}`)
})

interface RunResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'create-kei-game-agent-'))
  temporary.push(directory)
  return directory
}

async function run(
  directory: string,
  args: readonly string[],
  options: { readonly input?: string; readonly environment?: Record<string, string> } = {},
): Promise<RunResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn('node', [entry, ...args], {
      cwd: directory,
      env: { ...process.env, ...options.environment },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('CLI test process timed out.'))
    }, 30_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (status) => {
      clearTimeout(timeout)
      resolve({ status, stdout, stderr })
    })
    child.stdin.end(options.input)
  })
}

function jsonLine(result: RunResult): Record<string, any> {
  const lines = result.stdout.trim().split(/\r?\n/)
  expect(lines).toHaveLength(1)
  expect(result.stderr).toBe('')
  return JSON.parse(lines[0]!) as Record<string, any>
}

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('real prompt-free agent CLI', () => {
  test('flags-only mode prepares once and emits one sanitized JSON object', async () => {
    const directory = workspace()
    const result = await run(
      directory,
      [
        'Flag Game', '--agent', '--json', '--source', 'blank', '--into', 'game',
        '--provider', 'openai', '--model', 'explicit-model', '--api-key-env', 'TEST_MODEL_KEY',
        '--brief', 'Build a tiny puzzle game.', '--no-launch',
      ],
      { environment: { TEST_MODEL_KEY: secret } },
    )
    expect(result.status).toBe(0)
    const output = jsonLine(result)
    expect(output).toMatchObject({
      ok: true,
      status: 'prepared',
      launch: 'disabled',
      request: {
        project: { title: 'Flag Game', slug: 'flag-game' },
        selection: { kind: 'blank' },
        provider: { provider: 'openai', apiKeyEnv: 'TEST_MODEL_KEY' },
        model: 'explicit-model',
        launch: false,
      },
      prepared: { created: true },
    })
    expect(result.stdout).not.toContain(secret)
    expect(result.stdout).not.toContain('Cloning')
    expect(readFileSync(join(directory, 'game', 'package.json'), 'utf8')).toContain('flag-game')
  })

  test('reads config from a file and explicit flags replace it with source-group precedence', async () => {
    const directory = workspace()
    const configPath = join(directory, 'agent.json')
    writeFileSync(configPath, JSON.stringify({
      name: 'Config Game', source: 'template', template: 'button', into: 'config-game',
      force: false, provider: 'openai', model: 'config-model', apiKeyEnv: 'TEST_MODEL_KEY',
      brief: 'Config brief', launch: true,
    }))
    const result = await run(
      directory,
      [
        'Flag Game', '--agent', '--json', '--agent-config', configPath, '--source', 'blank',
        '--into', 'flag-game', '--force', '--model', 'flag-model', '--brief', 'Flag brief',
        '--no-launch',
      ],
      { environment: { TEST_MODEL_KEY: 'present' } },
    )
    expect(result.status).toBe(0)
    expect(jsonLine(result)).toMatchObject({
      launch: 'disabled',
      request: {
        project: { title: 'Flag Game' }, selection: { kind: 'blank' }, force: true,
        model: 'flag-model', brief: 'Flag brief', launch: false,
      },
    })
  })

  test('reads bounded config from stdin without asking anything', async () => {
    const directory = workspace()
    const input = JSON.stringify({
      name: 'Stdin Game', source: 'blank', into: 'stdin-game', provider: 'openai',
      model: 'stdin-model', apiKeyEnv: 'TEST_MODEL_KEY', brief: 'Build from stdin.', launch: false,
    })
    const result = await run(directory, ['--agent', '--json', '--agent-config', '-'], {
      input,
      environment: { TEST_MODEL_KEY: 'present' },
    })
    expect(result.status).toBe(0)
    expect(jsonLine(result)).toMatchObject({ ok: true, request: { model: 'stdin-model' } })
  })

  test('returns all missing fields as one JSON error and never opens an asker', async () => {
    const result = await run(workspace(), ['--agent', '--json'])
    expect(result.status).toBe(1)
    expect(jsonLine(result)).toEqual({
      ok: false,
      error: {
        code: 'missing_inputs',
        message: 'Agent mode is missing required inputs.',
        missing: ['name', 'source', 'provider', 'model', 'apiKeyEnv', 'brief'],
      },
    })
  })

  test('redacts secret configs, missing env, malformed and oversized stdin', async () => {
    const secretResult = await run(workspace(), ['--agent', '--json', '--agent-config', '-'], {
      input: JSON.stringify({ apiKey: secret }),
    })
    expect(secretResult.status).toBe(1)
    expect(jsonLine(secretResult)).toMatchObject({ ok: false, error: { code: 'secret_fields' } })
    expect(secretResult.stdout).not.toContain(secret)

    const missingEnv = await run(workspace(), [
      'g', '--agent', '--json', '--source', 'blank', '--provider', 'openai', '--model', 'm',
      '--api-key-env', 'DEFINITELY_MISSING_KEY', '--brief', 'b',
    ])
    expect(jsonLine(missingEnv)).toEqual({
      ok: false,
      error: {
        code: 'api_key_env_unset',
        message: 'Required provider API key environment variable is not set.',
        field: 'apiKeyEnv',
      },
    })
    expect(missingEnv.stdout).not.toContain('DEFINITELY_MISSING_KEY')

    const rawLookingEnv = await run(workspace(), [
      'g', '--agent', '--json', '--source', 'blank', '--provider', 'openai', '--model', 'm',
      '--api-key-env', 'ThisLooksLikeRawCredentialABC123', '--brief', 'b',
    ])
    expect(jsonLine(rawLookingEnv)).toEqual({
      ok: false,
      error: {
        code: 'api_key_env_unset',
        message: 'Required provider API key environment variable is not set.',
        field: 'apiKeyEnv',
      },
    })
    expect(rawLookingEnv.stdout).not.toContain('ThisLooksLikeRawCredentialABC123')
    expect(rawLookingEnv.stderr).not.toContain('ThisLooksLikeRawCredentialABC123')

    const malformed = await run(workspace(), ['--agent', '--json', '--agent-config', '-'], { input: '{' })
    expect(jsonLine(malformed)).toMatchObject({ ok: false, error: { code: 'invalid_config' } })

    const oversized = await run(workspace(), ['--agent', '--json', '--agent-config', '-'], {
      input: ' '.repeat(64 * 1024 + 1),
    })
    expect(jsonLine(oversized)).toMatchObject({ ok: false, error: { code: 'config_too_large' } })
  })

  test('--yes is rejected as distinct and missing config files do not expose OS errors', async () => {
    const yes = await run(workspace(), ['--agent', '--json', '--yes'])
    expect(jsonLine(yes)).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } })

    const missingPath = join(workspace(), 'private-name.json')
    const missing = await run(workspace(), ['--agent', '--json', '--agent-config', missingPath])
    expect(jsonLine(missing)).toEqual({
      ok: false,
      error: {
        code: 'invalid_config',
        message: 'Agent config could not be read.',
        field: 'agentConfig',
      },
    })
    expect(missing.stdout).not.toContain('private-name.json')
  })
})

describe('real human onboarding integration', () => {
  test('complete flags avoid readline, validate the shared plan, and report launch pending', async () => {
    const directory = workspace()
    const result = await run(
      directory,
      [
        'Human Game', '--source', 'blank', '--into', 'game', '--provider', 'openai',
        '--model', 'explicit-model', '--api-key-env', 'HUMAN_MODEL_KEY',
        '--brief', 'Build a cooperative puzzle.',
      ],
      { environment: { HUMAN_MODEL_KEY: secret } },
    )
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Provider: openai / explicit-model')
    expect(result.stdout).toContain('Credential: inherited from HUMAN_MODEL_KEY')
    expect(result.stdout).toContain('Launch: pending until the model runtime lands')
    expect(result.stdout).toContain('No model or tool')
    expect(result.stdout).not.toContain(secret)
    expect(existsSync(join(directory, 'game', 'package.json'))).toBeTrue()
  })

  test('missing inherited env fails before the destination is created', async () => {
    const directory = workspace()
    const result = await run(directory, [
      'Human Game', '--source', 'blank', '--into', 'untouched', '--provider', 'openai',
      '--model', 'explicit-model', '--api-key-env', 'MISSING_HUMAN_KEY', '--brief', 'Build it.',
    ])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Required provider API key environment variable is not set.')
    expect(result.stdout).not.toContain('MISSING_HUMAN_KEY')
    expect(existsSync(join(directory, 'untouched'))).toBeFalse()
  })

  test('an env reference that looks like a raw credential is never echoed back when unset', async () => {
    const directory = workspace()
    const candidate = 'ThisLooksLikeRawCredentialABC123'
    const result = await run(directory, [
      'Human Game', '--source', 'blank', '--into', 'untouched', '--provider', 'openai',
      '--model', 'explicit-model', '--api-key-env', candidate, '--brief', 'Build it.',
    ])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Required provider API key environment variable is not set.')
    expect(result.stdout).not.toContain(candidate)
    expect(result.stderr).not.toContain(candidate)
    expect(existsSync(join(directory, 'untouched'))).toBeFalse()
  })

  test('complete source flags without provider answers still enter interactive onboarding', async () => {
    const directory = workspace()
    const result = await run(directory, ['Human Game', '--source', 'blank', '--into', 'untouched'])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('--provider, --model, --api-key-env, and --brief')
    expect(existsSync(join(directory, 'untouched'))).toBeFalse()
  })

  test('--yes retains prompt-free source-only preparation', async () => {
    const directory = workspace()
    const result = await run(directory, ['Legacy Game', '--yes', '--source', 'blank', '--into', 'legacy'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Legacy Game')
    expect(result.stdout).not.toContain('Provider:')
    expect(existsSync(join(directory, 'legacy', 'package.json'))).toBeTrue()
  })
})

test('package exposes non-executing library subpaths', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    exports: Record<string, unknown>
  }
  expect(Object.keys(manifest.exports)).toEqual(['.', './source', './providers', './harness', './agent'])
  expect(JSON.stringify(manifest.exports['./harness'])).toContain('dist/harness.js')
  expect(JSON.stringify(manifest.exports['./agent'])).toContain('dist/agent.js')
  const probe = spawnSync(
    'node',
    [
      '-e',
      "const [a,h,p]=await Promise.all([import('create-kei-game/agent'),import('create-kei-game/harness'),import('create-kei-game/providers')]);process.stdout.write([typeof a.createAgentRequest,typeof h.createHarnessRequest,typeof p.resolveProvider].join(','))",
    ],
    { cwd: root, encoding: 'utf8', timeout: 30_000 },
  )
  if (probe.error) throw probe.error
  expect(probe.status).toBe(0)
  expect(probe.stderr).toBe('')
  expect(probe.stdout).toBe('function,function,function')
})
