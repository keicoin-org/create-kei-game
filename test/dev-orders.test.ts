/**
 * The one line in the generated dev server that can lose a customer.
 *
 * `server/orders.ts` is a write-ahead log: it is the only record of which
 * payment got which answer, because the chain can show that the game answered a
 * wallet and cannot show which of that wallet's payments the answer was for.
 * `restart.test.ts` is the proof of what that file buys, including what is lost
 * with it — `with the log gone entirely, both payments are refused rather than
 * guessed at`.
 *
 * `server/main.ts` deletes that file on startup, and for a mock node it is
 * right to: the chain is in memory, so last run's answers are about payments
 * that no longer exist. It used to do it unconditionally, so a developer who
 * followed the README's testnet migration deleted every past customer's answer
 * on the next `bun run dev` and refused all of them from then on. That is #39,
 * fixed by the `node instanceof MockNode` guard the first test below pins.
 *
 * These are assertions about the source of the generated project rather than
 * about a running one, which is unusual here and is on purpose. `server/main.ts`
 * is a boot script that bundles the client and binds a port; the mock is
 * constructed inside it and cannot be substituted from a test, so the branch
 * that matters — the one where the node is real — is not reachable by running
 * it. What is reachable is the shape of the emitted file, and the shape is
 * exactly what regressed: an `rm` with nothing in front of it.
 */

import { describe, expect, test } from 'bun:test'

import { projectFrom } from '../src/naming.js'
import { scaffold, type TextFile } from '../src/scaffold.js'

const generated = await scaffold(projectFrom({ name: 'Star Clicker', currency: 'Gold Pieces' }), {
  sdkVersion: '^0.3.0',
})

const file = (path: string): string => {
  const found: TextFile | undefined = generated.find((candidate) => candidate.path === path)
  if (!found) throw new Error(`${path} is missing. Got: ${generated.map((each) => each.path).join(', ')}`)
  return found.contents
}

const main = file('server/main.ts')

/** The statements that delete the orders file, one line each in this template. */
const deletions = main.split('\n').filter((line) => /\brm\(/.test(line) && line.includes('orders'))

describe('the generated dev server and the purchase log', () => {
  test('deletes the orders file in one place, and only when the node is the mock', () => {
    expect(deletions).toHaveLength(1)
    expect(deletions[0]).toContain('MockNode')
  })

  test('the guard is not a comment: an unconditional delete is the bug', () => {
    // `await rm(orders, …)` as a statement of its own is what shipped, and what
    // the prose above it already advised against. Prose is not a guard.
    expect(main).not.toMatch(/^\s*await rm\(orders/m)
  })

  test('the identifier the guard is written against is imported', () => {
    // The migration tells the developer to stop using `MockNode`. If that import
    // goes while the guard stays, the generated project stops compiling — so the
    // two have to be read together, and this fails if the import is dropped here.
    expect(main).toMatch(/import \{[^}]*\bMockNode\b[^}]*\} from 'kei-transaction'/)
  })

  test('the migration instructions tell the developer what to do with that line', () => {
    // #39 was as much a documentation bug as a code one: the README said to
    // point at a real node and said nothing about the line that wiped the log.
    const readme = file('README.md')
    const migration = readme.slice(readme.indexOf('## When there is a testnet'))

    expect(migration).toContain('dev-orders.ndjson')
    expect(migration).toContain('MockNode')
  })

  test('and what a lost log costs, since that is what the player sees', () => {
    // The refusal is deliberate and it is not self-explanatory to whoever is
    // reading a support message about it.
    const readme = file('README.md')
    expect(readme).toContain('If the orders file is lost')
    expect(readme).toContain('already been answered')
  })
})
