/**
 * The three holes a template still has when it is checked in this repository.
 *
 * `src/scaffold.ts` fills them with escaped string literals on the way out, so
 * in a generated project these identifiers do not exist. Here they do not exist
 * either — which is why `templates/` could not be handed to a typechecker until
 * something told it what shape they will be.
 *
 * `string` rather than a literal type, so this file makes no claim about *which*
 * name or title a project ends up with. Every use in `templates/` has to hold
 * for all of them.
 */

declare const __PROJECT_TITLE_LITERAL__: string
declare const __CURRENCY_NAME_LITERAL__: string
declare const __CURRENCY_SYMBOL_LITERAL__: string
