/**
 * The holes a template still has in it, declared so a typechecker can read the
 * template before `scaffold()` fills them.
 *
 * A `__…_LITERAL__` token sits where an expression goes — `const title =
 * __PROJECT_TITLE_LITERAL__` — and `scaffold()` replaces it with the output of
 * `literal()` in `src/escape.ts`, which is a quoted TypeScript string. So the
 * token is a valid identifier in an unsubstituted template and a string once
 * substituted, and declaring it `string` is not a stand-in for the real type:
 * it *is* the real type. The generated project has no such declaration and
 * needs none, because by then the identifier is gone.
 *
 * This file is deliberately outside `templates/`, because `scaffold()` copies
 * every file under that directory into the developer's project verbatim.
 *
 * Only the tokens that appear in TypeScript are here. The ones for JSON, HTML
 * and Markdown (`__PROJECT_SLUG_JSON__`, `__PROJECT_TITLE_HTML__`, …) land in
 * files no compiler reads, and `src/scaffold.ts` is the list of all of them.
 */

/** The developer's title for the game, as they typed it. */
declare const __PROJECT_TITLE_LITERAL__: string

/** What the game's currency is called. */
declare const __CURRENCY_NAME_LITERAL__: string

/** The ticker the chain knows that currency by. */
declare const __CURRENCY_SYMBOL_LITERAL__: string
