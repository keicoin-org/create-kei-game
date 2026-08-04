# 3D content pipelines

Four pipelines carry a 3D plan's content: models and props, rigging and
animation, SFX and audio, and directed cut-scenes. Everything they touch is a
**versioned record with a defensive parser** — a document that is not exactly
the shape and version this build speaks parses to `null` and drops out; it
never half-loads and never throws. Everything they run is **pure and
deterministic**: no clock, no randomness, same inputs, same bytes.

They exist for 3D plans only. A 2D plan carries no content section, receives no
content files, and behaves exactly as it did before these pipelines existed.

## Style: read once, assumed never

`create-kei-mmo/style`. Version 1.

`resolveStyle(intent)` reads two independent axes out of every goal at once:

| Axis | Values | Decides |
|---|---|---|
| `setting` | `science-fiction`, `contemporary`, `historical`, `fantasy`, `unspecified` | Which prop kit and audio palette the manifest carries, and the cut-scene's title flavour |
| `finish` | `grounded`, `stylized` | `MeshStandardMaterial` PBR versus `MeshToonMaterial` flat ramps |

Most evidence wins; a tie goes to whichever setting the brief mentioned first —
still the brief deciding, never this file. The profile keeps the exact matched
words in `evidence`, so the decision can be argued with.

**The rule that matters: no setting is ever assumed.** A brief that names no
setting gets `unspecified` and the neutral previs kit — geometry with no genre
in it. Fantasy in particular is only ever a reading of fantasy words in the
brief. The tests hold this on both axes: non-fantasy briefs never resolve to
fantasy, and an unspecified plan's content contains no genre vocabulary at all.

## The content manifest and the admission gate

`create-kei-mmo/content`. Manifest version 1.

Every asset is a record in `kei-mmo/content/manifest.json`, in one of two
families:

- **Data assets** embed their document: `prop-spec` (primitive kitbash parts),
  `rig`, `motion-clip` (keyframe tracks against a rig), `audio-cue` (category,
  diegetic flag, synthesized placeholder voice). Validated in place, at their
  versions.
