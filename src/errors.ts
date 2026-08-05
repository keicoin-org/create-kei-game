/**
 * One error class, so the CLI can tell "you typed something I cannot use" apart
 * from "this scaffolder has a bug".
 *
 * The first prints as a sentence and exits 1. The second prints a stack, because
 * a stack is what is useful when the fault is here rather than in the answer.
 * SPEC §6.1: the message states its own fix, and it is the only thing shown.
 *
 * Under `--json` the same failure is a record instead (SPEC §12), and a sentence
 * is not enough to make one. A caller running this unattended has two questions
 * that prose answers only by being read: *what kind* of failure is this, and *is
 * running it again worth anything*. So every failure carries a `Failure` — a code
 * that does not change when the wording does, the stage and step it stopped at,
 * whether a retry could succeed on its own, and the sentence a human would act
 * on.
 *
 * `retryable` is the field with teeth. One thing here fails for reasons outside
 * the command — downloading a template that lives in another repository — and
 * that is the only thing ever marked retryable. An answer this cannot use does
 * not become usable by being sent again.
 */

/** Where in the run it stopped. Coarse on purpose: `step` is the fine grain. */
export type FailureStage = 'arguments' | 'answers' | 'template' | 'target' | 'internal'

/**
 * What went wrong, as a name rather than as a sentence.
 *
 * Adding one is not a breaking change and renaming one is, which is the reason
 * for a closed union: a caller switching on these gets a compile error here
 * rather than a silent fallthrough there.
 */
export type FailureCode =
  // arguments — the command line could not be read
  | 'flag_missing_value'
  | 'flag_unknown'
  | 'name_repeated'
  // answers — the name or the currency cannot be used
  | 'name_empty'
  | 'name_unusable'
  | 'name_too_long'
  | 'currency_empty'
  | 'currency_unusable'
  | 'answer_unprintable'
  | 'answer_too_long'
  | 'input_not_interactive'
  // template — the thing being copied
  | 'template_unknown'
  | 'template_unreachable'
  | 'template_http_error'
  | 'template_corrupt'
  | 'template_drifted'
  // target — where it would be written
  | 'target_not_empty'
  // internal — a bug here
  | 'internal_error'

export interface Failure {
  code: FailureCode
  stage: FailureStage
  /** The operation inside the stage, so a report can name it without parsing prose. */
  step: string
  /**
   * Whether the same command, unchanged, could succeed on a later attempt.
   *
   * This is what an automated caller needs and cannot infer from a message:
   * false means retrying spends a run for nothing, and the input has to change.
   */
  retryable: boolean
  /** One imperative sentence: what to do before running it again. */
  remediation: string
}

export class HarnessError extends Error {
  override readonly name = 'HarnessError'

  constructor(
    message: string,
    readonly failure: Failure,
  ) {
    super(message)
  }
}

export function fail(message: string, failure: Failure): never {
  throw new HarnessError(message, failure)
}

/** The failure of last resort: something threw that was not one of ours. */
export const INTERNAL: Failure = {
  code: 'internal_error',
  stage: 'internal',
  step: 'unhandled',
  retryable: false,
  remediation: 'Report this with the stack it printed. It is a bug in create-kei-game rather than in the command.',
}
