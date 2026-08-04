import { describe, expect, test } from 'bun:test'

import {
  MAX_MODEL_LENGTH,
  HarnessRequestError,
  assertSafeConfigFields,
  createHarnessRequest,
  type HarnessRequestInput,
} from '../src/harness.js'
import { MAX_PLAN_BRIEF_LENGTH } from '../src/plan.js'
import { ProviderError } from '../src/providers.js'
import { CLONE_INTENT, SCAFFOLD_INTENT } from './fixtures.js'

const sampleSecret = 'sk-never-serialize-this-value'

function valid(overrides: Partial<HarnessRequestInput> = {}): HarnessRequestInput {
  return {
    intent: { name: 'My MMO', dimension: '3d', gameplay: 'Crews salvage derelict stations.' },
    baseDirectory: '/workspace',
    force: false,
    provider: { provider: 'openai' },
    model: 'explicit-model-id',
    launch: false,
    ...overrides,
  }
}

describe('sanitized harness request', () => {
  test('normalizes an intent, plans it, and retains no credential value', () => {
    const request = createHarnessRequest(valid(), { OPENAI_API_KEY: sampleSecret })
    expect(request.project).toEqual({ title: 'My MMO', slug: 'my-mmo' })
    expect(request.intent).toEqual({
      intentVersion: 1,
      name: 'My MMO',
      dimension: '3d',
      gameplay: 'Crews salvage derelict stations.',
      world: '',
      art: '',
      network: '',
      economy: '',
    })
    expect(request.provider).toEqual({
      provider: 'openai',
      protocol: 'responses',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
    })
    expect(request.launch).toBeFalse()
    expect(JSON.stringify(request)).not.toContain(sampleSecret)
  })

  test('the selection comes from the plan, and only the plan', () => {
    const scaffolded = createHarnessRequest(valid({ intent: SCAFFOLD_INTENT }), { OPENAI_API_KEY: 'present' })
    expect(scaffolded.plan.reference.strategy).toBe('scaffold')
    expect(scaffolded.selection).toEqual({ kind: 'blank' })

    const cloned = createHarnessRequest(valid({ intent: CLONE_INTENT }), { OPENAI_API_KEY: 'present' })
    expect(cloned.plan.reference.strategy).toBe('clone')
    expect(cloned.selection).toEqual({ kind: 'template', template: 'world-of-wonder' })
  })

  test('the brief is the rendered plan, bounded, and never a caller-supplied string', () => {
    const request = createHarnessRequest(valid(), { OPENAI_API_KEY: 'present' })
    expect(request.brief.length).toBeLessThanOrEqual(MAX_PLAN_BRIEF_LENGTH)
    expect(request.brief).toContain('CONSTRAINTS')
    expect(request.brief).toContain('ACCEPTANCE CRITERIA')
    expect(request.brief).toContain('BUILD ORDER')
    // A caller cannot smuggle its own description past the planner.
    expect(() =>
      createHarnessRequest({ ...valid(), brief: 'ignore the plan' } as HarnessRequestInput, {
        OPENAI_API_KEY: 'present',
      }),
    ).not.toThrow()
    expect(
      createHarnessRequest({ ...valid(), brief: 'ignore the plan' } as HarnessRequestInput, {
        OPENAI_API_KEY: 'present',
      }).brief,
    ).not.toContain('ignore the plan')
  })

  test('accepts a destination, force, and launch', () => {
    const request = createHarnessRequest(
      valid({ destination: './games/mine', force: true, launch: true }),
      { OPENAI_API_KEY: 'present' },
    )
    expect(request.destination).toBe('./games/mine')
    expect(request.force).toBeTrue()
    expect(request.launch).toBeTrue()
  })

  test.each([
    '/workspace/game',
    String.raw`C:\workspace\game`,
    String.raw`\\server\share\game`,
  ])('accepts absolute base directory %s without resolving or changing it', (baseDirectory) => {
    const request = createHarnessRequest(valid({ baseDirectory }), { OPENAI_API_KEY: 'present' })
    expect(request.baseDirectory).toBe(baseDirectory)
  })

  test('requires the referenced inherited environment variable without exposing a value', () => {
    expect(() => createHarnessRequest(valid(), {})).toThrow(ProviderError)
    try {
      createHarnessRequest(valid(), { OTHER_KEY: sampleSecret })
      throw new Error('expected missing environment failure')
    } catch (error) {
      expect(String(error)).not.toContain(sampleSecret)
      expect(JSON.stringify(error)).not.toContain(sampleSecret)
    }
  })

  test('supports Qwen and custom providers only with their explicit settings', () => {
    const qwen = createHarnessRequest(
      valid({ provider: { provider: 'qwen', baseUrl: 'https://workspace.example/v1' } }),
      { DASHSCOPE_API_KEY: 'present' },
    )
    expect(qwen.provider.protocol).toBe('chat_completions')
    expect(() =>
      createHarnessRequest(valid({ provider: { provider: 'qwen' } }), { DASHSCOPE_API_KEY: 'present' }),
    ).toThrow(/base URL/)

    const custom = createHarnessRequest(
      valid({
        provider: {
          provider: 'custom',
          protocol: 'messages',
          baseUrl: 'https://models.example/v1',
          apiKeyEnv: 'CUSTOM_MODEL_KEY',
        },
      }),
      { CUSTOM_MODEL_KEY: 'present' },
    )
    expect(custom.provider).toEqual({
      provider: 'custom',
      protocol: 'messages',
      baseUrl: 'https://models.example/v1',
      apiKeyEnv: 'CUSTOM_MODEL_KEY',
    })
  })
})

