# First-encounter polish contract

Issue #17 is split at the asset boundary. This slice ships no art, audio,
presentation renderer, capture, or criterion-9 claim. It gives every fresh 2D
and 3D scaffold an exact contract that later asset and presentation work must
satisfy without weakening authority, persistence, or Kei custody proofs.

There is one content/source truth. `kei-mmo/content/sources.json`,
`polish-manifest.json`, and `THIRD_PARTY_ASSETS.md` own source, admission, and
credits. `kei-mmo/polish/` owns `recipe.json`, `style.json`, `quality.json`, and
the dependency-free `check.mjs` presentation gate. Generated code imports no
harness package and the checker remains complete after the harness is deleted.

## Authoritative encounter

Recipe V1 describes a 25-35 second route with exact interact and strike phase
timings. Its server-authored records carry monotonically ticked event ids,
actor, target, action kind, outcome, and contact truth. The capture route must,
in order, show local and labelled scripted-remote connection, approach,
accepted interaction, accepted strike/contact, remote observation of that same
event, refusal, cooldown, recovery, and reset.

Every semantic event has audible, visible, and HUD feedback. Reduced-motion
keeps the exact visible/HUD meaning with zero camera impulse. Low, medium, and
high profiles degrade monotonically and declare 30/60 Hz frame bounds on a
named reference device. Per-file, role, visual, audio, and aggregate byte
budgets are authoritative inputs to admission, and the aggregate budget counts
every packaged byte: processed outputs, retained raw sources, retained licence
files, and generated credits.

Capture semantics are bound, not merely named. Every non-null
`expectedEventId` must resolve to a declared authority event. Interact,
strike, remote-observe, refusal, cooldown, recovery steps must reference a
declared action whose kind matches both the step kind and the resolved
authority event kind, with the outcome each step kind demands. The authority
timeline must contain both interact and strike events. Per-step visual,
audio, and HUD descriptions must be distinct multi-word statements that name
the step's own semantics; single-character or copied placeholders fail.

The recipe is also bound to the admission manifest by semantic role: the
actor's character and rig/atlas, the target, and every cue id must carry the
matching `character`, `rig-or-atlas`, `target`, and `audio` roles, and the
manifest must declare exactly one character, rig/atlas, and target plus
environment, effect, and audio coverage. Swapping hero and sentinel roles or
dropping the environment/effect families fails closed.

## Source and filesystem admission

Provider ids are bound to canonical hosts and acquisition modes. V1 admits
only packaged CC0 sources whose raw redistribution is allowed. Source bytes,
retained licence bytes, processed outputs, and generated credits all carry
exact sizes and SHA-256 values. Credits are regenerated deterministically from
the canonical source registry and checked byte-for-byte.

Portable paths reject absolute paths, traversal, Windows ADS and device names,
trailing dot/space, controls, non-NFC names, and case/Unicode compatibility
collisions. The project-owned checker resolves the real project root, rejects
every symlink or junction component, bounds a file before allocation, reads
through an open descriptor, and checks identity, size, timestamp, and realpath
again after the read.

Admitted runtime bytes must be the media they claim to be. Processed outputs
are limited to PNG, GLB, and Ogg audio, and the checker structurally validates
each admitted file with bounded parsers and no heavyweight decoders: PNG
signature, IHDR sanity, chunk CRC-32, and non-empty image data; GLB container
header, chunk layout, and a glTF 2.0 JSON skeleton with real meshes (or
animations for rig requirements); Ogg page structure, page CRCs, an
Opus/Vorbis identification header, a terminating page, and non-zero duration.
Retained licence bytes must be readable UTF-8 CC0 1.0 dedication text, not an
arbitrary hashed blob, canonical provider URLs must use the provider's pinned
asset-path shape, and attribution must name the provider and licence. This
gate is offline and structural: it cannot prove a provider asset/version still
exists upstream, and does not claim to.

The generated checker embeds the exact authoritative recipe, requirement,
source, role-binding, media, and licence validator functions used by the
harness. Parser-equivalence and mutation tests cover forged schemas, junction
escapes, provider/licence/credits/hash mismatches, Windows aliases, and
oversized bytes for both dimensions, and a combined regression replays the
full demonstrated forgery: text bytes labelled PNG/GLB/OGG, fake licence
text, swapped actor/target roles, absent environment/effect families,
strike-only authority, nonexistent capture event ids, and single-character
feedback must never reach `polish_ready`.

## Expected state

`bun run polish:check` intentionally exits 1 with
`polish_assets_pending` in a fresh blank project because the canonical source
registry is empty. A positive admitted fixture proves the same checker can emit
`polish_ready`, but no fixture bytes ship in generated projects.

`polish-2d` and `polish-3d` remain `planned`. Neither becomes `available` until
real admitted runtime bytes, presentation code, capture/check evidence, and
human review land. This contract does not satisfy SPEC section 11.3 criterion
9.
