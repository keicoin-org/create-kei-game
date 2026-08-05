/**
 * Where the two answers stop being text and become part of a file.
 *
 * They land in TypeScript source, in JSON, in HTML and in Markdown, and those
 * four disagree about what a quote, a backslash and a `<` mean. One escape for
 * all four is wrong in three of them, so there are four, and the placeholder in
 * the template says which one it is asking for — `__PROJECT_TITLE_HTML__` is
 * escaped for HTML because that is the only spelling of it there is. No
 * placeholder pastes a value in unescaped, which is the property worth keeping:
 * a template cannot ask for the hole, because there is no way to write it.
 *
 * A block comment is missing from the list on purpose. JavaScript comments have
 * no escape sequence at all: the two characters that end one cannot be written
 * inside one. So no answer goes inside a comment.
 */

/** A complete quoted string literal, which is the same thing in TypeScript and in JSON. */
export function literal(value: string): string {
  return JSON.stringify(value)
}

/** The body of a JSON string, for a value that sits inside a longer one. */
export function jsonText(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

/** Text content and quoted attribute values, which take the same five. */
export function htmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Markdown is prose, so this is the smallest escape that keeps a value from
 * becoming syntax: the inline constructs, plus the two characters a renderer
 * that allows raw HTML would read as the start of some.
 *
 * Not for anything inside a fenced code block, where a backslash is a
 * backslash. Nothing closes a fence from the middle of a line, and `naming.ts`
 * has already refused a value with a newline in it, so those interpolate raw.
 */
export function markdownText(value: string): string {
  return value.replace(/[\\`*_[\]<>&|~]/g, (character) => `\\${character}`)
}
