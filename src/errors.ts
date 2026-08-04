/**
 * One error class, so the CLI can tell "you typed something I cannot use" apart
 * from "this harness has a bug".
 *
 * The first prints as a sentence and exits 1. The second prints a stack, because
 * a stack is what is useful when the fault is here rather than in the answer.
 * The message states its own fix, and it is the only thing shown.
 */
export type HarnessErrorCode = 'invalid_arguments' | 'retired_field'

export interface HarnessErrorDetails {
  readonly field?: string
}

export class HarnessError extends Error {
  override readonly name = 'HarnessError'

  constructor(
    message: string,
    readonly code: HarnessErrorCode = 'invalid_arguments',
    readonly details: HarnessErrorDetails = {},
  ) {
    super(message)
  }
}

export function fail(
  message: string,
  code: HarnessErrorCode = 'invalid_arguments',
  details: HarnessErrorDetails = {},
): never {
  throw new HarnessError(message, code, details)
}
