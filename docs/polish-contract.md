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
timeline must contain both interact and strike events, and remote-observe must
repeat the accepted strike step's event, action, actor, target, outcome, and
contact bindings. Per-step visual, audio, and HUD descriptions must each be a
distinct multi-word statement that independently names the step's own
semantics; concentrating meaning in one channel while the other two are
placeholders fails.

The recipe is also bound to the admission manifest by semantic role: the
actor's character and rig/atlas, the target, and every cue id must carry the
matching `character`, `rig-or-atlas`, `target`, and `audio` roles, and the
manifest must declare exactly one character, rig/atlas, and target plus
environment, effect, and audio coverage. Swapping hero and sentinel roles or
dropping the environment/effect families fails closed.

## Source and filesystem admission

Provider ids are bound to a finite offline admission catalog, not merely to a
host-shaped URL. V1's reviewed records pin the canonical Kenney asset page,
published package version, direct package URL and archive entry, retained
source size/hash, provider `License.txt` size/hash, attribution, and
acquisition mode for Tiny Dungeon 1.0 and RPG Audio 1.0. A provider-shaped but
invented asset/version, a different retained source hash, or keyword licence
text fails even when every manifest field agrees with the assertion. Credits
are regenerated deterministically from the admitted source registry and
checked byte-for-byte.

Portable paths reject absolute paths, traversal, Windows ADS and device names,
trailing dot/space, controls, non-NFC names, and case/Unicode compatibility
collisions. The project-owned checker resolves the real project root, rejects
every symlink or junction component, bounds a file before allocation, reads
through an open descriptor, and checks identity, size, timestamp, and realpath
again after the read.

Admitted runtime bytes must be the media they claim to be. Processed outputs
are limited to PNG, GLB, and Ogg Opus audio. PNG admission checks chunk order
and CRCs, bounded zlib decompression, exact scanline length, reverses filters
0-4 with bounded row buffers, validates every palette index, and measures
resolved pixel colours rather than filtered bytes or palette indices. GLB
admission checks its only JSON/BIN chunks, buffer-view and accessor byte ranges,
requires every declared mesh to be reachable from the active scene, and admits
only triangle primitives with at least four unique referenced positions and no
degenerate triangle. Animation admission requires observable motion on a joint
from a skin attached to a scene-reachable mesh node, alongside an increasing
finite timeline.
Ogg admission checks page CRCs, stream serial/sequence/flags, packet lacing,
Opus identification and tags packets, and rejects trivially short single-packet
audio before a positive-granule EOS. PNG admission rejects tiny or effectively
uniform placeholder images after bounded decoding. Retained
licence bytes must exactly match a provider-retained, catalogued CC0 file. This
gate is offline: it verifies pinned evidence already in the project but does
not re-fetch a provider. Because structural parsing cannot prove faithful
semantic derivation, an output hash must also appear in the reviewed catalog
before the state can become `polish_ready`; otherwise the explicit result is
`polish_review_required`.

The catalog binds each requirement to a dimension, role, kind, semantic family,
official archive member, retained member hash, and genuine licence hash.
Distinct visual roles and audio cue families cannot reuse the same processed
hash unless the catalog explicitly reviews that reuse.

The generated checker embeds the exact authoritative recipe, requirement,
source, role-binding, media, and licence validator functions used by the
harness. Parser-equivalence and mutation tests cover forged schemas, junction
escapes, provider/licence/credits/hash mismatches, Windows aliases, and
oversized bytes for both dimensions. Generated-boundary regressions also
replay CRC-correct invalid PNG deflate, an out-of-range GLB `POSITION`
accessor, an EOS Ogg stream with duration metadata but no audio packet,
invented catalog assertions, two placeholder feedback channels, and a remote
observation rebound to the interaction event. It also replays the demonstrated
one-gradient/one-triangle/no-op-animation/one-tiny-Opus alias attack in both
dimensions; none may reach `polish_ready`.

## Expected state

`bun run polish:check` intentionally exits 1 with
`polish_assets_pending` in a fresh blank project because the canonical source
registry is empty. Structurally valid, role-bound bytes remain
`polish_review_required` until their processed hashes receive explicit catalog
review; placeholder or cross-role aliases are `polish_assets_invalid`. No
fixture bytes ship in generated projects.

`polish-2d` and `polish-3d` remain `planned`. Neither becomes `available` until
real admitted runtime bytes, presentation code, capture/check evidence, and
human review land. This contract does not satisfy SPEC section 11.3 criterion
9.
