# First-encounter polish contract

Issue #17 is intentionally split at the asset boundary. This first slice does
not ship art, audio, a presentation renderer, or capture evidence. It gives a
fresh 2D or 3D scaffold a versioned contract that those later slices must
satisfy without weakening the existing authority, persistence, or Kei custody
proofs.

Every blank scaffold owns `kei-mmo/polish/`:

| File | Contract |
|---|---|
| `recipe.json` | Version-1 30-second route, semantic interact/strike timing, cue/effect mapping, quality profiles, and deterministic capture steps. |
| `manifest.json` | The exact asset roles required by that dimension. These are requirements, not placeholder assets. |
| `sources.json` | Source admission records. It starts empty because no provider bytes have been selected in this slice. |
| `style.json` | The resolved style profile whose exact bytes are bound by `styleProfileHash` in the recipe. |
| `quality.json` | A separately inspectable copy of the low/medium/high profiles; the check requires an exact match with the recipe. |
| `THIRD_PARTY_ASSETS.md` | The future licence inventory. It currently says that nothing is admitted. |
| `check.mjs` | A dependency-free, project-owned check. It does not import or locate the harness. |

## Defensive records

The harness parser accepts only recipe version 1 and exact record keys. The
route must last 25–35 seconds. Action milestones are strictly ordered from
anticipation through contact and recovery, cooldown cannot finish before
recovery, action and cue ids are unique, and capture steps are ordered and
refer to declared actions.

Quality is degradable only in the cheap direction: a lower tier cannot demand
more particles, voices, camera impulse, shadows, or post-processing than a
higher tier. Timing and semantic feedback do not disappear at low quality.

Each admitted source must have a canonical credential-free HTTPS URL without a
query or fragment, a provider asset version, acquisition mode and UTC time, a
source SHA-256, an exact licence id/reference plus a safe retained licence-file
path, attribution, a redistribution policy, and one or more safe processed
output paths with their own SHA-256 values. Absolute paths, traversal, runtime
URLs, duplicate/case-colliding outputs, missing hashes, and missing licence
facts are refused.

## Expected failure

Run `bun run polish:check` in a generated project. It currently exits 1 and
emits a machine-readable `polish_assets_pending` result naming every required
asset with no source record. That failure is the acceptance result for this
slice. The construction renderer does not load the recipe or any pretend
placeholder route.

`polish-2d` and `polish-3d` remain `planned`. Neither may become `available`
until admitted runtime bytes, semantic action authority, presentation code,
capture/check evidence, and human review all exist. This contract therefore
does not satisfy SPEC §11.3 criterion 9.
