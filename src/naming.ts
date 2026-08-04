/**
 * One answer in, two names out.
 *
 * The project name is the only thing the harness derives anything from now:
 * what a human typed, and the directory that name becomes. There is no currency
 * here any more — a blank workspace has none, and the games that do have one
 * declare it in their own source, where it belongs.
 */

import { fail } from './errors.js'
import type { ProjectIdentity } from './source.js'

/** npm's limit. Nobody will reach it, and a name that does is a typo. */
const MAX_SLUG_LENGTH = 214

/**
 * `"Carpet Markets"` → `"carpet-markets"`. Also the directory it lands in, so
 * whoever types a title gets the directory they would have chosen anyway.
 */
export function slugFor(projectName: string): string {
  const slug = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (slug === '') {
    fail(
      `"${projectName}" has no letters or digits in it, so there is no directory name in it either. Try something like "my-game".`,
    )
  }
  if (slug.length > MAX_SLUG_LENGTH) {
    fail(`"${projectName}" is longer than npm allows for a package name (${MAX_SLUG_LENGTH} characters). Shorten it.`)
  }
  return slug
}

/** The one answer, checked and completed. Nothing is prepared before this passes. */
export function projectFrom(name: string): ProjectIdentity {
  const title = name.trim()
  if (title === '') fail('The project needs a name — it becomes the directory this is prepared in. Try "my-game".')

  return Object.freeze({ title, slug: slugFor(title) })
}
