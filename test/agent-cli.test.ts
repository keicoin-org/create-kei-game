import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { ensureBuilt } from './built.js'
import { nodeExecutable, requireProcessSuccess, runProcess } from './process.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url))
const temporary: string[] = []
const secret = 'sk-cli-secret-never-print'

/** Nothing like a reference project, so no test can end up wanting a network. */
const GAMEPLAY = 'Crews salvage derelict stations and haul cargo home.'

await ensureBuilt()

interface RunResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'create-kei-mmo-agent-'))
  temporary.push(directory)
  return directory
}

async function run(
  directory: string,
  args: readonly string[],
  options: { readonly input?: string; readonly environment?: Record<string, string> } = {},
): Promise<RunResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(nodeExecutable(), [entry, ...args], {
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
  test('flags-only mode plans, prepares once, and emits one sanitized JSON object', async () => {
    const directory = workspace()
    const result = await run(
      directory,
      [
        'Flag MMO', '--agent', '--json', '--3d', '--gameplay', GAMEPLAY, '--into', 'game',
        '--provider', 'openai', '--model', 'explicit-model', '--api-key-env', 'TEST_MODEL_KEY',
        '--no-launch',
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
        project: { title: 'Flag MMO', slug: 'flag-mmo' },
        selection: { kind: 'blank' },
        intent: { intentVersion: 1, dimension: '3d', gameplay: GAMEPLAY },
        plan: { planVersion: 2, reference: { strategy: 'scaffold' } },
        provider: { provider: 'openai', apiKeyEnv: 'TEST_MODEL_KEY' },
        model: 'explicit-model',
        launch: false,
      },
      prepared: { created: true },
    })
    expect(result.stdout).not.toContain(secret)
    expect(result.stdout).not.toContain('Cloning')
    expect(readFileSync(join(directory, 'game', 'package.json'), 'utf8')).toContain('flag-mmo')
    const plan = JSON.parse(readFileSync(join(directory, 'game', 'kei-mmo', 'plan.json'), 'utf8'))
    expect(plan.planVersion).toBe(2)
    expect(plan.capabilities.length).toBeGreaterThan(5)
  })

  test('--plan-only decides everything and touches nothing', async () => {
    const directory = workspace()
    const result = await run(directory, [
      'Planned MMO', '--agent', '--json', '--plan-only', '--gameplay', GAMEPLAY, '--into', 'game',
    ])
    expect(result.status).toBe(0)
    const output = jsonLine(result)
    expect(output.ok).toBeTrue()
    expect(output.status).toBe('planned')
    expect(output.plan.intent.name).toBe('Planned MMO')
    expect(output.plan.engine.dimension).toBeString()
    expect(output.plan.reference.considered).toHaveLength(3)
    expect(output.plan.constraints.length).toBeGreaterThan(0)
    // No provider was named and no credential was set, and neither was needed.
    expect(existsSync(join(directory, 'game'))).toBeFalse()
  })

  test('reads config from a file and explicit flags replace it field by field', async () => {
    const directory = workspace()
    const configPath = join(directory, 'agent.json')
    writeFileSync(configPath, JSON.stringify({
      name: 'Config MMO', dimension: '2d', gameplay: 'Config gameplay', world: 'Config world',
      into: 'config-mmo', force: false, provider: 'openai', model: 'config-model',
      apiKeyEnv: 'TEST_MODEL_KEY', launch: true,
    }))
    const result = await run(
      directory,
      [
        'Flag MMO', '--agent', '--json', '--agent-config', configPath, '--3d',
        '--into', 'flag-mmo', '--force', '--model', 'flag-model', '--gameplay', GAMEPLAY,
        '--no-launch',
      ],
      { environment: { TEST_MODEL_KEY: 'present' } },
    )
    expect(result.status).toBe(0)
    expect(jsonLine(result)).toMatchObject({
      launch: 'disabled',
      request: {
        project: { title: 'Flag MMO' },
        force: true,
        model: 'flag-model',
        intent: { dimension: '3d', gameplay: GAMEPLAY, world: 'Config world' },
        launch: false,
      },
    })
  })

  test('reads bounded config from stdin without asking anything', async () => {
    const directory = workspace()
    const input = JSON.stringify({
      name: 'Stdin MMO', gameplay: GAMEPLAY, into: 'stdin-mmo', provider: 'openai',
      model: 'stdin-model', apiKeyEnv: 'TEST_MODEL_KEY', launch: false,
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
        missing: ['name', 'gameplay', 'provider', 'model', 'apiKeyEnv'],
      },
    })
  })

  test('a retired starting-point field comes back with its own code', async () => {
    const result = await run(workspace(), ['--agent', '--json', '--agent-config', '-'], {
      input: JSON.stringify({ name: 'g', gameplay: GAMEPLAY, source: 'blank' }),
    })
    expect(result.status).toBe(1)
    expect(jsonLine(result)).toMatchObject({
      ok: false,
      error: { code: 'retired_field', field: 'source' },
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
      'g', '--agent', '--json', '--gameplay', GAMEPLAY, '--provider', 'openai', '--model', 'm',
      '--api-key-env', 'DEFINITELY_MISSING_KEY',
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
      'g', '--agent', '--json', '--gameplay', GAMEPLAY, '--provider', 'openai', '--model', 'm',
      '--api-key-env', 'ThisLooksLikeRawCredentialABC123',
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
  }, 45_000)

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
  // The launch itself is covered offline in test/creation-runtime.test.ts against
  // a scripted fetch. Reaching a real provider from a test suite would be both
  // nondeterministic and somebody else's bill, so --no-launch stops short of it.
  test('complete flags avoid readline, show the decisions, and honour --no-launch', async () => {
    const directory = workspace()
    const result = await run(
      directory,
      [
        'Human MMO', '--3d', '--gameplay', GAMEPLAY, '--into', 'game', '--provider', 'openai',
        '--model', 'explicit-model', '--api-key-env', 'HUMAN_MODEL_KEY', '--no-launch',
      ],
      { environment: { HUMAN_MODEL_KEY: secret } },
    )
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('a 3D Kei MMORPG')
    expect(result.stdout).toContain('Start from')
    expect(result.stdout).toContain('Provider: openai / explicit-model')
    expect(result.stdout).toContain('Credential: inherited from HUMAN_MODEL_KEY')
    expect(result.stdout).toContain('Launch: disabled')
    expect(result.stdout).toContain('because launch was disabled')
    expect(result.stdout).not.toContain(secret)
    expect(existsSync(join(directory, 'game', 'package.json'))).toBeTrue()
    expect(existsSync(join(directory, 'game', 'kei-mmo', 'PLAN.md'))).toBeTrue()
  })

  test('a human --plan-only run prints the decisions and writes nothing', async () => {
    const directory = workspace()
    const result = await run(directory, ['Planned', '--plan-only', '--2d', '--gameplay', GAMEPLAY])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('a 2D Kei MMORPG')
    expect(result.stdout).toContain('Nothing was written')
    expect(existsSync(join(directory, 'planned'))).toBeFalse()
  })

  test('missing inherited env fails before the destination is created', async () => {
    const directory = workspace()
    const result = await run(directory, [
      'Human MMO', '--gameplay', GAMEPLAY, '--into', 'untouched', '--provider', 'openai',
      '--model', 'explicit-model', '--api-key-env', 'MISSING_HUMAN_KEY',
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
      'Human MMO', '--gameplay', GAMEPLAY, '--into', 'untouched', '--provider', 'openai',
      '--model', 'explicit-model', '--api-key-env', candidate,
    ])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Required provider API key environment variable is not set.')
    expect(result.stdout).not.toContain(candidate)
    expect(result.stderr).not.toContain(candidate)
    expect(existsSync(join(directory, 'untouched'))).toBeFalse()
  })

  test('a complete intent without provider answers still enters interactive onboarding', async () => {
    const directory = workspace()
    const result = await run(directory, ['Human MMO', '--gameplay', GAMEPLAY, '--into', 'untouched'])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('--provider, --model, and --api-key-env')
    expect(existsSync(join(directory, 'untouched'))).toBeFalse()
  })

  test('--yes plans and scaffolds without a provider', async () => {
    const directory = workspace()
    const result = await run(directory, ['Legacy MMO', '--yes', '--into', 'legacy'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Legacy MMO')
    expect(result.stdout).not.toContain('Provider:')
    expect(existsSync(join(directory, 'legacy', 'package.json'))).toBeTrue()
    expect(existsSync(join(directory, 'legacy', 'kei-mmo', 'plan.json'))).toBeTrue()
  })

  test('the retired starting-point flags are refused with a sentence, not ignored', async () => {
    const result = await run(workspace(), ['g', '--source', 'blank'])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('--source is gone')
  })
})

test('package exposes non-executing library subpaths', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    name: string
    bin: Record<string, string>
    exports: Record<string, unknown>
  }
  expect(manifest.name).toBe('create-kei-mmo')
  // The old command names stay pointed at the same files: the repository is not
  // being renamed, and a checkout that already has them on PATH keeps working.
  expect(Object.keys(manifest.bin)).toEqual([
    'create-kei-mmo',
    'create-kei-mmo-engine',
    'create-kei-game',
    'create-kei-game-engine',
  ])
  expect(Object.keys(manifest.exports)).toEqual([
    '.',
    './intent',
    './capabilities',
    './references',
    './plan',
    './planner',
    './style',
    './content',
    './content-project',
    './motion',
    './cutscene',
    './source',
    './providers',
    './harness',
    './agent',
    './runtime',
    './runtime-protocol',
    './provider-transport',
    './tools',
    './creation-runtime',
  ])
  expect(JSON.stringify(manifest.exports['./planner'])).toContain('dist/planner.js')
  expect(JSON.stringify(manifest.exports['./harness'])).toContain('dist/harness.js')
  const probe = await runProcess(
    nodeExecutable(),
    [
      '-e',
      "const [a,h,p,t,c,i,n]=await Promise.all([import('create-kei-mmo/agent'),import('create-kei-mmo/harness'),import('create-kei-mmo/providers'),import('create-kei-mmo/tools'),import('create-kei-mmo/creation-runtime'),import('create-kei-mmo/intent'),import('create-kei-mmo/planner')]);process.stdout.write([typeof a.createAgentRequest,typeof h.createHarnessRequest,typeof p.resolveProvider,typeof t.createWorkspaceTools,typeof c.runCreationTurn,typeof i.parseMmoIntent,typeof n.planMmo].join(','))",
    ],
    { cwd: root, timeoutMs: 30_000 },
  )
  requireProcessSuccess('subpath-import-probe', probe)
  expect(probe.stderr).toBe('')
  expect(probe.stdout).toBe('function,function,function,function,function,function,function')
}, 45_000)

