import { describe, expect, test } from 'bun:test'

import {
  MAX_AGENT_CONFIG_BYTES,
  AgentError,
  createAgentRequest,
  readAgentConfig,
  type AgentAnswers,
  type AgentOverrides,
} from '../src/agent.js'
import { HarnessRequestError } from '../src/harness.js'
import { ProviderError } from '../src/providers.js'

const secret = 'sk-never-return-this'

async function* chunks(...values: Array<string | Uint8Array>): AsyncIterable<string | Uint8Array> {
  yield* values
}

const complete: AgentAnswers = {
  name: 'My Game',
  source: 'blank',
  provider: 'openai',
  model: 'model-from-config',
  apiKeyEnv: 'OPENAI_API_KEY',
  brief: 'Build a puzzle game.',
  launch: false,
}

describe('bounded agent config reader', () => {
  test('reads JSON split across byte and string chunks, including Unicode', async () => {
    const config = await readAgentConfig(
      chunks('{"name":"Caf', new TextEncoder().encode('é"'), ',"source":"blank"}'),
    )
    expect(config).toEqual({ name: 'Café', source: 'blank' })
  })

  test('accepts exactly 64 KiB and rejects one byte more before parsing', async () => {
    await expect(readAgentConfig(chunks(' '.repeat(MAX_AGENT_CONFIG_BYTES - 2), '{}'))).resolves.toEqual({})
    await expect(
      readAgentConfig(chunks(' '.repeat(MAX_AGENT_CONFIG_BYTES - 1), '{}')),
    ).rejects.toMatchObject({ code: 'config_too_large' })
  })

  test.each(['', '   ', 'null', '[]', 'true', '{', '{} trailing'])('rejects invalid object JSON %p', async (text) => {
    await expect(readAgentConfig(chunks(text))).rejects.toMatchObject({ code: 'invalid_config' })
  })

  test('rejects invalid UTF-8 without decoder or content details', async () => {
    try {
      await readAgentConfig(chunks(new Uint8Array([0xc3, 0x28])))
      throw new Error('expected invalid utf-8')
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_config', details: { field: 'agentConfig' } })
      expect(JSON.stringify(error)).not.toContain('195')
    }
  })

  test('rejects unknown fields deterministically', async () => {
    await expect(readAgentConfig(chunks('{"zebra":1,"alpha":2}'))).rejects.toMatchObject({
      code: 'invalid_config',
      details: { field: 'alpha' },
    })
  })

  test.each(['apiKey', 'api_key', 'token', 'clientSecret', 'password', 'credentials'])(
    'rejects nested secret field %s without retaining its value',
    async (field) => {
      try {
        await readAgentConfig(chunks(JSON.stringify({ provider: { [field]: secret } })))
        throw new Error('expected secret field rejection')
      } catch (error) {
        expect(error).toBeInstanceOf(HarnessRequestError)
        expect(error).toMatchObject({ code: 'secret_fields' })
        expect(JSON.stringify(error)).not.toContain(secret)
        expect(String(error)).not.toContain(secret)
      }
    },
  )

  test('allows apiKeyEnv but enforces strict scalar types', async () => {
    await expect(readAgentConfig(chunks('{"apiKeyEnv":"SAFE_REF","launch":false}'))).resolves.toEqual({
      apiKeyEnv: 'SAFE_REF',
      launch: false,
    })
    for (const json of ['{"name":1}', '{"launch":"false"}', '{"force":1}']) {
      await expect(readAgentConfig(chunks(json))).rejects.toMatchObject({ code: 'invalid_config' })
    }
  })
})

