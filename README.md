# Create Kei Game

Create Kei Game is the standalone harness for starting a Kei game project. It
can prepare a blank workspace, clone a Kei example, use a local project in
place, or clone a GitHub or GitLab repository. Human onboarding and a strict,
prompt-free agent interface both produce the same validated project plan.

> **Current boundary:** onboarding validates and prepares the project, then runs
> **one bounded turn** of the shared engine against it — a real provider call
> over Anthropic's, OpenAI's, or the chat-completions wire protocol, real
> workspace-scoped tools, real files written. The credential is read from the
> environment variable you name, at the moment of the call, and reaches one
> request header and nothing else.
>
> What does not exist yet: the Kei terminal UI and its attribution obligations,
> a session that stays open past one turn, and persisted provider
> configuration. One invocation is one turn.

> **Unpublished draft:** this branch is not the package currently served by npm.
> Until this harness is released, run the checkout with Bun as shown below. Do
> not use `npm create kei-game` or `npx create-kei-game` to test this draft; those
> commands currently fetch the older published package.

## Start here

For example, set an OpenAI credential in your environment, run the onboarding
flow, and choose `openai` when asked for the provider:

```sh
export OPENAI_API_KEY='replace-with-provider-api-key'
bun run src/index.ts --
```

```powershell
$env:OPENAI_API_KEY = 'replace-with-provider-api-key'
bun run src/index.ts --
```

The questions follow one predictable order: project name, source, provider,
exact model ID, API-key environment-variable name, any provider-specific
transport settings, then the game brief. See [Human onboarding](docs/onboarding.md)
for provider and source details.

To supply every answer without prompts:

```sh
bun run src/index.ts -- "Tiny Quest" --source blank --provider openai \
  --model provider-model-id --api-key-env OPENAI_API_KEY \
  --brief "Build a small cooperative puzzle game."
```

Automation should use `--agent`, not `--yes`:

```sh
bun run src/index.ts -- "Tiny Quest" --agent --json --source blank \
  --provider openai --model provider-model-id \
  --api-key-env OPENAI_API_KEY \
  --brief "Build a small cooperative puzzle game." --no-launch
```

Agent mode never prompts and emits one JSON value when `--json` is present.
Drop `--no-launch` and it runs the turn, reporting `status: "built"` with a
`run` object naming the turns, tool calls, and files written. See
[Agent mode](docs/agent-mode.md) for config files, stdin, precedence, result
shapes, and failure handling.

## Shared engine boundary

The future Kei TUI and automation use the same `EngineSession` through one
JSONL process contract. The process supports multiple sessions, repeated turns,
concurrent cancellation, and stable redacted failures, and it drives the same
provider transport and workspace tools the CLI does:

```sh
bun run src/runtime-main.ts
```

Every session gets three workspace-scoped tools — `list_files`, `read_file`, and
`write_file` — and nothing else. No process, no network, no installer. A path
that is absolute, contains `..`, or resolves through a symlink out of the
workspace is refused, and a refusal is a result the model can correct rather
than an error that ends the turn.

See [Engine JSONL protocol](docs/runtime-protocol.md) for copyable commands,
events, limits, tools, and recovery rules, and [Runtime threat model](docs/runtime-threat-model.md)
for trust boundaries and what is deliberately absent.

## Choose a starting point

| Source | What happens |
|---|---|
| `blank` | Writes `package.json`, `README.md`, `.gitignore`, and `src/main.ts`. It adds no renderer, server, currency, or dependencies. |
| `template` | Clones one of the three Kei examples below from its repository. |
| `local` | Uses an existing directory in place and writes nothing to it. |
| `repository` | Clones an HTTPS GitHub or GitLab repository. |

The available templates are `button`, `world-of-wonder`, and
`carpet-markets`. There is no bundled template archive; template and repository
sources require Git and network access.

```sh
bun run src/index.ts -- "Shop Game" --template button
bun run src/index.ts -- "RPG" --template world-of-wonder
bun run src/index.ts -- "Market" --template carpet-markets
bun run src/index.ts -- "Existing" --source local --from ../existing-game
bun run src/index.ts -- "Imported" --source repository \
  --from https://github.com/example/example-game.git
```

## Source-only preparation

`--yes` preserves the earlier source-only workflow. It takes source defaults,
asks nothing, prepares the source, and does not collect provider, model, or
brief settings.

```sh
bun run src/index.ts -- "Empty Game" --source blank --yes
```

`--yes` and `--agent` are intentionally different and cannot be combined.

## Command reference

Run `bun run src/index.ts -- --help` for the authoritative option list in this
checkout. After this harness is released, the installed equivalent will be
`npx create-kei-game --help`.

| Option | Purpose |
|---|---|
| `--source <kind>` | `blank`, `template`, `local`, or `repository` |
| `--template <name>` | `button`, `world-of-wonder`, or `carpet-markets`; implies a template source outside agent-config merging |
| `--from <path\|url>` | Local path or HTTPS GitHub/GitLab repository URL |
| `--into <directory>` | Destination; defaults to the project slug in the current directory |
| `--force` | For a blank source only, overwrite the four generated filenames without deleting anything else |
| `--yes`, `-y` | Prompt-free source-only preparation |
| `--agent` | Hard no-prompt automation mode |
| `--agent-config <path\|->` | Read an agent JSON object from a file or bounded stdin |
| `--json` | Emit exactly one JSON result or error in agent mode |
| `--provider <id>` | `anthropic`, `openai`, `zai`, `qwen`, `deepseek`, `openrouter`, or `custom` |
| `--model <id>` | Exact provider model ID; there is no default |
| `--api-key-env <name>` | Name of an inherited environment variable, never the key value |
| `--base-url <url>` | HTTPS endpoint override; required for Qwen and custom providers |
| `--protocol <name>` | `messages`, `responses`, or `chat_completions` |
| `--brief <text>` | Nonblank description of the game |
| `--no-launch` | Prepare and validate everything, but do not run the model. Works with or without `--agent` |
| `--help`, `-h` | Show CLI help |
| `--version`, `-v` | Show the package version |

## Safety notes

- Config accepts an environment-variable **name** such as `OPENAI_API_KEY`, not
  a credential value. Secret-looking fields are rejected recursively.
- The credential is read from the harness's inherited environment at call time,
  goes into one provider request header, and is never stored, logged, echoed, or
  written to the project. `write_file` refuses content containing it, and
  refuses `.env` outright.
- Provider failures become stable codes — `provider_auth_error`,
  `provider_rate_limited`, `provider_unavailable`, and the rest — phrased from
  one frozen table, never from the provider's own response body.
- Credential presence and source/provider invariants are checked before the
  harness creates or clones a destination.
- Repository URLs are restricted to credential-free HTTPS GitHub and GitLab
  URLs. Git receives an argv array with `shell: false`.
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

The non-executing library entry points are `create-kei-game/source`,
`create-kei-game/providers`, `create-kei-game/harness`,
`create-kei-game/agent`, `create-kei-game/runtime`,
`create-kei-game/runtime-protocol`, `create-kei-game/provider-transport`,
`create-kei-game/tools`, and `create-kei-game/creation-runtime`. Importing the
package root executes the onboarding CLI. The separate `create-kei-game-engine`
binary owns JSONL only.

Kei: <https://keicoin.org>
