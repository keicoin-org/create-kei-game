# Agent mode

Agent mode is the noninteractive contract for an AI caller, CI job, or another
program. `--agent` is a hard no-prompt boundary: incomplete input fails instead
of opening onboarding. Add `--json` to receive exactly one JSON object on stdout.

This is an unpublished draft. The examples run `src/index.ts` from this
repository checkout with Bun; the npm commands still resolve to the older
published package until the harness is released.

> Agent mode prepares the project, then runs **one bounded turn** of the shared
> engine against it: a real provider call, real tool execution, real files
> written. It does not start a terminal UI, hold the session open for further
> turns, or persist provider configuration. `--no-launch` stops after
> preparation. The engine it runs is reached over the same boundary the future
> Kei TUI will use; see [Engine JSONL protocol](runtime-protocol.md).

## Fast path: flags only

POSIX shell:

```sh
export OPENAI_API_KEY='replace-with-provider-api-key'
bun run src/index.ts -- "Agent Quest" --agent --json --source blank \
  --into ./agent-quest --provider openai --model provider-model-id \
  --api-key-env OPENAI_API_KEY \
  --brief "Build a compact exploration game." --no-launch
```

PowerShell:

```powershell
$env:OPENAI_API_KEY = 'replace-with-provider-api-key'
bun run src/index.ts -- 'Agent Quest' --agent --json --source blank `
  --into ./agent-quest --provider openai --model provider-model-id `
  --api-key-env OPENAI_API_KEY `
  --brief 'Build a compact exploration game.' --no-launch
```

Exit code `0` means the project was prepared. Exit code `1` means validation or
preparation failed. With `--json`, both cases write one newline-terminated JSON
object to stdout.

## JSON config

Pass a file with `--agent-config <path>` or bounded stdin with
`--agent-config -`. The input must be one UTF-8 JSON object no larger than
64 KiB (65,536 bytes), whether it comes from a file or stdin. Empty, malformed,
array, and unknown-field inputs are rejected.

Accepted keys are below. “Required” is evaluated after config and explicit CLI
overrides are merged.

| Key | Type | Required/default |
|---|---|---|
| `name` | string | Required |
| `source` | string | Required: `blank`, `template`, `local`, or `repository` |
| `template` | string | Required when `source` is `template` |
| `from` | string | Required when `source` is `local` or `repository` |
| `into` | string | Optional; project slug under the current directory |
| `force` | boolean | Optional; `false` |
| `provider` | string | Required provider ID |
| `model` | string | Required exact model ID |
| `apiKeyEnv` | string | Required environment-variable name |
| `baseUrl` | string | Required for Qwen and custom; optional override otherwise |
| `protocol` | string | Required for custom; fixed for built-ins |
| `brief` | string | Required nonblank game description |
| `launch` | boolean | Optional; `true`, which runs one engine turn after preparation |

The model ID is limited to 256 characters and the brief to 32,000 characters.

### Read a config file

`agent.json`:

```json
{
  "name": "Config Quest",
  "source": "blank",
  "into": "config-quest",
  "force": false,
  "provider": "openai",
  "model": "provider-model-id",
  "apiKeyEnv": "OPENAI_API_KEY",
  "brief": "Build a small crafting game.",
  "launch": false
}
```

```sh
export OPENAI_API_KEY='replace-with-provider-api-key'
bun run src/index.ts -- --agent --json --agent-config ./agent.json
```

```powershell
$env:OPENAI_API_KEY = 'replace-with-provider-api-key'
bun run src/index.ts -- --agent --json --agent-config ./agent.json
```

### Read config from stdin

POSIX shell:

```sh
export OPENAI_API_KEY='replace-with-provider-api-key'
printf '%s' '{"name":"Stdin Quest","source":"blank","provider":"openai","model":"provider-model-id","apiKeyEnv":"OPENAI_API_KEY","brief":"Build a tiny tactics game.","launch":false}' |
  bun run src/index.ts -- --agent --json --agent-config -
```

PowerShell:

```powershell
$env:OPENAI_API_KEY = 'replace-with-provider-api-key'
@{
  name = 'Stdin Quest'
  source = 'blank'
  provider = 'openai'
  model = 'provider-model-id'
  apiKeyEnv = 'OPENAI_API_KEY'
  brief = 'Build a tiny tactics game.'
  launch = $false
} | ConvertTo-Json -Compress |
  bun run src/index.ts -- --agent --json --agent-config -
```

## Precedence

Explicit CLI answers override the corresponding config keys. This includes the
positional project name. `--force` can override `force` to `true`, and
`--no-launch` can override `launch` to `false`.

An explicit `--source` replaces the config source choice as a unit. For example,
`--source blank` ignores a `template` or `from` detail left over in the config.
An explicitly supplied contradictory detail is still an error, such as
`--source blank --template button`. When changing a config to a detailed source,
pass that source and its matching `--template` or `--from` together.

```sh
# agent.json may say source=template; these flags select blank instead.
bun run src/index.ts -- "Blank Override" --agent --json \
  --agent-config ./agent.json --source blank --into ./blank-override \
  --no-launch