describe('agent request resolution', () => {
  test('creates a credential-free plan and defaults launch true and force false', () => {
    const config = { ...complete, launch: undefined }
    const request = createAgentRequest(config, {}, '/workspace', { OPENAI_API_KEY: secret })
    expect(request.launch).toBeTrue()
    expect(request.force).toBeFalse()
    expect(request.provider.apiKeyEnv).toBe('OPENAI_API_KEY')
    expect(JSON.stringify(request)).not.toContain(secret)
  })

  test('explicit overrides win field-by-field, including false booleans', () => {
    const config: AgentAnswers = {
      name: 'Config Name',
      source: 'template',
      template: 'button',
      into: './config',
      force: true,
      provider: 'custom',
      model: 'config-model',
      apiKeyEnv: 'CONFIG_KEY',
      baseUrl: 'https://config.example/v1',
      protocol: 'messages',
      brief: 'Config brief',
      launch: true,
    }
    const overrides: AgentOverrides = {
      name: 'Flag Name',
      source: 'blank',
      template: undefined,
      into: './flag',
      force: false,
      provider: 'openai',
      model: 'flag-model',
      apiKeyEnv: 'FLAG_KEY',
      baseUrl: 'https://flag.example/v1',
      protocol: 'responses',
      brief: 'Flag brief',
      launch: false,
    }
    const request = createAgentRequest(config, overrides, '/workspace', { FLAG_KEY: 'present' })
    expect(request).toMatchObject({
      project: { title: 'Flag Name', slug: 'flag-name' },
      selection: { kind: 'blank' },
      destination: './flag',
      force: false,
      provider: {
        provider: 'openai',
        protocol: 'responses',
        baseUrl: 'https://flag.example/v1',
        apiKeyEnv: 'FLAG_KEY',
      },
      model: 'flag-model',
      brief: 'Flag brief',
      launch: false,
    })
  })

  test('reports every missing required field once in stable order', () => {
    expect(() => createAgentRequest({}, {}, '/workspace', {})).toThrow(
      expect.objectContaining({
        code: 'missing_inputs',
        details: {
          missing: ['name', 'source', 'provider', 'model', 'apiKeyEnv', 'brief'],
        },
      }),
    )
    expect(() =>
      createAgentRequest(
        { name: 'g', source: 'template', provider: 'openai', model: 'm', apiKeyEnv: 'K', brief: 'b' },
        {},
        '/workspace',
        {},
      ),
    ).toThrow(expect.objectContaining({ code: 'missing_inputs', details: { missing: ['template'] } }))
    expect(() =>
      createAgentRequest(
        { name: 'g', source: 'repository', provider: 'openai', model: 'm', apiKeyEnv: 'K', brief: 'b' },
        {},
        '/workspace',
        {},
      ),
    ).toThrow(expect.objectContaining({ code: 'missing_inputs', details: { missing: ['from'] } }))
  })

  test('requires an explicit source and does not infer it from template or from', () => {
    for (const config of [{ ...complete, source: undefined, template: 'button' }, { ...complete, source: undefined, from: './x' }]) {
      expect(() => createAgentRequest(config, {}, '/workspace', { OPENAI_API_KEY: 'present' })).toThrow(
        expect.objectContaining({ code: 'missing_inputs', details: { missing: ['source'] } }),
      )
    }
  })

  test('source override clears only incompatible config details and keeps explicit contradictions', () => {
    const config = { ...complete, source: 'template', template: 'button', from: undefined }
    expect(
      createAgentRequest(config, { source: 'blank' }, '/workspace', { OPENAI_API_KEY: 'present' })
        .selection,
    ).toEqual({ kind: 'blank' })
    expect(() =>
      createAgentRequest(
        config,
        { source: 'blank', template: 'world-of-wonder' },
        '/workspace',
        { OPENAI_API_KEY: 'present' },
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_config', details: { field: 'source' } }))
    expect(() =>
      createAgentRequest(
        { ...complete, source: 'blank', template: 'button' },
        {},
        '/workspace',
        { OPENAI_API_KEY: 'present' },
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_config', details: { field: 'source' } }))
  })

  test.each([
    [{ ...complete, source: 'template', template: 'button' }, 'template'],
    [{ ...complete, source: 'local', from: './game' }, 'existing'],
    [{ ...complete, source: 'repository', from: 'https://github.com/keicoin-org/button' }, 'repository'],
  ] as const)('resolves explicit source details', (config, kind) => {
    const request = createAgentRequest(config, {}, '/workspace', { OPENAI_API_KEY: 'present' })
    expect(request.selection.kind).toBe(kind)
  })

  test('supports explicit Qwen and custom provider settings', () => {
    const qwen = createAgentRequest(
      { ...complete, provider: 'qwen', apiKeyEnv: 'QWEN_KEY', baseUrl: 'https://qwen.example/v1' },
      {},
      '/workspace',
      { QWEN_KEY: 'present' },
    )
    expect(qwen.provider.protocol).toBe('chat_completions')

    const custom = createAgentRequest(
      {
        ...complete,
        provider: 'custom',
        apiKeyEnv: 'CUSTOM_KEY',
        baseUrl: 'https://custom.example/v1',
        protocol: 'messages',
      },
      {},
      '/workspace',
      { CUSTOM_KEY: 'present' },
    )
    expect(custom.provider.provider).toBe('custom')
  })

  test('rejects invalid config types even when called without the reader', () => {
    expect(() => createAgentRequest({ ...complete, launch: 'false' }, {}, '/workspace', {})).toThrow(
      expect.objectContaining({ code: 'invalid_config', details: { field: 'launch' } }),
    )
  })

  test('propagates stable provider credential errors without exposing a value', () => {
    expect(() => createAgentRequest(complete, {}, '/workspace', {})).toThrow(ProviderError)
    try {
      createAgentRequest(complete, {}, '/workspace', { OTHER_KEY: secret })
      throw new Error('expected credential error')
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(secret)
    }
  })
})
