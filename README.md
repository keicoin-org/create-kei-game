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
| Which capability packets apply | Core packets always; optional ones on an intent signal; only `available` ones ever | each packet's `reason`, and `plan.deferred` |
| The 3D style | Setting and finish read from the brief; nothing assumed, fantasy least of all | `plan.content.style` |
| The 3D content selections | Prop kit, materials, motion set, audio palette, cut-scene pipeline — chosen by style, each with its cost | `plan.content.selections` |
| What is non-negotiable | Fixed rules plus one the dimension implies | `plan.constraints` |
| When it is done | Criteria with a concrete way to check each | `plan.acceptance` |
| What order to build in | Steps, each naming the packets it draws on | `plan.steps` |

Intent signals have a strict deterministic boundary. The project `name` labels
files and output only; it never steers dimension, references, style,
capabilities, or deferrals. Only the five description goals are matched. A
word-like signal must occupy Unicode-aware token boundaries, so `voice` matches
`voice` but not `invoice`, and `space` matches `space` but not `workspace`.
Multiword signals accept normalized whitespace (`open world`, including line
breaks and repeated spaces); hyphen and space variants are accepted only when
both are explicitly listed in the catalog. There is no stemming, fuzzy match,
locale-dependent segmentation, provider call, or model inference.

The planner derives one immutable, source-field-attributed match record and
passes it to its dimension, reference, style, and capability consumers. That
record is an in-process implementation detail, not a new persisted intent,
plan, JSONL, or session schema, so no boundary version changes in this release.

A capability packet is not a topic. Each one states what must already exist,
which packages and platform APIs do the work, the exact calls that do it, and
how the developer will know it worked — for animation, shaders, post-processing,
2D and 3D rendering, networking and session authority, persistence and world
streaming, Kei economies, UI, audio, content, testing, and deployment.

Every packet also declares a **status** — `available`, `planned`, or `absent` —
and a plan may only cite available ones. The external content generators
(text-to-3D models, ARDY-style motion capture, SFX generation) are `planned`;
voice acting is `absent`; each appears in a 3D plan's deferrals naming its
status rather than being implied as delivered.

See [Intent, planner, and plan](docs/mmo-plan.md) for the schemas, the scoring
rules, and what "concrete" is held to mean.

## The 3D content pipelines

A 3D plan carries four executable content pipelines — models and props,
rigging and animation, SFX and audio, and directed cut-scenes — as explicit,
versioned records the harness actually runs at scaffold time:

- **Style-aware selection.** The brief's setting (science fiction,
  contemporary, historical, fantasy, or unspecified) and finish (grounded or
  stylized) pick the prop kit, materials, and cue palette. An unspecified
  brief gets neutral previs content; no genre — fantasy included — ever leaks
  in uninvited.
- **An admission gate.** Every asset is a record in
  `kei-mmo/content/manifest.json`; a declared generator output with no bytes
  on disk blocks admission as `generator_output_missing` instead of becoming
  a broken reference. The same gate ships inside the project as
  `kei-mmo/content/check.mjs`.
- **A motion ready gate.** Clips sit behind an ARDY-compatible adapter seam;
  ready is a strict triple (status, current version, payload present), and a
  scene referencing a clip that is not ready is never emitted.
- **A staged cut-scene flow.** Plan → stage → beats → rehearsal → assembly,
  every stage pure and bounded, the assembled document byte-deterministic and
  played by a project-owned module with no harness dependency.

See [Content pipelines](docs/content-pipelines.md) for the records, the gate
codes, the bounds, and exactly which generators are `planned` or `absent`.

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
│   ├── plan.json
│   ├── polish/                   # both dimensions; contract/check, assets pending
│   └── content/                  # source/admission records; 3D pipeline files when selected
│       ├── manifest.json         # every asset as a versioned, admitted record
│       ├── pipelines.json        # the workflow records and generator statuses
│       ├── check.mjs             # the project's own admission gate (plain node)
│       └── cutscenes/            # assembled scenes, when the brief asked for them
├── package.json
├── scripts/build.mjs              # project-owned Bun build, JSON result/error
├── static/index.html              # canvas and construction-grade HUD
├── test/economy.test.ts           # private mock-chain custody + trade proof
├── tsconfig.json
└── src/
    ├── client/main.ts             # renders every authoritative player
    ├── client/action-events.ts    # one-shot semantic feedback reducer
    ├── client/connection.ts       # one browser/headless protocol path
    ├── client/headless.ts         # two-client shared-encounter smoke
    ├── economy/definitions.ts     # exact currency and item declarations
    ├── economy/provision.ts       # separate injected issuer provisioning
    ├── economy/player-trade.ts    # seller offer + buyer exact acceptance
    ├── client/restart-proof.ts    # three-lifecycle durability/forgery proof
    ├── server/dev-server.mjs      # loopback WebSocket + static server
    ├── server/main.ts             # authoritative fixed-tick shard
    ├── server/persistence.ts      # versioned bun:sqlite character store
    ├── shared/actions.ts          # action-v1 intent and event contract
    ├── shared/protocol.ts         # exact versioned messages and refusals
    ├── shared/simulation.ts
    └── shared/cutscene.ts        # the player, with the cut-scenes; imports nothing