describe('the 3D content pipeline through the agent door', () => {
  test('a cinematic 3D brief lands content records with no prompt asked and no secret written', async () => {
    const directory = workspace()
    const result = await run(
      directory,
      [
        'Salvage Run', '--agent', '--json', '--3d',
        '--gameplay', 'Crews salvage derelict stations, with a story intro cinematic.',
        '--art', 'Grounded, with an ambient hum of machinery.',
        '--into', 'game',
        '--provider', 'openai', '--model', 'explicit-model', '--api-key-env', 'TEST_MODEL_KEY',
        '--no-launch',
      ],
      { environment: { TEST_MODEL_KEY: secret } },
    )
    // stdin was closed at spawn: a prompt would have died, not waited.
    expect(result.status).toBe(0)
    const output = jsonLine(result)
    expect(output.ok).toBeTrue()
    expect(output.request.plan.content.style.setting).toBe('science-fiction')

    const generators = output.request.plan.content.generators as Array<{ id: string; status: string }>
    expect(generators.find(({ id }) => id === 'model-generation')?.status).toBe('planned')
    expect(generators.find(({ id }) => id === 'voice-acting')?.status).toBe('absent')

    const contentDirectory = join(directory, 'game', 'kei-mmo', 'content')
    const written = [
      readFileSync(join(contentDirectory, 'manifest.json'), 'utf8'),
      readFileSync(join(contentDirectory, 'pipelines.json'), 'utf8'),
      readFileSync(join(contentDirectory, 'check.mjs'), 'utf8'),
      readFileSync(join(contentDirectory, 'cutscenes', 'salvage-run-arrival.json'), 'utf8'),
      readFileSync(join(directory, 'game', 'src', 'shared', 'cutscene.ts'), 'utf8'),
    ]
    for (const contents of written) {
      expect(contents).not.toContain(secret)
      expect(contents).not.toContain('TEST_MODEL_KEY')
    }
    expect(JSON.parse(written[3]!).cutsceneVersion).toBe(1)
  })
})
