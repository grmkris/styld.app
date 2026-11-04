import { Schema } from 'effect'

/** How a refusal reads to an assistant: a stable `code`, whether the same call can succeed later (`retryable`), what
 * went wrong and what to do next. `{field}` in the words stands for the error's own field of that name. */
export interface Guide {
  readonly code: string
  readonly message: string
  readonly recovery: string
  readonly retryable: boolean
}

/** One guide for each value of the error's case field (its `reason`, or a `LimitReached`'s `limit`). */
export interface GuideByCase {
  readonly field: string
  readonly cases: Readonly<Record<string, Guide>>
}

declare module 'effect/Schema' {
  namespace Annotations {
    interface Augment {
      /** How the error reads to an assistant (MCP), declared with the error so every surface says the same. */
      readonly guide?: Guide | GuideByCase | undefined
    }
  }
}

/** A refusal the same call cannot get past. */
export const refusal = (code: string, message: string, recovery: string): Guide => ({
  code,
  message,
  recovery,
  retryable: false,
})

/** A refusal the same call can get past later. */
export const passing = (code: string, message: string, recovery: string): Guide => ({
  code,
  message,
  recovery,
  retryable: true,
})

/** A guide for each case of a literal field, checked against the field's values. */
export const byCase = <Case extends string>(field: string, cases: Readonly<Record<Case, Guide>>): GuideByCase => ({
  field,
  cases,
})

/** Storage, a queue or a provider did not answer: the same request may be repeated (writes with the same
 * `operationId`). */
export class Unavailable extends Schema.TaggedError<Unavailable>()(
  'Unavailable',
  {},
  {
    httpApiStatus: 503,
    guide: {
      code: 'unavailable',
      message: 'Styld could not do that just now.',
      recovery: 'Try again in a moment; repeat a change with the same operationId.',
      retryable: true,
    },
  },
) {}

/** Too many of these requests from one account or network in a short time; `retryAfter` seconds when known. */
export class SlowDown extends Schema.TaggedError<SlowDown>()(
  'SlowDown',
  { retryAfter: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))) },
  {
    httpApiStatus: 429,
    guide: {
      code: 'slow_down',
      message: 'Too many of these in a minute.',
      recovery: 'Wait a minute, then try again.',
      retryable: true,
    },
  },
) {}

/** Nothing with that id or handle for this reader: missing, someone else's, private or held back, alike. */
export class NotFound extends Schema.TaggedError<NotFound>()(
  'NotFound',
  {},
  {
    httpApiStatus: 404,
    guide: {
      code: 'not_found',
      message: 'There is nothing with that id here, or it is not this account’s.',
      recovery: 'Find the id again with piece_search, look_list, board_list or the public page.',
      retryable: false,
    },
  },
) {}

/** Which of the account's allowances is spent. */
export const Limit = Schema.Literals([
  'credits',
  'dailyCredits',
  'thinking',
  'reports',
  'uploads',
  'styleNotes',
  'feedback',
])
export type Limit = typeof Limit.Type

/** One of the account's allowances is spent: the free credits of an account without a plan (none come back), a
 * member's credits today (back at `resetsAt`), today's Thinking outfits, this
 * hour's reports, the uploads that may wait unused, or the notes Styld keeps. */
export class LimitReached extends Schema.TaggedError<LimitReached>()(
  'LimitReached',
  { limit: Limit, resetsAt: Schema.optionalKey(Schema.String) },
  {
    httpApiStatus: 429,
    guide: byCase<Limit>('limit', {
      credits: {
        code: 'credits_used',
        message: 'Your 3 free cut-outs are used. Choose a plan to keep going.',
        recovery:
          'Tell the person to choose a plan at https://styld.app/account: a week, a month, a year or lifetime, each with 500 credits a day.',
        retryable: false,
      },
      dailyCredits: {
        code: 'daily_limit',
        message: 'Today’s 500 credits are used up.',
        recovery: 'Try again after {resetsAt}; the plan brings 500 more each day.',
        retryable: false,
      },
      thinking: {
        code: 'thinking_spent',
        message: 'Today’s Thinking outfits are spent.',
        recovery: 'Ask again with mode fast.',
        retryable: false,
      },
      reports: {
        code: 'too_many_reports',
        message: 'Ten reports an hour at most.',
        recovery: 'Try again in an hour.',
        retryable: false,
      },
      uploads: {
        code: 'too_many_uploads',
        message: 'Too many uploads are waiting unused.',
        recovery: 'Use the photos and videos already uploaded, or try again tomorrow.',
        retryable: false,
      },
      styleNotes: {
        code: 'too_many_style_notes',
        message: 'Styld already remembers as many notes as it keeps.',
        recovery: 'Remove a note with note_delete, then add the new one.',
        retryable: false,
      },
      feedback: {
        code: 'too_much_feedback',
        message: 'Thirty notes a day to Styld at most.',
        recovery: 'Send more tomorrow.',
        retryable: false,
      },
    }),
  },
) {}

/** The operation id was already used for a different change. */
export class OperationConflict extends Schema.TaggedError<OperationConflict>()(
  'OperationConflict',
  {},
  {
    httpApiStatus: 409,
    guide: {
      code: 'operation_conflict',
      message: 'That operationId was already used for a different change.',
      recovery: 'Use a new operationId for a new change.',
      retryable: false,
    },
  },
) {}

/** A change the server refused before running it: it did not come from the website itself (wrong Origin or missing
 * CSRF header). Only the website's session meets it, never an assistant, so it has no guide. */
export class RequestRefused extends Schema.TaggedError<RequestRefused>()(
  'RequestRefused',
  {},
  { httpApiStatus: 403 },
) {}