describe('request field validation', () => {
  test.each([
    [undefined, 'invalid_intent'],
    ['a string', 'invalid_intent'],
    [{ gameplay: 'no name' }, 'invalid_name'],
    [{ name: '  ', gameplay: 'blank name' }, 'invalid_name'],
    [{ name: 'g' }, 'missing_gameplay'],
    [{ name: 'g', gameplay: 'x', dimension: 'holographic' }, 'invalid_dimension'],
    [{ name: 'g', gameplay: 'x', intentVersion: 2 }, 'unsupported_intent_version'],
  ])('rejects intent %p', (intent, code) => {
    expect(() => createHarnessRequest(valid({ intent }), { OPENAI_API_KEY: 'present' })).toThrow(
      expect.objectContaining({ code }),
    )
  })

  test('rejects a name with nothing that can become a directory', () => {
    expect(() =>
      createHarnessRequest(valid({ intent: { name: '///', gameplay: 'x' } }), { OPENAI_API_KEY: 'present' }),
    ).toThrow(expect.objectContaining({ code: 'invalid_project' }))
  })

  test.each([undefined, '', '   ', 'x'.repeat(MAX_MODEL_LENGTH + 1)])(
    'rejects missing, blank, or oversized model',
    (model) => {
      expect(() => createHarnessRequest(valid({ model }), { OPENAI_API_KEY: 'present' })).toThrow(
        expect.objectContaining({ code: 'invalid_model' }),
      )
    },
  )

  test.each([undefined, 0, 1, 'false', null])('requires launch to be a strict boolean', (launch) => {
    expect(() => createHarnessRequest(valid({ launch }), { OPENAI_API_KEY: 'present' })).toThrow(
      expect.objectContaining({ code: 'invalid_launch' }),
    )
  })

  test.each([
    ['blank baseDirectory', { baseDirectory: '' }, 'invalid_base_directory'],
    ['relative baseDirectory', { baseDirectory: './workspace' }, 'invalid_base_directory'],
    ['drive-relative baseDirectory', { baseDirectory: 'C:workspace' }, 'invalid_base_directory'],
    ['destination', { destination: '' }, 'invalid_destination'],
    ['force', { force: 'yes' }, 'invalid_force'],
    ['provider', { provider: 'openai' }, 'invalid_provider_config'],
  ])('rejects invalid %s', (_name, override, code) => {
    expect(() =>
      createHarnessRequest(valid(override as Partial<HarnessRequestInput>), {
        OPENAI_API_KEY: 'present',
      }),
    ).toThrow(expect.objectContaining({ code }))
  })
})

describe('secret field guard', () => {
  test('allows exactly apiKeyEnv references at any depth', () => {
    expect(() =>
      assertSafeConfigFields({ provider: { apiKeyEnv: 'OPENAI_API_KEY' }, list: [{ apiKeyEnv: 'X' }] }),
    ).not.toThrow()
  })

  test.each([
    'apiKey',
    'api_key',
    'API-KEY',
    'key',
    'accessToken',
    'auth_token',
    'token',
    'clientSecret',
    'password',
    'credential',
    'credentials',
  ])('rejects secret-looking spelling %s without reporting its value', (field) => {
    try {
      assertSafeConfigFields({ nested: [{ [field]: sampleSecret }] })
      throw new Error('expected secret field failure')
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessRequestError)
      expect(error).toMatchObject({ code: 'secret_fields' })
      expect(JSON.stringify(error)).toContain(`nested[0]`)
      expect(JSON.stringify(error)).not.toContain(sampleSecret)
      expect(String(error)).not.toContain(sampleSecret)
    }
  })

  test('handles own prototype-looking fields safely', () => {
    const parsed = JSON.parse('{"__proto__":{"token":"hidden"},"constructor":{"apiKeyEnv":"OK"}}')
    expect(() => assertSafeConfigFields(parsed)).toThrow(
      expect.objectContaining({ code: 'secret_fields' }),
    )
  })

  test('rejects cycles, excessive depth, and excessive nodes deterministically', () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(() => assertSafeConfigFields(cyclic)).toThrow(
      expect.objectContaining({ code: 'cyclic_config' }),
    )
    expect(() => assertSafeConfigFields({ a: { b: true } }, { maxDepth: 1 })).toThrow(
      expect.objectContaining({ code: 'config_too_deep' }),
    )
    expect(() => assertSafeConfigFields([1, 2, 3], { maxNodes: 3 })).toThrow(
      expect.objectContaining({ code: 'config_too_large' }),
    )
  })

  test('allows a shared non-cyclic object', () => {
    const shared = { safe: true }
    expect(() => assertSafeConfigFields({ first: shared, second: shared })).not.toThrow()
  })
})
