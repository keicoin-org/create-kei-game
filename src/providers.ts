export const PROVIDER_PROTOCOLS = ['messages', 'responses', 'chat_completions'] as const

export type ProviderProtocol = (typeof PROVIDER_PROTOCOLS)[number]

export const PROVIDER_IDS = [
  'anthropic',
  'openai',
  'zai',
  'qwen',
  'deepseek',
  'openrouter',
  'custom',
] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]

export interface ProviderDefinition {
  readonly id: ProviderId
  readonly label: string
  readonly protocol?: ProviderProtocol
  readonly baseUrl?: string
  readonly apiKeyEnv?: string
}

export const PROVIDERS: readonly ProviderDefinition[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    protocol: 'messages',
    baseUrl: 'https://api.anthropic.com',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'responses',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  {
    id: 'zai',
    label: 'Z.ai',
    protocol: 'chat_completions',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    apiKeyEnv: 'ZAI_API_KEY',
  },
  {
    id: 'qwen',
    label: 'Qwen / DashScope',
    protocol: 'chat_completions',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'chat_completions',
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    protocol: 'chat_completions',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
  { id: 'custom', label: 'Custom provider' },
] as const

export type ProviderErrorCode =
  | 'invalid_provider'
  | 'missing_base_url'
  | 'invalid_base_url'
  | 'missing_protocol'
  | 'invalid_protocol'
  | 'protocol_mismatch'
  | 'missing_api_key_env'
  | 'invalid_api_key_env'
  | 'api_key_env_unset'

export class ProviderError extends Error {
  override readonly name = 'ProviderError'

  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly details: Readonly<Record<string, string>> = {},
  ) {
    super(message)
  }
}

export interface ProviderInput {
  readonly provider: string
  readonly protocol?: string
  readonly baseUrl?: string
  readonly apiKeyEnv?: string
}

export interface ResolvedProvider {
  readonly provider: ProviderId
  readonly protocol: ProviderProtocol
  readonly baseUrl: string
  readonly apiKeyEnv: string
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

function providerNamed(value: string): ProviderDefinition {
  const provider = PROVIDERS.find(({ id }) => id === value)
  if (!provider) {
    throw new ProviderError('invalid_provider', 'Provider is not supported.', { field: 'provider' })
  }
  return provider
}

function protocolNamed(value: string | undefined, required: boolean): ProviderProtocol | undefined {
  if (!value) {
    if (required) {
      throw new ProviderError('missing_protocol', 'Custom providers require a protocol.', {
        field: 'protocol',
      })
    }
    return undefined
  }
  if (!PROVIDER_PROTOCOLS.includes(value as ProviderProtocol)) {
    throw new ProviderError('invalid_protocol', 'Provider protocol is not supported.', {
      field: 'protocol',
    })
  }
  return value as ProviderProtocol
}

function httpsBaseUrl(value: string | undefined): string {
  if (!value?.trim()) {
    throw new ProviderError('missing_base_url', 'This provider requires an HTTPS base URL.', {
      field: 'baseUrl',
    })
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ProviderError('invalid_base_url', 'Provider base URL must be a valid HTTPS URL.', {
      field: 'baseUrl',
    })
  }
  // Origin plus path is the whole safe URL. Anything else the parser kept — credentials, a query,
  // or a fragment — shows up in href, including the empty `?` and `#` that search/hash report as ''.
  if (url.protocol !== 'https:' || url.href !== `${url.origin}${url.pathname}`) {
    throw new ProviderError(
      'invalid_base_url',
      'Provider base URL must use HTTPS and cannot contain credentials, a query, or a fragment.',
      { field: 'baseUrl' },
    )
  }
  return url.href.replace(/\/$/, '')
}

function envName(value: string | undefined): string {
  if (!value?.trim()) {
    throw new ProviderError('missing_api_key_env', 'Provider API key environment name is required.', {
      field: 'apiKeyEnv',
    })
  }
  if (!ENV_NAME.test(value)) {
    throw new ProviderError(
      'invalid_api_key_env',
      'Provider API key environment name is not valid.',
      { field: 'apiKeyEnv' },
    )
  }
  return value
}

export function resolveProvider(input: ProviderInput): ResolvedProvider {
  const definition = providerNamed(input.provider)
  const custom = definition.id === 'custom'
  const suppliedProtocol = protocolNamed(input.protocol, custom)
  if (!custom && suppliedProtocol && suppliedProtocol !== definition.protocol) {
    throw new ProviderError('protocol_mismatch', 'Protocol does not match the selected provider.', {
      field: 'protocol',
      provider: definition.id,
    })
  }

  const protocol = suppliedProtocol ?? definition.protocol
  const baseUrl = input.baseUrl === undefined ? definition.baseUrl : input.baseUrl
  const apiKeyEnv = input.apiKeyEnv === undefined ? definition.apiKeyEnv : input.apiKeyEnv

  // Custom providers fill all three values above; built-ins define their protocol.
  if (!protocol) {
    throw new ProviderError('missing_protocol', 'Provider protocol is required.', { field: 'protocol' })
  }
  return {
    provider: definition.id,
    protocol,
    baseUrl: httpsBaseUrl(baseUrl),
    apiKeyEnv: envName(apiKeyEnv),
  }
}

export function requireApiKeyEnvironment(
  provider: Pick<ResolvedProvider, 'apiKeyEnv'>,
  environment: Readonly<Record<string, string | undefined>>,
): void {
  // Own properties only: a legal name like `constructor` must not resolve against Object.prototype.
  const value = Object.hasOwn(environment, provider.apiKeyEnv)
    ? environment[provider.apiKeyEnv]
    : undefined
  if (typeof value !== 'string' || !value.trim()) {
    // The configured name is an untrusted reference, sometimes a pasted credential by mistake.
    // Never echo it back: only the stable code and field name are safe to report.
    throw new ProviderError(
      'api_key_env_unset',
      'Required provider API key environment variable is not set.',
      { field: 'apiKeyEnv' },
    )
  }
}
