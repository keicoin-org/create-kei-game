import { describe, expect, test } from 'bun:test'

import {
  MAX_BRIEF_LENGTH,
  MAX_MODEL_LENGTH,
  HarnessRequestError,
  assertSafeConfigFields,
  createHarnessRequest,
  type HarnessRequestInput,
} from '../src/harness.js'
import { ProviderError } from '../src/providers.js'

const sampleSecret = 'sk-never-serialize-this-value'

function valid(overrides: Partial<HarnessRequestInput> = {}): HarnessRequestInput {
  return {
    project: 'My Game',
    selection: { kind: 'blank' },
    baseDirectory: '/workspace',
    force: false,
    provider: { provider: 'openai' },
    model: 'explicit-model-id',
    brief: 'Build a small cooperative adventure.',
    launch: false,
    ...overrides,
  }
}

describe('sanitized harness request', () => {
  test('normalizes a project, source, and text without retaining a credential value', () => {
    const request = createHarnessRequest(valid(), { OPENAI_API_KEY: sampleSecret })
    expect(request).toEqual({
      project: { title: 'My Game', slug: 'my-game' },
      selection: { kind: 'blank' },
      baseDirectory: '/workspace',
      force: false,
      provider: {
        provider: 'openai',
        protocol: 'responses',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyEnv: 'OPENAI_API_KEY',
      },
      model: 'explicit-model-id',
      brief: 'Build a small cooperative adventure.',
      launch: false,
    })
    expect(JSON.stringify(request)).not.toContain(sampleSecret)
  })

  test('accepts an already-normalized project identity, destination, force, and launch', () => {
    const request = createHarnessRequest(
      valid({
        project: { title: 'My Game', slug: 'my-game' },
        destination: './games/mine',
        force: true,
        launch: true,
      }),
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
      valid({
        provider: { provider: 'qwen', baseUrl: 'https://workspace.example/v1' },
      }),
      { DASHSCOPE_API_KEY: 'present' },
    )
    expect(qwen.provider.protocol).toBe('chat_completions')
    expect(() =>
      createHarnessRequest(valid({ provider: { provider: 'qwen' } }), {
        DASHSCOPE_API_KEY: 'present',
      }),
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
    [undefined, 'invalid_project'],
    ['', 'invalid_project'],
    [{ title: 'My Game', slug: 'wrong' }, 'invalid_project'],
  ])('rejects project %p', (project, code) => {
    expect(() => createHarnessRequest(valid({ project }), { OPENAI_API_KEY: 'present' })).toThrow(
      expect.objectContaining({ code }),
    )
  })

  test.each([
    { kind: 'blank' },
    { kind: 'template', template: 'button' },
    { kind: 'existing', path: './game' },
    { kind: 'repository', url: 'https://github.com/keicoin-org/button' },
  ])('accepts compatible source selection %p', (selection) => {
    const request = createHarnessRequest(valid({ selection }), { OPENAI_API_KEY: 'present' })
    expect(request.selection.kind).toBe(selection.kind)
  })

  test.each([
    undefined,
    { kind: 'missing' },
    { kind: 'template', template: 'missing' },
    { kind: 'existing', path: ' ' },
    { kind: 'repository', url: 'http://github.com/owner/repo' },
  ])('rejects incompatible source selection %p', (selection) => {
    expect(() => createHarnessRequest(valid({ selection }), { OPENAI_API_KEY: 'present' })).toThrow(
      expect.objectContaining({ code: 'invalid_source' }),
    )
  })

  test.each([undefined, '', '   ', 'x'.repeat(MAX_MODEL_LENGTH + 1)])(
    'rejects missing, blank, or oversized model',
    (model) => {
      expect(() => createHarnessRequest(valid({ model }), { OPENAI_API_KEY: 'present' })).toThrow(
        expect.objectContaining({ code: 'invalid_model' }),
      )
    },
  )

  test.each([undefined, '', '   ', 'x'.repeat(MAX_BRIEF_LENGTH + 1)])(
    'rejects missing, blank, or oversized brief',
    (brief) => {
      expect(() => createHarnessRequest(valid({ brief }), { OPENAI_API_KEY: 'present' })).toThrow(
        expect.objectContaining({ code: 'invalid_brief' }),
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