- **File assets** reference bytes on disk: `model-file` (.glb/.gltf),
  `motion-file`, `audio-file`. Each carries provenance (`authored`,
  `generated` with the generator's name, or `imported` with an origin) and a
  **licence, which is mandatory** — an unlicensed file blocks, it is not a
  warning.

`admitAssets(manifest, probe)` gives every record a verdict and reports every
failure in one pass. The verdict codes are stable:

| Code | Meaning |
|---|---|
| `generator_output_missing` | A record claims a generator produced a file and nothing is on disk. **This is the honest-generator rule enforced**: a declared output that does not exist blocks admission instead of becoming a broken reference. |
| `file_missing` / `empty_file` | An authored or imported file is absent, or present with zero bytes |
| `missing_licence` | A file asset with no licence |
| `wrong_extension` / `unsafe_path` / `missing_path` / `unexpected_path` | The reference itself is malformed |
| `invalid_data` / `unknown_rig` / `duplicate_id` / `invalid_record` | The embedded document fails its parser or names things this build does not define |

Only admitted ids exist to the rest of the pipeline. Scenes, beats, and cue
placements are checked against the admitted set at rehearsal, and the same
check ships **inside the generated project** as `kei-mmo/content/check.mjs` —
plain Node, no dependencies, run by `npm run content:check`.

## Rigging, motion, and the ready gate

`create-kei-mmo/motion`. Rig version 1, clip version 1.

The one rig this harness authors for is `previs-biped`: eight nodes, blocking
grade, honest about not being a deformation rig. Clips are keyframe documents
against a named rig; every track must name a real node and stay inside the
clip's own duration. Five authored clips ship: `idle-breathe`, `walk-loop`,
`turn-quarter`, `gesture-point`, `kneel-inspect` — previs motion, not final
animation, and nothing claims otherwise.

**The adapter seam** is where generated or captured motion arrives. It is
shaped so an ARDY-style text-to-motion service drops in without changing any
caller:

```ts
interface MotionAdapter {
  id: string; title: string; capability: string
  ingest(request: MotionIngestRequest, probe: MotionProbe): Promise<MotionIngestReport>
}
// request:  { clips: [{ id, prompt?, durationMs?, seed?, path? }] }  — seeds pinned, never defaulted
// report:   { adapter, clips: [{ id, status: ready|pending|failed|missing, clipVersion?, clip?, reason? }] }
```

A report answers **every** requested clip explicitly; silence is not a status.
The built-in `authored-clips` adapter resolves against the authored catalog
through this same seam. The external service itself is the
`content-3d-motion-capture` capability, status **planned** — the seam and gate
are implemented and tested, the service is not, and no clip is promised from
it.

**The ready gate** is one strict triple, checked in one function so it cannot
drift:

```ts
isClipReady(record) === (record.status === 'ready'
  && record.clip !== undefined
  && record.clipVersion === MOTION_CLIP_VERSION)
```

A claim of ready with no payload fails closed. A version from the future fails
closed. `motionReadyGate(records, requiredIds)` resolves every clip a scene
needs and reports every miss at once. Its promise, enforced at assembly and
re-checked by the project's own script: **no scene document is ever emitted
referencing a clip that is not ready.**

## SFX and audio

Audio cues are placement intent plus a placeholder voice: a category (`sfx`,
`music`, `ambience`), a diegetic flag, and a `SynthSpec` — one oscillator or
noise burst with an envelope, playable through any Web Audio context the
project owns. Five palettes ship, one per setting plus neutral.

Placement happens on cut-scene beats: `{ cueId, atMs, gain, spatial? }`, where
diegetic cues anchor to a staged placement and fall off over a declared radius.
Rehearsal refuses a placement whose cue was never admitted. A plan with no
audio in it produces beats with no cues — never dangling ids.

The placeholders are deliberately not passed off as produced audio. Real audio
arrives as `audio-file` records (with licences), or through the
`content-3d-sfx-generation` capability — status **planned**, with the
admission gate for its outputs already real.

## Directed cut-scenes

`create-kei-mmo/cutscene`. Plan version 1, document version 1.

Five stages, every one a pure function:

1. **`planCutScene`** — cast, subject, props, cues, and a style-flavoured
   title. Validates its bounds (≤ 6 cast, ≤ 8 props).
2. **`stageCutScene`** — deterministic blocking: props on an upstage arc, cast
   downstage, a wide and a close camera with explicit look-at and FOV.
   Variation comes from the inputs, never a dice roll.
3. **`cutSceneBeats`** — the arrival arc (establish, approach, feature,
   reveal): timed beats carrying a camera move *by reference* (`kind` +
   params, never baked keyframes), actor actions naming clips, and cue
   placements. Each beat derives one plain sentence saying what reads on
   screen.
4. **`rehearseCutScene`** — the checking pass. Every violation reported at
   once, with stable codes: `missing_clip` (via the ready gate),
   `cue_not_admitted`, `prop_not_admitted`, `unstaged_actor`,
   `unknown_camera`, `unknown_move`, `beat_too_short`, `beat_too_long`,
   `too_many_beats`, `cutscene_too_long`, `spatial_anchor_unstaged`.
5. **`assembleCutScene`** — refuses a failed rehearsal outright
   (`CutSceneError` code `rehearsal_failed`), then emits the versioned
   document: sorted stage, beats with accumulated `startMs`, total duration,
   and sorted asset lists a loader can preflight.

The bounds are published constants: at most 12 beats, 60 seconds total, each
beat 500 ms – 12 s. Assembly is byte-deterministic — the test assembles twice
and compares the JSON.

**The one repair is `stripUnready`**: drop the reference that cannot be
satisfied, so the actor holds instead of performing and the cue simply does
not play. Structural failures are not strippable — deleting the scene's shape
to pass rehearsal would be the dishonest fix. Either way the invariant holds:
a scene referencing a missing clip is never emitted.

The camera grammar is `static`, `push-in`, `pull-back`, `orbit-quarter`. The
project-owned player (`src/shared/cutscene.ts`, written by the scaffold,
imports nothing) interprets the references; an unknown kind plays as a hold —
degraded, visible, and safe.

## What a 3D scaffold receives

| Path | Contents |
|---|---|
| `kei-mmo/content/manifest.json` | The starter records: the style's prop kit, the rig, the authored clips, and — when the intent asked for sound — the style's cue palette |
| `kei-mmo/content/pipelines.json` | The four workflow records, versioned, plus the generator declarations at their honest statuses |
| `kei-mmo/content/check.mjs` | The project's own admission gate, plain Node, wired as `npm run content:check` |
| `kei-mmo/content/cutscenes/<slug>-arrival.json` | The assembled intro scene — only when the intent asked for cut-scenes, and only after the pipeline ran for real at scaffold time |
| `src/shared/cutscene.ts` | The player: pure functions over the document, no imports, no harness |

The harness runs admission, the ready gate, rehearsal, and assembly for real
while scaffolding. If its own starter content ever failed those gates, the
scaffold fails loudly — that would be a harness defect, not something to ship.

Clones receive none of this: a reference project is never implicitly
rewritten. And nothing above enters a 2D scaffold.

## What is planned or absent, said plainly

| Capability | Status | Why |
|---|---|---|
| `content-3d-model-generation` | **planned** | Needs an external text-to-3D service and a review pass; neither is bundled. The admission gate for its outputs already runs. |
| `content-3d-motion-capture` | **planned** | Needs an external ARDY-style motion service. The adapter seam, records, and ready gate are implemented and tested; the service is not. |
| `content-3d-sfx-generation` | **planned** | Needs an external audio generator. Placeholder synth voices are not passed off as one. |
| `content-3d-voice-acting` | **absent** | Casting, consent, and licensing review cannot be vouched for by an offline gate, and synthetic voices of real people are a line this harness does not go near. Licensed recordings enter as ordinary `audio-file` records. |

A plan can only select `available` packets. These four appear in every 3D
plan's deferred list naming their status — and when the intent explicitly asks
for one, the deferral quotes the ask and says the status anyway. No provider
key or generator secret is ever written into a generated project; when a
generator adapter does land, its credential will be read from the harness's
environment at call time, exactly as model providers are today.
