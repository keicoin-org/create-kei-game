# Human onboarding

Onboarding asks about the game and nothing else. There is no question about a
template, a repository, or any other starting point — the planner decides
whether one is worth starting from, and writes down why in the project.

This is an unpublished draft. The examples run `src/index.ts` from this
repository checkout with Bun. Neither `create-kei-mmo` nor this harness is on
npm; `npm create kei-game` still installs the superseded 0.2.0 scaffolder.

## Before you run it

Choose an exact model ID supported by your provider and expose the provider key
through an environment variable. The harness reads the variable to confirm it is
nonblank. The value never enters the plan, the project, or the output.

```sh
export ANTHROPIC_API_KEY='replace-with-provider-api-key'
bun run src/index.ts --
```

```powershell
$env:ANTHROPIC_API_KEY = 'replace-with-provider-api-key'
bun run src/index.ts --
```

## The question order

1. **Project name.** An empty answer defaults to `kei-mmo`; a name such as
   `World Builder` produces the slug `world-builder`.
2. **Dimension.** `2d`, `3d`, or `auto`. `auto` is the default and reads the
   answer out of the goals below; the plan records the signals it read.
3. **Gameplay.** What players do minute to minute. This is the one goal with no
   default — a plan cannot be derived without it.
4. **World.** Size, regions, persistence, how much stays loaded. May be blank.
5. **Art.** Style, palette, camera, lighting. May be blank.
6. **Network.** Players per shard, latency budget, what the server owns. May be
   blank.
7. **Economy.** Currencies, items, trade, sinks. May be blank.
8. **Provider.** One of the supported provider IDs.
9. **Exact model ID.** There is deliberately no default.
10. **API-key environment-variable name.** Built-in providers offer the name in
    the table below as the prompt default. This is a name, not a key.
11. **Transport details, when required.** Qwen asks for its regional/workspace
    HTTPS base URL. A custom provider asks for an HTTPS base URL and then its
    protocol.

A blank optional goal is not a hole the harness papers over. The plan records
what it assumed instead, in `kei-mmo/PLAN.md`, so you can read it back and
disagree.

Questions 2 through 7 are only asked while there is already a conversation.
Once `<name>` and `--gameplay` are both on the command line, the harness stops
asking and plans from what it has.

## What happens next

The harness plans, prints what it decided, prepares the project, and runs one
bounded turn of the shared engine against it — printing each tool as it runs and
the model's reply when it finishes. `--no-launch` stops after preparation.
`--plan-only` stops before it, having touched nothing at all.

What is still missing: the Kei terminal interface, a session that stays open for
further turns, and persisted provider configuration. One invocation is one turn.

## See what it decided, first

`--plan-only` needs no provider and no credential. It plans and prints:

```sh
bun run src/index.ts -- "Salvage Run" --3d \
  --gameplay "Crews salvage derelict stations and haul cargo home." --plan-only
```

That prints the engine decision and its reasons, the reference decision and its
reasons — including the candidates that lost and their scores — the capability
packets selected and deferred, the constraints, and the build order. See
[The plan](mmo-plan.md) for what each of those is.

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
bun run src/index.ts -- "Qwen Realm" --3d \
  --gameplay "Four classes, open-world questing, group dungeons." \
  --economy "One Kei currency and tradeable gear." \
  --provider qwen --model provider-model-id --api-key-env DASHSCOPE_API_KEY \
  --base-url https://dashscope-region.example/v1
```

```powershell
$env:DASHSCOPE_API_KEY = 'replace-with-provider-api-key'
bun run src/index.ts -- 'Qwen Realm' --3d `
  --gameplay 'Four classes, open-world questing, group dungeons.' `
  --economy 'One Kei currency and tradeable gear.' `
  --provider qwen --model provider-model-id --api-key-env DASHSCOPE_API_KEY `
  --base-url https://dashscope-region.example/v1
```

The example endpoint is a placeholder. Supply the HTTPS endpoint assigned to
your account and region.

## What lands on disk

When the planner scaffolds, the project is the MMO shape and the plan:

```text
salvage-run/
├── .gitignore
├── README.md
├── kei-mmo/
│   ├── PLAN.md
│   └── plan.json
├── package.json
├── scripts/build.mjs
├── static/index.html
├── tsconfig.json
└── src/
    ├── client/main.ts
    ├── server/dev-server.mjs
    ├── server/main.ts
    └── shared/simulation.ts
```

`src/shared/` is imported by both sides, which is the one architectural opinion
the scaffold holds: the simulation belongs to neither the client nor the server.
Run `bun install`, `bun run build`, then `PORT=0 bun run dev`; the local static
server reports its actual URL in one JSON readiness line. The 3D client is a
minimal project-owned Babylon.js construction scene. The 2D client is a Canvas
construction frame, not a tile or sprite renderer. Neither path implements
networking, authority, persistence, Kei trade, or presentation polish yet, and
neither imports the harness at runtime.

Use `--force` only when those files may be overwritten in a nonempty directory.
Other files are left in place and nothing is deleted.

When the planner clones a reference instead, the clone arrives with
`kei-mmo/PLAN.md` and `kei-mmo/plan.json` written into it — including the reason
that reference was chosen and the known cost of starting there. A clone still
refuses a nonempty destination, even with `--force`.

## Plan and scaffold without a provider

`--yes` never prompts and never needs a credential:

```sh
bun run src/index.ts -- "Bare Realm" --yes \
  --gameplay "Four classes, open-world questing, group dungeons."
```

Without `--gameplay` it uses a stated default — a persistent multiplayer world
with characters, progression, and trade — and says so in the plan.

For an AI caller or CI job that needs the full validated request, use
[`--agent`](agent-mode.md) instead.

## Troubleshooting

**“There is nothing to type into here.”** The process has no interactive TTY and
some answers are missing. Pass `<name>` and `--gameplay`, use `--plan-only` or
`--yes`, or use agent mode with a complete config.

**“`--source` is gone.”** It was the question this harness stopped asking. The
planner chooses between a scaffold and a reference project out of the intent;
run `--plan-only` to see which it chose and why.

**“Required provider API key environment variable is not set.”** Verify the name
you supplied, then export that variable in the same process environment. Pass
only its name to `--api-key-env`; the error deliberately does not echo it.

**A Qwen or custom provider asks for more fields.** Qwen needs `--base-url`.
Custom needs `--base-url`, `--protocol`, and `--api-key-env`.

**The destination is not empty.** Pick a new destination. `--force` applies only
to a scaffold and only overwrites the generated filenames; it never permits
cloning over existing content.
