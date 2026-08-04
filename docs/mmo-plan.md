# Intent, planner, and plan

Three shapes carry everything the harness knows: the **intent** somebody
supplies, the **plan** the harness derives from it, and the **capability
packets** the plan assembles out of the catalog. The intent is the only input.
The plan is the only thing that reaches the model. The packets are what make the
plan actionable rather than aspirational.

All three are pure data with a version on them, and the planner is a pure
function: the same intent produces the same plan, byte for byte, on any machine.

## The intent

`create-kei-mmo/intent`. Version 1.

| Field | Type | Required |
|---|---|---|
| `intentVersion` | `1` | Optional; stamped if absent, refused if it is any other value |
| `name` | string, ≤ 200 chars | Required |
| `dimension` | `"2d"`, `"3d"`, or `"auto"` | Optional; `"auto"` |
| `gameplay` | string, ≤ 2,000 chars | Required |
| `world` | string, ≤ 2,000 chars | Optional; blank means the planner decides |
| `art` | string, ≤ 2,000 chars | Optional |
| `network` | string, ≤ 2,000 chars | Optional |
| `economy` | string, ≤ 2,000 chars | Optional |

Whitespace is collapsed, so the same intent typed into a heredoc and passed as a
flag produces the same plan. Failures are `IntentError` with a stable code:
`invalid_intent`, `unsupported_intent_version`, `invalid_name`,
`invalid_dimension`, `missing_gameplay`, `intent_too_long`.

There is no field for a template, a repository, or a source. That is deliberate,
and it is the change this product is: the intent describes ends, and the planner
decides means.

## What the planner decides

### The dimension

A stated `2d` or `3d` is taken at its word. `auto` counts signals across every
goal at once — `pixel`, `isometric`, `top-down`, `tilemap` on one side;
`first-person`, `voxel`, `open world`, `terrain`, `low-poly` on the other — and
the plan records both lists. A tie lands on 3D, because a persistent world with
avatars in it is what most people mean by MMORPG, and the plan says so in as many
words rather than hiding it.

### Whether to start from a reference project

Each reference in `create-kei-mmo/references` is scored against the intent:

- **+3** when it is built for the plan's dimension, **−4** when it is built for
  the other one.
- **+1 per matched signal**, capped at 5.

Cloning needs a score of at least **5** *and* a **2-point margin** over the
runner-up. Two references that fit about equally means neither fits well enough
to inherit, so the plan scaffolds instead. The bar is high in both directions: a
clone that does not fit is a deletion exercise, and a fresh start that ignores a
project already built in exactly this shape is a waste.

Every candidate keeps its score and a verdict sentence in `reference.considered`,
including the ones that lost, and a clone keeps the reference's known costs in
its rationale.

### Which capability packets apply

Core packets are in every plan of the matching dimension. Optional ones —
`shaders`, `post-processing`, `audio`, `content-3d-cutscenes`,
`content-3d-audio` — need the intent to have named something they cover, and
when nothing did, the packet lands in `deferred` with the words that would have
pulled it in. A 2D plan gets `render-2d` and `animation-2d` and defers the 3D
pair; a 3D plan gets the reverse, plus the content core (`content-3d-props`,
`content-3d-motion`).

**Status is the binding rule on top.** Every packet declares `available`
(implemented and exercised by a test), `planned` (specified, not implemented),
or `absent` (not offered, with the reason). Only `available` packets can be
selected. A `planned` or `absent` one is deferred **naming its status** in
every matching plan — and when the intent explicitly asked for it, the deferral
quotes the ask and names the status anyway. The external generators
(`content-3d-model-generation`, `content-3d-motion-capture`,
`content-3d-sfx-generation`) are `planned`; `content-3d-voice-acting` is
`absent`. See [Content pipelines](content-pipelines.md).

## The plan

`create-kei-mmo/plan`. Version 2 — version 2 added the optional `content`
section for 3D plans; 2D plans carry no content section and are otherwise
unchanged. Written to the project as `kei-mmo/plan.json` and rendered to
`kei-mmo/PLAN.md`.

| Field | What it holds |
|---|---|
| `planVersion` | `1` |
| `intent` | The normalized intent it was derived from |
| `engine` | Dimension, renderer, client, server, language, and the rationale for each |
| `reference` | `scaffold` or `clone`, the chosen reference, every candidate's score and verdict, and the reasoning |
| `capabilities` | The selected packets, each with the sentence that selected it |
| `deferred` | Packets left out, each with the reason |
| `constraints` | Non-negotiable rules, each with the reason it exists |
| `acceptance` | Criteria, each with a concrete way to check it |
| `steps` | The build order; each step names the packets it draws on |
| `assumptions` | What was filled in for goals nobody stated |
| `content` | 3D only: the style profile, the content selections with their costs, the generator declarations at their honest statuses, and the versioned pipeline workflows — see [Content pipelines](content-pipelines.md) |

The plan reaches the model as a rendered brief inside the system instruction,
bounded to 28,000 characters. When it does not fit, the per-method explanations
are dropped before the calls are — the call is the actionable part — and if it
still does not fit, the tail is cut with a pointer to `kei-mmo/plan.json`, which
is always complete.

