import { Unavailable } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'

// A call to a Worker binding other than D1 (an R2 object, a queue): its rejection is logged once, by its operation and
// the error's name, and answers `Unavailable`, which carries nothing of the cause to a client. D1 has its own
// (`Db.ts`).

/** A binding's rejection, kept only until it is logged. */
class BindingRejected extends Schema.TaggedError<BindingRejected>()('BindingRejected', {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

/** The error's name, bounded for a log line; never its message, which can carry a key. */
const nameOf = (cause: unknown) => (cause instanceof Error ? cause.name.slice(0, 64) : typeof cause)

/** A binding call answered to a client: a rejection is logged and answers `Unavailable`. */
export const called = <A>(run: () => Promise<A>) =>
  Effect.flatMap(Effect.option(Effect.currentSpan), (span) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) =>
        BindingRejected.make({
          operation: Option.match(span, { onNone: () => 'unnamed', onSome: ({ name }) => name }),
          cause,
        }),
    }),
  ).pipe(
    Effect.catchTag('BindingRejected', (rejected) =>
      Effect.logWarning('Styld.Binding unavailable').pipe(
        Effect.annotateLogs({
          'styld.binding.operation': rejected.operation,
          'styld.binding.reason': nameOf(rejected.cause),
        }),
        Effect.andThen(Effect.fail(Unavailable.make({}))),
      ),
    ),
  )
