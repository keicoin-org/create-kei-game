# Create Kei Game

Create Kei Game is the standalone harness for starting a Kei game project. It
can prepare a blank workspace, clone a Kei example, use a local project in
place, or clone a GitHub or GitLab repository. Human onboarding and a strict,
prompt-free agent interface both produce the same validated project plan.

> **Current boundary:** the harness validates the source, provider settings,
> credential environment reference, model ID, and game brief, then prepares the
> project and stops. The model/tool loop, Kei terminal UI, and persisted workflow
> do not exist yet. A reported `launch: "pending"` does not mean a model ran.

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

Agent mode never prompts and emits one JSON value when `--json` is present. See
[Agent mode](docs/agent-mode.md) for config files, stdin, precedence, result
shapes, and failure handling.

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
| `--no-launch` | Record launch as disabled instead of pending |
| `--help`, `-h` | Show CLI help |
| `--version`, `-v` | Show the package version |

## Safety notes

- Config accepts an environment-variable **name** such as `OPENAI_API_KEY`, not
  a credential value. Secret-looking fields are rejected recursively.
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
`create-kei-game/providers`, `create-kei-game/harness`, and
`create-kei-game/agent`. Importing the package root executes the CLI.

Kei: <https://keicoin.org>
