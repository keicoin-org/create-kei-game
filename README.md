# Create Kei MMO

Create Kei MMO builds a 2D or 3D Kei MMORPG. You describe the game; it decides
the engine, decides whether any reference project is worth starting from, writes
down why it decided both, and hands a model an implementation plan with the
actual methods in it.

It never asks which template you want. That was the wrong first question: it made
somebody choose between three projects they had not read, before they had said a
single thing about the game they wanted. The planner answers it now, from what
you describe, and records its reasoning in the project as `kei-mmo/plan.json`.

> **Current boundary:** onboarding validates an intent, plans it, prepares the
> project, then runs **one bounded turn** of the shared engine against the first
> step of that plan — a real provider call over Anthropic's, OpenAI's, or the
> chat-completions wire protocol, real workspace-scoped tools, real files
> written. The credential is read from the environment variable you name, at the
> moment of the call, and reaches one request header and nothing else.
>
> What does not exist yet: the Kei terminal UI and its attribution obligations,
> a session that stays open past one turn, and persisted provider configuration.
> One invocation is one turn.

> **Unpublished draft:** this branch is not on npm under any name. The npm name
> `create-kei-game` still resolves to the superseded 0.2.0 scaffolder published
> from kei-transaction, and there is no `create-kei-mmo` package. Run the
> checkout with Bun as shown below.

## Start here

See what it would decide, before it decides anything on disk:

```sh
bun run src/index.ts -- "Salvage Run" --3d \
  --gameplay "Crews salvage derelict stations and haul cargo home." \
  --plan-only
```

`--plan-only` needs no provider and no credential, and touches no directory. It
prints the engine decision and its reasons, the reference decision with every
candidate's score, the capability packets selected and deferred, the
constraints, the acceptance criteria, and the build order.

Then run it for real:

```sh
export OPENAI_API_KEY='replace-with-provider-api-key'
bun run src/index.ts --
```

```powershell
$env:OPENAI_API_KEY = 'replace-with-provider-api-key'
bun run src/index.ts --
```

The questions follow one predictable order: project name, 2D/3D/auto, then
gameplay, world, art, network, and economy goals, then provider, exact model ID,
and the name of the environment variable holding the key. Four of the five goals
may be left blank — the plan records what it assumed instead. See
[Human onboarding](docs/onboarding.md).

To supply everything without prompts:

```sh
bun run src/index.ts -- "Salvage Run" --3d \
  --gameplay "Crews salvage derelict stations and haul cargo home." \
  --world "One shard of drifting wrecks that persist between sessions." \
  --provider openai --model provider-model-id --api-key-env OPENAI_API_KEY
```

Automation should use `--agent`, not `--yes`:

```sh
bun run src/index.ts -- "Salvage Run" --agent --json --3d \
  --gameplay "Crews salvage derelict stations and haul cargo home." \
  --provider openai --model provider-model-id \
  --api-key-env OPENAI_API_KEY --no-launch
```

Agent mode never prompts and emits one JSON value when `--json` is present. See
[Agent mode](docs/agent-mode.md) for config files, stdin, precedence, result
shapes, and failure handling.

## What it decides, and how it says so

| Decision | How it is made | Where the reasoning lives |
|---|---|---|
| 2D or 3D | Stated, or inferred from signals across every goal | `plan.engine.rationale` |
| Reference project or scaffold | Every candidate scored; cloning needs a clear win | `plan.reference.rationale` and `plan.reference.considered` |
| Which capability packets apply | Core packets always; optional ones on an intent signal | each packet's `reason`, and `plan.deferred` |
| What is non-negotiable | Fixed rules plus one the dimension implies | `plan.constraints` |
| When it is done | Criteria with a concrete way to check each | `plan.acceptance` |
| What order to build in | Steps, each naming the packets it draws on | `plan.steps` |

A capability packet is not a topic. Each one states what must already exist,
which packages and platform APIs do the work, the exact calls that do it, and
how the developer will know it worked — for animation, shaders, post-processing,
2D and 3D rendering, networking and session authority, persistence and world
streaming, Kei economies, UI, audio, content, testing, and deployment.

See [Intent, planner, and plan](docs/mmo-plan.md) for the schemas, the scoring
rules, and what "concrete" is held to mean.

## Shared engine boundary

The future Kei TUI and automation use the same `EngineSession` through one JSONL
process contract. The process supports multiple sessions, repeated turns,
concurrent cancellation, and stable redacted failures, and it drives the same
provider transport and workspace tools the CLI does:

```sh
bun run src/runtime-main.ts
```

A session opened with an `intent` is planned inside the engine and the plan is
sent back on the wire before the first event, so whatever is driving the pipe
acts on the same document the model got. Every session gets three
workspace-scoped tools — `list_files`, `read_file`, and `write_file` — and
nothing else. No process, no network, no installer. A path that is absolute,
contains `..`, or resolves through a symlink out of the workspace is refused, and
a refusal is a result the model can correct rather than an error that ends the
turn.