## Constraints

Every plan carries these, and a 2D or 3D plan adds one more:

| ID | Statement |
|---|---|
| `server-authority` | The server owns gameplay outcomes and accepts no economic state; Kei and each signing wallet own value |
| `deterministic-simulation` | One pure fixed-step `step()` shared by client and server |
| `no-credentials-in-project` | No key, seed, endpoint secret, or token in a project file |
| `workspace-only` | Every file written stays inside the workspace |
| `bounded-files` | No single write over 64 KiB; split the module |
| `no-harness-runtime-dependency` | The finished game does not import this harness |
| `assets-by-reference` | Binary assets come from a manifest, never inlined base64 |
| `integer-money` | Economic writes use exact raw decimal strings and never round-trip through display floats |
| `draw-call-budget` (3D) | Draw calls and skinned-mesh counts carry a budget checked in a test |
| `atlas-and-culling` (2D) | One atlas, and the draw loop culled to the visible rectangle |

## Capability packets

`create-kei-mmo/capabilities`. A packet is not a topic. "Animation" names a
subject and leaves a model to invent an approach, which is where
plausible-looking nonsense comes from. Each packet states:

- **prerequisites** — what must already be true before the work can start;
- **tools** — the packages and platform APIs that do it, by name;
- **methods** — the exact calls, spelled as they are written in a source file,
  each with what it is for;
- **acceptance** — observable outcomes somebody can go and check.

The catalog covers rendering (2D and 3D), animation (2D and 3D), shaders,
post-processing, networking and session authority, persistence and world
streaming, Kei economies, UI, audio, content, testing, and deployment.

The `polish-2d` and `polish-3d` packets are planned. Blank scaffolds own their
versioned recipe and fail-closed source-admission check, but no production art,
audio, presentation route, or reviewed capture is claimed. A plan therefore
defers them even when the brief asks for a polished or recordable encounter.

Two examples of what "concrete" means here. The 3D animation packet names
`LoadAssetContainerAsync(url, scene)`, looks up a Babylon `AnimationGroup` by
semantic name, blends groups by weight, and instantiates rigged characters from
an `AssetContainer` so skeletons are not accidentally shared. The networking
packet names the fixed-tick accumulator, exact versioned messages, server-assigned
identity, sequence-numbered direction input, whole-world construction snapshots,
and the per-socket token bucket. The generated baseline also uses a protocol-v2
opaque resume capability and a versioned \`bun:sqlite\` WAL store for only
position and minimal server-authored XP/level; its restart proof exercises three
clean lifecycles and forged-state refusal. Prediction/reconciliation, delta
compression, chunk streaming, account recovery, Kei balances/items/trade, and a
deployment-specific room owner remain separate work.

### The economy packet is the published player-custodied API

Blank projects install the exact supported `kei-transaction@0.6.0` release and
own a runnable `Kei.mock()` proof. A separate provisioner receives an injected
issuer context, issues GOLD with `transfer: 'open'` and `swap: 'one-way'`,
creates a Founder's Sword, and mints both assets directly to their player
custodians. Open transfer is what permits the player-to-player trade; one-way is
the distinct issuer-desk promise that players may buy GOLD from its issuer but
cannot redeem it there. The issuer retains neither trade asset after setup, and
no seed value is emitted outside a clearly labelled public mock-only test
fixture.

The seller calls `market.offer()` from their own `Kei.start()` context, reserving
the item-for-GOLD offer to the buyer and passing it directly rather than
inventing a global order book. The buyer calls `market.accept(offer, { expect })`
with the exact hash, seller, both asset ids, both integer amounts, and the
reservation address. A deliberately mismatched expectation is refused before a
signature and leaves both raw chain balances and the open offer unchanged; the
accepted path settles both legs in one block.

That is the boundary the packet now describes: consensus owns currency, item
ownership, the seller's lock, and atomic settlement; each player signs only for
their own account; issuance belongs to provisioning. There is no local balance
table, two-phase server escrow, or game-server custody. Generated `src/server/**`
does not import Kei or read an issuer credential, and the WebSocket protocol
refuses attempts to author balance, inventory, mint, transfer, or settlement
state. `bun run economy:check` exercises the same proof in fresh 2D and 3D
scaffolds.

## Reading it from code

```ts
import { parseMmoIntent } from 'create-kei-mmo/intent'
import { planMmo } from 'create-kei-mmo/planner'
import { planBrief, renderPlanMarkdown } from 'create-kei-mmo/plan'
import { CAPABILITY_PACKETS } from 'create-kei-mmo/capabilities'

const plan = planMmo(parseMmoIntent({
  name: 'Salvage Run',
  dimension: '3d',
  gameplay: 'Crews salvage derelict stations and haul cargo home.',
}))

plan.reference.strategy      // 'scaffold' | 'clone'
plan.reference.considered    // every candidate, scored, with a verdict
plan.capabilities[0].methods // the calls, not the topics
```

The same plan crosses the [engine JSONL boundary](runtime-protocol.md) when a
session is opened from an intent.
