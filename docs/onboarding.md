# Human onboarding

Human onboarding gathers only the information needed to prepare a game project.
Flags may answer any question ahead of time; the CLI asks for the remaining
answers in the same order.

This is an unpublished draft. The examples run `src/index.ts` from this
repository checkout with Bun; the npm commands still resolve to the older
published package until the harness is released.

## Before you run it

Choose an exact model ID supported by your provider and expose the provider key
through an environment variable. The harness reads the variable to confirm that
it is nonblank. It does not put the value in the plan or output.

```sh
export ANTHROPIC_API_KEY='replace-with-provider-api-key'
bun run src/index.ts --
```

```powershell
$env:ANTHROPIC_API_KEY = 'replace-with-provider-api-key'
bun run src/index.ts --
```

## The question order

1. **Project name.** An empty answer defaults to `kei-game`; a name such as
   `World Builder` produces the slug `world-builder`.
2. **Source.** Choose blank, template, local project, or repository. Template,
   local, and repository sources immediately ask for their required detail.
3. **Provider.** Choose one of the supported provider IDs.
4. **Exact model ID.** There is deliberately no default.
5. **API-key environment-variable name.** Built-in providers offer the name in
   the table below as the prompt default. This is a name, not a key.
6. **Transport details, when required.** Qwen asks for its regional/workspace
   HTTPS base URL. A custom provider asks for an HTTPS base URL and then its
   protocol.
7. **Game brief.** Give a nonblank description of the game to build.

The CLI validates the complete, credential-free plan before touching the
destination. It then prepares the source and exits. Human onboarding currently
records launch as pending, but no model, tool loop, terminal UI, or workflow
persistence runs.

## Providers

Provider settings are explicit and model IDs never default.

| Provider ID | Protocol | Default base URL | Default environment name |
|---|---|---|---|
| `anthropic` | `messages` | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| `openai` | `responses` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `zai` | `chat_completions` | `https://api.z.ai/api/paas/v4` | `ZAI_API_KEY` |
| `qwen` | `chat_completions` | Required explicitly | `DASHSCOPE_API_KEY` |
| `deepseek` | `chat_completions` | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` |
| `openrouter` | `chat_completions` | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `custom` | Required explicitly | Required explicitly | Required explicitly |

A base URL must use HTTPS and cannot contain credentials, a query string, or a
fragment. A built-in provider accepts a base URL and environment-name override,
but its protocol must still match the table.

### Complete a Qwen setup without prompts

```sh
export DASHSCOPE_API_KEY='replace-with-provider-api-key'
bun run src/index.ts -- "Qwen Quest" --source blank --provider qwen \
  --model provider-model-id --api-key-env DASHSCOPE_API_KEY \
  --base-url https://dashscope-region.example/v1 \
  --brief "Build a turn-based exploration game."
```

```powershell
$env:DASHSCOPE_API_KEY = 'replace-with-provider-api-key'
bun run src/index.ts -- 'Qwen Quest' --source blank --provider qwen `
  --model provider-model-id --api-key-env DASHSCOPE_API_KEY `
  --base-url https://dashscope-region.example/v1 `
  --brief 'Build a turn-based exploration game.'
```

The example endpoint is a placeholder. Supply the HTTPS endpoint assigned to
your account and region.

## Source behavior

### Blank

`blank` writes exactly four files and installs nothing:

```text
my-game/
├── .gitignore
├── README.md
├── package.json
└── src/
    └── main.ts
```

Use `--force` only when those files may be overwritten in a nonempty directory.
Other files are left in place and nothing is deleted.

### Template

Choose one of:

- `button` — the smallest example: one button, one currency, one item.
- `world-of-wonder` — a multiplayer 3D RPG example.
- `carpet-markets` — a coin launchpad example with chain-enforced policy.

The harness shallow-clones the selected template repository. It will not clone
over a nonempty destination, even with `--force`.

### Local

`local` resolves the path, verifies that it is a directory, and uses it in
place. It does not copy, rename, or modify that project.

```sh
bun run src/index.ts -- "Existing Game" --source local --from ../existing-game
```

### Repository

`repository` shallow-clones a credential-free HTTPS URL from `github.com` or
`gitlab.com`. SSH URLs, embedded credentials, ports, queries, and fragments are
rejected.

```sh
bun run src/index.ts -- "Imported Game" --source repository \
  --from https://gitlab.com/example/example-game.git
```

## Skip only the source questions

`--yes` is a compatibility path for source preparation. It never prompts and
does not create a provider/model plan:

```sh
bun run src/index.ts -- "Bare Workspace" --source blank --yes
```

For an AI caller or CI job that needs the full validated plan, use
[`--agent`](agent-mode.md) instead.

## Troubleshooting

**“There is nothing to type into here.”** The process has no interactive TTY
and some answers are missing. Pass all human flags, use source-only `--yes`, or
use agent mode with a complete config.

**“Required provider API key environment variable is not set.”** Verify the
name you supplied, then export that variable in the same process environment.
Pass only its name to `--api-key-env`; the error deliberately does not echo it.

**A Qwen or custom provider asks for more fields.** Qwen needs `--base-url`.
Custom needs `--base-url`, `--protocol`, and `--api-key-env`.

**The destination is not empty.** Pick a new destination. `--force` is limited
to a blank source and only overwrites the four generated filenames; it never
permits cloning over existing content.