See [Engine JSONL protocol](docs/runtime-protocol.md) for copyable commands,
events, limits, tools, and recovery rules, and [Runtime threat
model](docs/runtime-threat-model.md) for trust boundaries and what is
deliberately absent.

## What lands in the project

A scaffolded project holds the one architectural opinion the harness has —
client, server, and a simulation neither of them owns — plus the plan:

```text
salvage-run/
├── .gitignore
├── README.md
├── kei-mmo/
│   ├── PLAN.md
│   └── plan.json
├── package.json
└── src/
    ├── client/main.ts
    ├── server/main.ts
    └── shared/simulation.ts
```

When the planner clones a reference project instead, the clone arrives with
those same two plan files written into it, including the reason it was chosen
and the known cost of starting there.

## Command reference

Run `bun run src/index.ts -- --help` for the authoritative option list in this
checkout.

| Option | Purpose |
|---|---|
| `--dimension <d>` | `2d`, `3d`, or `auto`. Default `auto`, which infers it |
| `--2d`, `--3d` | The same thing, said shorter |
| `--gameplay <text>` | What players do minute to minute. Required |
| `--world <text>` | Size, regions, persistence, streaming |
| `--art <text>` | Style, palette, camera, lighting |
| `--network <text>` | Players per shard, latency budget, what the server owns |
| `--economy <text>` | Currencies, items, trade, sinks |
| `--brief <text>` | Compatibility alias for `--gameplay` |
| `--into <directory>` | Destination; defaults to the project slug here |
| `--force` | For a scaffold only, overwrite the generated filenames without deleting anything else |
| `--plan-only` | Print the plan and stop. No directory, no provider, no model |
| `--yes`, `-y` | Plan and scaffold with no questions and no provider |
| `--agent` | Hard no-prompt automation mode |
| `--agent-config <path\|->` | Read an agent JSON object from a file or bounded stdin |
| `--json` | Emit exactly one JSON result or error in agent mode |
| `--provider <id>` | `anthropic`, `openai`, `zai`, `qwen`, `deepseek`, `openrouter`, or `custom` |
| `--model <id>` | Exact provider model ID; there is no default |
| `--api-key-env <name>` | Name of an inherited environment variable, never the key value |
| `--base-url <url>` | HTTPS endpoint override; required for Qwen and custom providers |
| `--protocol <name>` | `messages`, `responses`, or `chat_completions` |
| `--no-launch` | Plan and prepare everything, but do not run the model |
| `--help`, `-h` | Show CLI help |
| `--version`, `-v` | Show the package version |

`--source`, `--template`, and `--from` are recognised and refused with a
sentence saying where the decision went. A flag that silently does nothing is
worse than one that is gone.

## Safety notes

- Config accepts an environment-variable **name** such as `OPENAI_API_KEY`, not
  a credential value. Secret-looking fields are rejected recursively.
- The credential is read from the harness's inherited environment at call time,
  goes into one provider request header, and is never stored, logged, echoed, or
  written to the project. `write_file` refuses content containing it, and refuses
  `.env` outright.
- The brief the model receives is generated from the plan. There is no way for a
  caller to hand the model a description of the game the harness did not derive.
- Provider failures become stable codes — `provider_auth_error`,
  `provider_rate_limited`, `provider_unavailable`, and the rest — phrased from
  one frozen table, never from the provider's own response body.
- Credential presence and every provider invariant are checked before the
  harness creates or clones a destination.
- Reference URLs are restricted to credential-free HTTPS GitHub and GitLab URLs.
  Git receives an argv array with `shell: false`.
- `--force` never empties a directory and never applies to clones.

## Develop the harness

Use Bun 1.3.0, or Node.js 20 or later for the built CLI.

```sh
bun install
bun run typecheck
bun test
bun run build
bun run check
```

The non-executing library entry points are `create-kei-mmo/intent`,
`create-kei-mmo/capabilities`, `create-kei-mmo/references`,
`create-kei-mmo/plan`, `create-kei-mmo/planner`, `create-kei-mmo/source`,
`create-kei-mmo/providers`, `create-kei-mmo/harness`, `create-kei-mmo/agent`,
`create-kei-mmo/runtime`, `create-kei-mmo/runtime-protocol`,
`create-kei-mmo/provider-transport`, `create-kei-mmo/tools`, and
`create-kei-mmo/creation-runtime`. Importing the package root executes the
onboarding CLI. The separate `create-kei-mmo-engine` binary owns JSONL only.

The repository is still named `create-kei-game`, and it is not being renamed.
The `create-kei-game` and `create-kei-game-engine` command names stay pointed at
the same files, so a checkout that already has them on PATH keeps working.

Kei: <https://keicoin.org>
