# Agent mode

Agent mode is the noninteractive contract for an AI caller, CI job, or another
program. `--agent` is a hard no-prompt boundary: incomplete input fails instead
of opening onboarding. Add `--json` to receive exactly one JSON object on stdout.

This is an unpublished draft. The examples run `src/index.ts` from this
repository checkout with Bun. Neither `create-kei-mmo` nor this harness is on
npm.

> Agent mode validates an intent, plans it, prepares the project, and then runs
> **one bounded turn** of the shared engine against it: a real provider call,
> real tool execution, real files written. It does not start a terminal UI, hold
> the session open for further turns, or persist provider configuration.
> `--no-launch` stops after preparation; `--plan-only` stops before it. The
> engine it runs is reached over the same boundary the future Kei TUI will use;
> see [Engine JSONL protocol](runtime-protocol.md).

## Fast path: flags only

POSIX shell:

```sh
export OPENAI_API_KEY='replace-with-provider-api-key'
bun run src/index.ts -- "Salvage Run" --agent --json --3d \
  --gameplay "Crews salvage derelict stations and haul cargo home." \
  --world "One shard of drifting wrecks that persist between sessions." \
  --into ./salvage-run --provider openai --model provider-model-id \
  --api-key-env OPENAI_API_KEY --no-launch
```

PowerShell:

```powershell
$env:OPENAI_API_KEY = 'replace-with-provider-api-key'
bun run src/index.ts -- 'Salvage Run' --agent --json --3d `
  --gameplay 'Crews salvage derelict stations and haul cargo home.' `
  --world 'One shard of drifting wrecks that persist between sessions.' `
  --into ./salvage-run --provider openai --model provider-model-id `
  --api-key-env OPENAI_API_KEY --no-launch
```

Exit code `0` means the project was prepared. Exit code `1` means validation or
preparation failed. With `--json`, both cases write one newline-terminated JSON
object to stdout.

## Plan first, decide second

`--plan-only` is a pure function of the intent. It needs no provider, no
credential, and no writable directory, and it is the cheapest way for a caller
to see what the harness would do before letting it do anything:

```sh
bun run src/index.ts -- "Salvage Run" --agent --json --plan-only \
  --gameplay "Crews salvage derelict stations and haul cargo home."
```

```json
{ "ok": true, "status": "planned", "plan": { "planVersion": 2, "...": "..." } }
```

Required inputs collapse to `name` and `gameplay`. See [Intent, planner, and
plan](mmo-plan.md) for the shape of what comes back.

## JSON config

Pass a file with `--agent-config <path>` or bounded stdin with
`--agent-config -`. The input must be one UTF-8 JSON object no larger than
64 KiB (65,536 bytes), whether it comes from a file or stdin. Empty, malformed,
array, and unknown-field inputs are rejected.

Accepted keys are below. “Required” is evaluated after config and explicit CLI
overrides are merged.

| Key | Type | Required/default |
|---|---|---|
| `intentVersion` | `1` | Optional; refused if it is any other value |
| `name` | string | Required |
| `gameplay` | string | Required; what players do minute to minute |
| `dimension` | string | Optional; `2d`, `3d`, or `auto`. Default `auto` |
| `world` | string | Optional; blank means the planner decides and records it |
| `art` | string | Optional |
| `network` | string | Optional |
| `economy` | string | Optional |
| `brief` | string | Optional compatibility alias for `gameplay`; loses to it |
| `into` | string | Optional; project slug under the current directory |
| `force` | boolean | Optional; `false` |
| `provider` | string | Required provider ID |
| `model` | string | Required exact model ID |
| `apiKeyEnv` | string | Required environment-variable name |
| `baseUrl` | string | Required for Qwen and custom; optional override otherwise |
| `protocol` | string | Required for custom; fixed for built-ins |
| `launch` | boolean | Optional; `true`, which runs one engine turn after preparation |

The model ID is limited to 256 characters, the name to 200, and each goal to
2,000.

### The three retired keys

`source`, `template`, and `from` are refused by name with their own error code:

```json
{
  "ok": false,
  "error": {
    "code": "retired_field",
    "message": "The harness decides whether to start from a reference project, out of the intent. Send gameplay, world, art, network, and economy instead.",
    "field": "source"
  }
}
```

They are not ignored, because an agent that keeps sending them needs to be told
the decision moved rather than to have it silently overridden. The equivalent
CLI flags fail the same way.

### Read a config file

`agent.json`:

```json
{
  "name": "Salvage Run",
  "dimension": "3d",
  "gameplay": "Crews salvage derelict stations and haul cargo home.",
  "world": "One shard of drifting wrecks that persist between sessions.",
  "economy": "Salvage settles as one Kei currency; hulls are bound on use.",
  "into": "salvage-run",
  "force": false,
  "provider": "openai",
  "model": "provider-model-id",
  "apiKeyEnv": "OPENAI_API_KEY",
  "launch": false
}
```

```sh
export OPENAI_API_KEY='replace-with-provider-api-key'
bun run src/index.ts -- --agent --json --agent-config ./agent.json
```

### Read config from stdin

POSIX shell:

```sh
export OPENAI_API_KEY='replace-with-provider-api-key'
printf '%s' '{"name":"Salvage Run","gameplay":"Crews salvage derelict stations.","provider":"openai","model":"provider-model-id","apiKeyEnv":"OPENAI_API_KEY","launch":false}' |
  bun run src/index.ts -- --agent --json --agent-config -
```

