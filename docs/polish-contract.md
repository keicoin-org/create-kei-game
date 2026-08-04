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
keeps equivalent visible/HUD meaning with zero camera impulse. Low, medium, and
high profiles degrade monotonically and declare 30/60 Hz frame bounds on a
named reference device. Per-file, role, visual, audio, and aggregate byte
budgets are authoritative inputs to admission.

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

The generated checker embeds the exact authoritative recipe, requirement, and
source validator functions used by the harness. Parser-equivalence and mutation
tests cover forged schemas, junction escapes, provider/licence/credits/hash
mismatches, Windows aliases, and oversized bytes for both dimensions.

## Expected state

`bun run polish:check` intentionally exits 1 with
`polish_assets_pending` in a fresh blank project because the canonical source
registry is empty. A positive admitted fixture proves the same checker can emit
`polish_ready`, but no fixture bytes ship in generated projects.

`polish-2d` and `polish-3d` remain `planned`. Neither becomes `available` until
real admitted runtime bytes, presentation code, capture/check evidence, and
human review land. This contract does not satisfy SPEC section 11.3 criterion
9.
