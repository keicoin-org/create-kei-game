import { describe, expect, test } from 'bun:test'

import {
  MAX_AGENT_CONFIG_BYTES,
  createAgentIntent,
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

const GAMEPLAY = 'Crews salvage derelict stations and haul cargo home.'

const complete: AgentAnswers = {
  name: 'My MMO',
  dimension: '3d',
  gameplay: GAMEPLAY,
  provider: 'openai',
  model: 'model-from-config',
  apiKeyEnv: 'OPENAI_API_KEY',
  launch: false,
}

describe('bounded agent config reader', () => {
  test('reads JSON split across byte and string chunks, including Unicode', async () => {
    const config = await readAgentConfig(
      chunks('{"name":"Caf', new TextEncoder().encode('é"'), ',"dimension":"2d"}'),
    )
    expect(config).toEqual({ name: 'Café', dimension: '2d' })
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

  test.each(['source', 'template', 'from'])('refuses the retired field %s by name', async (field) => {
    const error = await readAgentConfig(chunks(JSON.stringify({ [field]: 'blank' }))).catch((reason) => reason)
    expect(error).toMatchObject({ code: 'retired_field', details: { field } })
    expect(String(error)).toMatch(/planner|harness decides|no source/)
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
    for (const json of ['{"name":1}', '{"launch":"false"}', '{"force":1}', '{"intentVersion":2}']) {
      await expect(readAgentConfig(chunks(json))).rejects.toMatchObject({ code: 'invalid_config' })
    }
  })
})

describe('agent request resolution', () => {
  test('creates a credential-free request and defaults launch true and force false', () => {
    const config = { ...complete, launch: undefined }
    const request = createAgentRequest(config, {}, '/workspace', { OPENAI_API_KEY: secret })
    expect(request.launch).toBeTrue()
    expect(request.force).toBeFalse()
    expect(request.provider.apiKeyEnv).toBe('OPENAI_API_KEY')
    expect(request.intent.gameplay).toBe(GAMEPLAY)
    expect(JSON.stringify(request)).not.toContain(secret)
  })

  test('the plan, its selection, and the brief are derived, never supplied', () => {
    const request = createAgentRequest(complete, {}, '/workspace', { OPENAI_API_KEY: 'present' })
    expect(request.plan.planVersion).toBe(2)
    expect(request.plan.intent).toEqual(request.intent)
    expect(request.selection).toEqual({ kind: 'blank' })
    expect(request.brief).toContain('CAPABILITY PACKETS')
    expect(request.brief).toContain(request.intent.gameplay)
  })

  test('explicit overrides win field-by-field, including false booleans', () => {
    const config: AgentAnswers = {
      name: 'Config Name',
      dimension: '2d',
      gameplay: 'Config gameplay',
      world: 'Config world',
      into: './config',
      force: true,
      provider: 'custom',
      model: 'config-model',
      apiKeyEnv: 'CONFIG_KEY',
      baseUrl: 'https://config.example/v1',
      protocol: 'messages',
      launch: true,
    }
    const overrides: AgentOverrides = {
      name: 'Flag Name',
      dimension: '3d',
      gameplay: 'Flag gameplay',
      into: './flag',
      force: false,
      provider: 'openai',
      model: 'flag-model',
      apiKeyEnv: 'FLAG_KEY',
      baseUrl: 'https://flag.example/v1',
      protocol: 'responses',
      launch: false,
    }
    const request = createAgentRequest(config, overrides, '/workspace', { FLAG_KEY: 'present' })
    expect(request).toMatchObject({
      project: { title: 'Flag Name', slug: 'flag-name' },
      destination: './flag',
      force: false,
      provider: {
        provider: 'openai',
        protocol: 'responses',
        baseUrl: 'https://flag.example/v1',
        apiKeyEnv: 'FLAG_KEY',
      },
      model: 'flag-model',
      launch: false,
    })
    expect(request.intent).toMatchObject({
      dimension: '3d',
      gameplay: 'Flag gameplay',
      world: 'Config world',
    })
  })

  test('brief is the compatibility spelling of gameplay, and loses to it', () => {
    const fromBrief = createAgentRequest(
      { ...complete, gameplay: undefined, brief: 'Legacy description' },
      {},
      '/workspace',
      { OPENAI_API_KEY: 'present' },
    )
    expect(fromBrief.intent.gameplay).toBe('Legacy description')

    const both = createAgentRequest(
      { ...complete, gameplay: 'Current', brief: 'Legacy' },
      {},
      '/workspace',
      { OPENAI_API_KEY: 'present' },
    )
    expect(both.intent.gameplay).toBe('Current')
  })

  test('reports every missing required field once in stable order', () => {
    expect(() => createAgentRequest({}, {}, '/workspace', {})).toThrow(
      expect.objectContaining({
        code: 'missing_inputs',
        details: { missing: ['name', 'gameplay', 'provider', 'model', 'apiKeyEnv'] },
      }),
    )
  })

  test('a plan-only intent needs no provider and no credential at all', () => {
    const intent = createAgentIntent({ name: 'Plan Me', gameplay: 'Questing' }, {})
    expect(intent).toMatchObject({ name: 'Plan Me', dimension: 'auto' })
    expect(() => createAgentIntent({ gameplay: 'Questing' }, {})).toThrow(
      expect.objectContaining({ code: 'missing_inputs', details: { missing: ['name'] } }),
    )
  })

  test('an unsupported dimension is refused with the intent code, not silently defaulted', () => {
    expect(() => createAgentIntent({ ...complete, dimension: 'holographic' }, {})).toThrow(
      expect.objectContaining({ code: 'invalid_dimension' }),
    )
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