```

For a scaffold, `bun install`, `bun run build`, `bun run economy:check`, and
`PORT=0 bun run dev` work without edits. A 3D scaffold owns a minimal Babylon.js
scene; a 2D scaffold
owns a Canvas construction frame and explicitly does not claim a tile or sprite
renderer. Both own a loopback-only game server and the same versioned connection
path for browser and headless clients. `bun run headless -- <socket-url>` opens
two server-assigned players, moves each once, runs accepted interact and strike
actions against the training sentinel, proves both clients observe the same
server-authored anticipation/contact/recovery events, and proves stale,
too-far, phase-busy, cooldown, duplicate/out-of-order, and authority-forging
paths do not replay feedback or mutate progression.

Both dimensions now receive a project-owned runtime action-v1 contract and
authoritative phase machine. Clients can name only interact/strike and the fixed
training sentinel; the server supplies actor, tick, monotonic event id, outcome,
and contact, and applies sentinel/progression change exactly once at contact.
The bounded semantic timeline travels in authoritative snapshots, while the
client reducer prevents duplicate or older snapshots from replaying feedback.
Disconnect/resume cannot clear an accepted action, recovery, or cooldown: those
guards belong to the durable player id and expire under bounded shard cleanup,
not socket cleanup. A process restart intentionally cancels work that had not
reached contact. A contact already saved remains exactly once and causes a
conservative restart guard for the remaining recovery/cooldown horizon, so a
restart is not an action-rate bypass and is not claimed as seamless timeline
recovery.

They also receive a project-owned version-1 presentation contract:
`kei-mmo/polish/` owns semantic interact/strike timings, effect and cue maps,
low/medium/high quality profiles, and exact asset requirements; the canonical
source registry is `kei-mmo/content/sources.json`. No licensed production asset
has been selected in this slice, so
`bun run polish:check` deliberately exits nonzero with
`polish_assets_pending`. The construction renderer does not consume the recipe,
and `polish-2d` / `polish-3d` remain planned. The runtime criterion-9 authority
slice exists; recordable art, motion, SFX, VFX, camera, UI, and capture do not,
so criterion 9 and issue 17 remain open. See
[First-encounter polish contract](docs/polish-contract.md).

`bun run restart-proof` creates a temporary WAL database, moves and progresses a
server-assigned character, cleanly restarts the server twice, resumes the exact
identity and state, and proves malformed/random/duplicate tokens and forged
position/progression/economic fields cannot alter memory or disk. Resume tokens
remain in browser localStorage or headless memory; SQLite contains only their
hashes, position, XP, level, and update time.
The world database also holds one bounded, expiring action-guard row for a
contact whose recovery/cooldown horizon has not elapsed; contact progression
and that guard commit in the same SQLite transaction.

That closes the generated-project shape of SPEC §11.3 criteria 3–6: a real
client connects, two clients see each other move, and server-authored character
position/progression survive restart. A separate private mock chain proves a
player-custodied open-transfer currency with a one-way issuer-desk promise, an
item, mismatch refusal, and atomic trade. The game server has no Kei import,
account, wallet, balance, item, or settlement path; SQLite has no economic state.
It does **not** close socket-to-wallet proof of control, the broader end-to-end
product gate (8), or the recordable presentation portion of polish (9). There is no account recovery,
chunk streaming, or multi-writer store. Deleting this harness does not affect
the generated project's dependencies, runtime, restart proof, or economy proof.

When the planner clones a reference project instead, adoption is loud. Before
claiming success, the harness finds the reference's declared package name,
repository metadata (or declared absence), and README heading exactly where
expected. It rewrites the package name and heading to the requested project,
removes stale reference repository metadata because no destination remote was
requested, removes the clone's `origin`, and writes the same two plan files.
Any missing, changed, wrong-typed, or ambiguous identity target fails closed.
An explicitly opened existing project remains a separate contract and is never
implicitly renamed.

## Command reference

Run `bun run src/index.ts -- --help` for the authoritative option list in this
checkout.

| Option | Purpose |
|---|---|
| `--dimension <d>` | `2d`, `3d`, or `auto`. Human onboarding may default to `auto`; agent mode must supply one explicitly |
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

`--source`, `--template`, and `--from` are recognised in spaced and `=` forms
and refused with stable `retired_field` diagnostics naming the exact field. A
flag that silently does nothing is worse than one that is gone.

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
bun run test
bun run test:generated
bun run build
bun run check
```

The non-executing library entry points are `create-kei-mmo/intent`,
`create-kei-mmo/capabilities`, `create-kei-mmo/references`,
`create-kei-mmo/plan`, `create-kei-mmo/planner`, `create-kei-mmo/style`,
`create-kei-mmo/content`, `create-kei-mmo/content-project`,
`create-kei-mmo/polish`, `create-kei-mmo/effects`,
`create-kei-mmo/motion`, `create-kei-mmo/cutscene`, `create-kei-mmo/source`,
`create-kei-mmo/providers`, `create-kei-mmo/harness`, `create-kei-mmo/agent`,
`create-kei-mmo/runtime`, `create-kei-mmo/runtime-protocol`,
`create-kei-mmo/provider-transport`, `create-kei-mmo/tools`, and
`create-kei-mmo/creation-runtime`. Importing the package root executes the
onboarding CLI. The separate `create-kei-mmo-engine` binary owns JSONL only.

The repository is still named `create-kei-game`, and it is not being renamed.
The `create-kei-game` and `create-kei-game-engine` command names stay pointed at
the same files, so a checkout that already has them on PATH keeps working.

Kei: <https://keicoin.org>