```

There is no CLI `--launch` flag. Omit `--no-launch` to use the config value or
the default `true`, which runs one engine turn. `--no-launch` works with or
without `--agent`, and is the only way to validate a full plan without making a
provider request.

## Machine output

### Success

The success object contains the sanitized request and the actual prepared-source
result. Absolute paths vary by working directory and platform. A blank-source
success has this shape, serialized on one line:

```json
{
  "ok": true,
  "status": "prepared",
  "launch": "disabled",
  "request": {
    "project": { "slug": "agent-quest", "title": "Agent Quest" },
    "selection": { "kind": "blank" },
    "baseDirectory": "/workspace",
    "destination": "./agent-quest",
    "force": false,
    "provider": {
      "provider": "openai",
      "protocol": "responses",
      "baseUrl": "https://api.openai.com/v1",
      "apiKeyEnv": "OPENAI_API_KEY"
    },
    "model": "provider-model-id",
    "brief": "Build a compact exploration game.",
    "launch": false
  },
  "prepared": {
    "selection": { "kind": "blank" },
    "directory": "/workspace/agent-quest",
    "created": true,
    "written": ["package.json", "README.md", ".gitignore", "src/main.ts"],
    "remote": null
  }
}
```

Local sources report `created: false`; cloned sources include the normalized
remote URL.

For `launch: true` the status is `"built"`, the top-level launch value is
`"completed"`, and one extra `run` object records what the turn did:

```json
{
  "ok": true,
  "status": "built",
  "launch": "completed",
  "request": { "...": "as above, with launch: true" },
  "prepared": { "...": "as above" },
  "run": {
    "turns": 3,
    "outputBytes": 812,
    "toolCalls": 4,
    "written": ["src/main.ts", "src/level.ts"],
    "summary": "Added the entry point and the first level."
  }
}
```

`written` lists workspace-relative POSIX paths the tools actually wrote.
`summary` is the model's closing message, truncated at 4,000 characters; it
never contains a tool argument, a tool result, or a credential.

### Error

Errors use a stable envelope and exit code `1`:

```json
{
  "ok": false,
  "error": {
    "code": "missing_inputs",
    "message": "Agent mode is missing required inputs.",
    "missing": ["name", "source", "provider", "model", "apiKeyEnv", "brief"]
  }
}
```

Depending on the error, the object may include `field`, `fields`, or `missing`.
Callers should branch on `error.code` and treat the message as explanatory text.
Unexpected failures are reduced to `internal_error`; raw filesystem errors and
credential values are not included.

A failure during the launched turn uses the same envelope with an engine code
and its canonical message. The codes a caller should expect are
`credential_unset`, `provider_auth_error`, `provider_rate_limited`,
`provider_request_invalid`, `provider_unavailable`, `provider_response_invalid`,
`transport_error`, `timeout`, `cancelled`, and the bound codes listed in
[Engine JSONL protocol](runtime-protocol.md). The project has already been
prepared when one of these is reported, so a retry does not need to prepare it
again.

## Credential rules

`apiKeyEnv` must be a valid environment-variable name whose inherited value is
present and nonblank. The request and JSON output contain only that name.

Do not put keys, tokens, passwords, or credentials into config. Secret-looking
field names such as `apiKey`, `accessToken`, or `password` are rejected even when
nested. The sole allowed API-key field is `apiKeyEnv`.

Environment values should be injected by the caller's secret manager:

```sh
OPENAI_API_KEY="$CI_OPENAI_KEY" bun run src/index.ts -- --agent --json \
  --agent-config ./agent.json
```

## Troubleshooting

**`missing_inputs`** — provide `name`, `source`, `provider`, `model`,
`apiKeyEnv`, and `brief`, plus the detail required by the selected source.

**`api_key_env_unset`** — the configured variable is absent or blank in the
child process. Verify the `apiKeyEnv` name you supplied and set that variable in
the process environment. The error deliberately does not echo the name; do not
replace it with a key.

**`secret_fields`** — the JSON contains a credential-looking field. Remove it
and pass only `apiKeyEnv`.

**`config_too_large`** — the file or stdin stream exceeded 65,536 bytes. Store
game detail in the project and keep the onboarding brief focused.

**`invalid_config`** — check UTF-8, JSON object syntax, field names, value types,
and source/detail combinations.

**`invalid_arguments` after adding `--yes`** — remove `--yes`. Agent mode is
already prompt-free and the two modes cannot be combined.