PowerShell:

```powershell
$env:OPENAI_API_KEY = 'replace-with-provider-api-key'
@{
  name = 'Salvage Run'
  gameplay = 'Crews salvage derelict stations.'
  provider = 'openai'
  model = 'provider-model-id'
  apiKeyEnv = 'OPENAI_API_KEY'
  launch = $false
} | ConvertTo-Json -Compress |
  bun run src/index.ts -- --agent --json --agent-config -
```

## Precedence

Explicit CLI answers override the corresponding config keys, field by field.
This includes the positional project name. `--force` can override `force` to
`true`, and `--no-launch` can override `launch` to `false`.

Because there is no source group any more, precedence has no special cases left:
each field is decided on its own. A config that says `dimension: "2d"` and a
command line that says `--3d` produces a 3D plan and keeps every goal the config
supplied.

There is no CLI `--launch` flag. Omit `--no-launch` to use the config value or
the default `true`, which runs one engine turn. `--no-launch` works with or
without `--agent`, and validates a full request without making a provider
request.

## Machine output

### Success

The success object contains the sanitized request — intent, plan, and all — plus
the prepared-source result. Absolute paths vary by working directory and
platform. Serialized on one line, with the plan elided here for length:

```json
{
  "ok": true,
  "status": "prepared",
  "launch": "disabled",
  "request": {
    "project": { "slug": "salvage-run", "title": "Salvage Run" },
    "intent": {
      "intentVersion": 1,
      "name": "Salvage Run",
      "dimension": "3d",
      "gameplay": "Crews salvage derelict stations and haul cargo home.",
      "world": "One shard of drifting wrecks that persist between sessions.",
      "art": "",
      "network": "",
      "economy": ""
    },
    "plan": { "planVersion": 2, "engine": { "...": "..." }, "reference": { "strategy": "scaffold", "considered": [] } },
    "selection": { "kind": "blank" },
    "baseDirectory": "/workspace",
    "destination": "./salvage-run",
    "force": false,
    "provider": {
      "provider": "openai",
      "protocol": "responses",
      "baseUrl": "https://api.openai.com/v1",
      "apiKeyEnv": "OPENAI_API_KEY"
    },
    "model": "provider-model-id",
    "brief": "Salvage Run — a 3D Kei MMORPG. …",
    "launch": false
  },
  "prepared": {
    "selection": { "kind": "blank" },
    "directory": "/workspace/salvage-run",
    "created": true,
    "written": [
      "package.json",
      "README.md",
      ".gitignore",
      "src/shared/simulation.ts",
      "src/client/main.ts",
      "src/server/main.ts",
      "kei-mmo/plan.json",
      "kei-mmo/PLAN.md"
    ],
    "remote": null
  }
}
```

`selection` and `brief` are both derived from `plan` and cannot be supplied by a
caller. When the planner clones instead, `selection.kind` is `"template"`,
`prepared.remote` is the normalized URL, and `prepared.written` is just the two
plan files, written into the clone.

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
    "written": ["src/shared/simulation.ts", "src/server/main.ts"],
    "summary": "Split the tick loop out and wired the shared step()."
  }
}
```

`written` lists workspace-relative POSIX paths the tools actually wrote.
`summary` is the model's closing message, truncated at 4,000 characters; it
never contains a tool argument, a tool result, or a credential.

The turn is aimed at **step one of the plan**, not at the whole plan. A model
told to build an MMO writes ten shallow files; a model told to finish step one
writes one that works.

### Error

Errors use a stable envelope and exit code `1`:

```json
{
  "ok": false,
  "error": {
    "code": "missing_inputs",
    "message": "Agent mode is missing required inputs.",
    "missing": ["name", "gameplay", "provider", "model", "apiKeyEnv"]
  }
}
```

Depending on the error, the object may include `field`, `fields`, or `missing`.
Callers should branch on `error.code` and treat the message as explanatory text.
Unexpected failures are reduced to `internal_error`; raw filesystem errors and
credential values are not included.

Intent failures carry their own codes — `invalid_intent`,
`unsupported_intent_version`, `invalid_name`, `invalid_dimension`,
`missing_gameplay`, `intent_too_long` — each with the `field` that caused it.

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

**`missing_inputs`** — provide `name`, `gameplay`, `provider`, `model`, and
`apiKeyEnv`. Under `--plan-only`, only the first two.

**`retired_field`** — remove `source`, `template`, or `from`. Describe the game
and let the planner choose; `--plan-only` shows you what it chose.

**`missing_gameplay`** — an intent with no gameplay has nothing to plan from.
`brief` is accepted as the same field if that is what your caller already sends.

**`api_key_env_unset`** — the configured variable is absent or blank in the child
process. Verify the `apiKeyEnv` name you supplied and set that variable in the
process environment. The error deliberately does not echo the name; do not
replace it with a key.

**`secret_fields`** — the JSON contains a credential-looking field. Remove it and
pass only `apiKeyEnv`.

**`config_too_large`** — the file or stdin stream exceeded 65,536 bytes. Keep
design detail in the project and the goals focused.

**`invalid_config`** — check UTF-8, JSON object syntax, field names, and value
types.

**`invalid_arguments` after adding `--yes`** — remove `--yes`. Agent mode is
already prompt-free and the two modes cannot be combined.
