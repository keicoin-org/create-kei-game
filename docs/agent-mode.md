# Agent mode

Agent mode is the noninteractive contract for an AI caller, CI job, or another
program. `--agent` is a hard no-prompt boundary: incomplete input fails instead
of opening onboarding. Add `--json` to receive exactly one JSON object on stdout.

This is an unpublished draft. The examples run `src/index.ts` from this
repository checkout with Bun; the npm commands still resolve to the older
published package until the harness is released.

> Agent mode prepares and validates the project today. It does not call the
> configured model or start a terminal UI. `launch: "pending"` describes future
> intent, not a running process. The shared engine and JSONL contract now exist
> as a separate, provider-free boundary; see [Engine JSONL protocol](runtime-protocol.md).

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
| `launch` | boolean | Optional; `true`, which is reported as pending today |

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
the default `true`; current output reports that state as `"pending"` and still
stops after preparation.

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

For `launch: true`, the top-level launch value is `"pending"`. Local sources
report `created: false`; cloned sources include the normalized remote URL.

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
