import { describe, expect, test } from 'bun:test'

import {
  PROVIDERS,
  ProviderError,
  requireApiKeyEnvironment,
  resolveProvider,
} from '../src/providers.js'

describe('provider registry', () => {
  test('contains only the supported user-facing providers and no model defaults', () => {
    expect(PROVIDERS.map(({ id }) => id)).toEqual([
      'anthropic',
      'openai',
      'zai',
      'qwen',
      'deepseek',
      'openrouter',
      'custom',
    ])
    expect(JSON.stringify(PROVIDERS)).not.toContain('model')
    expect(JSON.stringify(PROVIDERS).toLowerCase()).not.toContain('grok')
  })

  test.each([
    ['anthropic', 'messages', 'https://api.anthropic.com', 'ANTHROPIC_API_KEY'],
    ['openai', 'responses', 'https://api.openai.com/v1', 'OPENAI_API_KEY'],
    ['zai', 'chat_completions', 'https://api.z.ai/api/paas/v4', 'ZAI_API_KEY'],
    ['deepseek', 'chat_completions', 'https://api.deepseek.com', 'DEEPSEEK_API_KEY'],
    ['openrouter', 'chat_completions', 'https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY'],
  ] as const)('resolves %s official defaults', (provider, protocol, baseUrl, apiKeyEnv) => {
    expect(resolveProvider({ provider })).toEqual({ provider, protocol, baseUrl, apiKeyEnv })
  })

  test('requires a regional URL for Qwen but keeps its safe defaults', () => {
    expect(() => resolveProvider({ provider: 'qwen' })).toThrow(ProviderError)
    expect(() => resolveProvider({ provider: 'qwen' })).toThrow(/requires an HTTPS base URL/)
    expect(resolveProvider({ provider: 'qwen', baseUrl: 'https://workspace.example/v1/' })).toEqual({
      provider: 'qwen',
      protocol: 'chat_completions',
      baseUrl: 'https://workspace.example/v1',
      apiKeyEnv: 'DASHSCOPE_API_KEY',
    })
  })

  test('requires every custom transport setting', () => {
    expect(() => resolveProvider({ provider: 'custom' })).toThrow(/protocol/)
    expect(() => resolveProvider({ provider: 'custom', protocol: 'messages' })).toThrow(/base URL/)
    expect(() =>
      resolveProvider({ provider: 'custom', protocol: 'messages', baseUrl: 'https://llm.example' }),
    ).toThrow(/environment name/)
    expect(
      resolveProvider({
        provider: 'custom',
        protocol: 'messages',
        baseUrl: 'https://llm.example/v1',
        apiKeyEnv: 'MY_LLM_KEY',
      }),
    ).toEqual({
      provider: 'custom',
      protocol: 'messages',
      baseUrl: 'https://llm.example/v1',
      apiKeyEnv: 'MY_LLM_KEY',
    })
  })
})

describe('provider validation', () => {
  test('rejects unknown providers, protocols, and built-in protocol mismatches', () => {
    expect(() => resolveProvider({ provider: 'unknown' })).toThrow(/not supported/)
    expect(() =>
      resolveProvider({
        provider: 'custom',
        protocol: 'legacy',
        baseUrl: 'https://llm.example',
        apiKeyEnv: 'KEY',
      }),
    ).toThrow(/protocol is not supported/)
    expect(() => resolveProvider({ provider: 'openai', protocol: 'messages' })).toThrow(
      /does not match/,
    )
  })

  test.each([
    'http://llm.example',
    'not a URL',
    'https://user:pass@llm.example',
    'https://llm.example?token=hidden',
    'https://llm.example#secret',
    'https://llm.example/v1?',
    'https://llm.example/v1#',
  ])('rejects unsafe base URL %s', (baseUrl) => {
    expect(() => resolveProvider({ provider: 'qwen', baseUrl })).toThrow(/base URL/)
  })

  test.each(['', '9KEY', 'MY-KEY', 'KEY NAME'])('rejects invalid env name %s', (apiKeyEnv) => {
    expect(() => resolveProvider({ provider: 'openai', apiKeyEnv })).toThrow(/environment name/)
  })

  test('allows overriding a built-in base URL and env reference without reading the key', () => {
    expect(
      resolveProvider({
        provider: 'openai',
        baseUrl: 'https://gateway.example/openai',
        apiKeyEnv: 'GATEWAY_KEY',
      }),
    ).toEqual({
      provider: 'openai',
      protocol: 'responses',
      baseUrl: 'https://gateway.example/openai',
      apiKeyEnv: 'GATEWAY_KEY',
    })
  })
})

describe('credential environment presence', () => {
  const provider = resolveProvider({ provider: 'openai' })

  test('accepts a nonblank inherited value and returns nothing', () => {
    expect(requireApiKeyEnvironment(provider, { OPENAI_API_KEY: 'top-secret-value' })).toBeUndefined()
  })

  test.each([{}, { OPENAI_API_KEY: '' }, { OPENAI_API_KEY: '   ' }])(
    'rejects an absent or blank value without exposing it',
    (environment) => {
      expect(() => requireApiKeyEnvironment(provider, environment)).toThrow(/OPENAI_API_KEY/)
    },
  )

  test.each(['constructor', '__proto__', 'toString'])(
    'reports inherited object property %s as unset instead of a stray runtime error',
    (apiKeyEnv) => {
      const inherited = resolveProvider({
        provider: 'custom',
        protocol: 'messages',
        baseUrl: 'https://llm.example',
        apiKeyEnv,
      })
      expect(() => requireApiKeyEnvironment(inherited, {})).toThrow(ProviderError)
      expect(() => requireApiKeyEnvironment(inherited, {})).toThrow(/is not set/)
    },
  )

  test('never includes a credential value in errors or error data', () => {
    const sampleSecret = 'sk-super-sensitive-sample'
    try {
      requireApiKeyEnvironment(provider, { OTHER_KEY: sampleSecret })
      throw new Error('expected credential validation to fail')
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(sampleSecret)
      expect(String(error)).not.toContain(sampleSecret)
    }
  })
})
