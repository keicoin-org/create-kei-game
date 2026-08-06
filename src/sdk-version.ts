/**
 * The `kei-transaction` range every generated project's `package.json` asks
 * for, and the version this harness's own tests run against.
 *
 * This used to be read straight off this package's own `package.json`
 * `devDependencies` at CLI startup — whatever a routine `npm update`, or a
 * dependency-bot PR merged for the harness's *own* tooling, happened to leave
 * there became what every generated project got, unreviewed and unverified
 * for that purpose. See #75, #73, #68: two of the values that reached
 * generated projects that way — a floating `^0.3.0`, six minors stale, and a
 * pinned `0.6.0` — both resolved an install with duplicate copies of
 * `@keicoin/core` on disk, and nothing here or in CI ever checked what a
 * generated project actually got.
 *
 * This constant is the fix for the mechanism, not just the value: a decision
 * made here, by hand, against a scratch install — not a side effect of
 * updating something unrelated. `test/sdk-version.test.ts` pins this
 * package's own `devDependencies['kei-transaction']` to the same string, so
 * this harness's test suite is always exercising exactly the version it hands
 * to a generated project, and changing one without the other fails CI instead
 * of drifting apart silently.
 *
 * Chosen 2026-08-06, against `npm view kei-transaction versions`: 0.8.0 is
 * the newest version published to npm. A scratch `npm install
 * kei-transaction@0.8.0` still resolves two copies of `@keicoin/core` on disk
 * — 0.5.0 direct (kei-transaction's own declared range is `^0.5.0`) and 0.6.0
 * nested under `@keicoin/tokens`, `@keicoin/wallet` and `@keicoin/work`,
 * which have each independently published versions that need `^0.6.0`. That
 * is the same class of incoherence kei-transaction#157 tracks upstream, and
 * checking versions 0.4.0 through 0.8.0 by hand shows it in every one of
 * them — there is no published version this harness can pin its way out of
 * it with. 0.8.0 is still the right choice: it is the newest available, and
 * this package's own full test suite — which exercises exactly this resolved
 * tree end to end (purchase, restart, chain-rescan, earn) — passes against
 * it. kei-transaction@0.9.0 and the @keicoin/core@0.7.0 wave it depends on
 * fix the duplication properly and are staged, but are not yet on npm:
 * publishing is blocked on the maintainer's 2FA. Bump this the day 0.9.0
 * publishes; `npm view` will not resolve it before then, so do not pin to it
 * early on the assumption it will have landed.
 */
export const GENERATED_SDK_VERSION = '^0.8.0'
