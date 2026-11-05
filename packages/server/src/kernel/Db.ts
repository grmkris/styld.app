import { Unavailable } from '@styld/protocol'
import { drizzle } from 'drizzle-orm/d1'
import { Array, Context, DateTime, Effect, Layer, Option, Schema } from 'effect'

// What every store shares: how a D1 call fails, the first row of a result, id lists cut to D1's parameter limit and the
// time a row is written at. One copy here; each module's Store builds its queries on these.

/** D1 did not answer; the request may be retried. `operation` names the span that asked and `cause` is D1's rejection,
 * kept for the log line `stored` writes and never sent to a client. */
export class StoreUnavailable extends Schema.TaggedError<StoreUnavailable>()('StoreUnavailable', {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

/** The messages of a rejection and of the causes it wraps (Drizzle wraps D1's error in its own). */
const messagesOf = (cause: unknown): ReadonlyArray<string> => {
  const messages: Array<string> = []
  let current: unknown = cause
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    messages.push(current.message)
    current = current.cause
  }
  return messages
}

const constraintFailed = /\b(?:UNIQUE|FOREIGN KEY|NOT NULL|CHECK) constraint failed\b|SQLITE_CONSTRAINT/

/** Whether D1 refused a row by a table's constraint, rather than not answering.
 * @internal Exported for its tests. */
export const refusedByConstraint = (cause: unknown) =>
  messagesOf(cause).some((message) => constraintFailed.test(message))

/** The kind of a D1 failure, bounded for a log line: SQLite's result code or D1's phrase, never the message, which
 * carries the statement.
 * @internal Exported for its tests. */
export const reasonOf = (cause: unknown) => {
  for (const message of messagesOf(cause)) {
    const code = /\bSQLITE_[A-Z_]+\b/.exec(message) ?? /\bD1_[A-Z_]+\b/.exec(message)
    if (code !== null) return code[0]
    if (/network connection lost/i.test(message)) return 'network-lost'
    if (/timed? ?out/i.test(message)) return 'timeout'
    if (/overloaded/i.test(message)) return 'overloaded'
  }
  return 'unknown'
}

/** The span a D1 call ran in, which names the operation for the log. */
const currentOperation = Effect.map(
  Effect.option(Effect.currentSpan),
  Option.match({ onNone: () => 'unnamed', onSome: (span) => span.name }),
)

/** A D1 call whose every rejection is `StoreUnavailable`, named by the span it ran in. */
const attempted = <A>(run: () => Promise<A>) =>
  Effect.flatMap(currentOperation, (operation) =>
    Effect.tryPromise({ try: run, catch: (cause) => StoreUnavailable.make({ operation, cause }) }),
  )

/** A D1 call. A rejection is the store being unavailable, which may be retried; a row a constraint refuses is a broken
 * invariant, a defect, unless the write is `fenced`. */
export const query = <A>(run: () => Promise<A>) =>
  attempted(run).pipe(
    Effect.catchIf(
      (error) => refusedByConstraint(error.cause),
      (error) => Effect.die(error.cause),
    ),
  )

/** A write whose constraints are its guard: an operation id another request took first (the receipt's key), an upload
 * already spent, a board saved at another version or an account closed in between (a NOT NULL fence). Every rejection,
 * a refused row included, is `StoreUnavailable`, which its caller answers. */
export const fenced = <A>(run: () => Promise<A>) => attempted(run)

/** Log a store that did not answer, once, with its operation and kind of failure. */
export const logUnavailable = (error: StoreUnavailable) =>
  Effect.logWarning('Styld.Store unavailable').pipe(
    Effect.annotateLogs({ 'styld.store.operation': error.operation, 'styld.store.reason': reasonOf(error.cause) }),
  )

/** A store call answered to a client: the store being unavailable is logged here and answers `Unavailable`, which
 * carries nothing of the cause. */
export const stored = <A, R>(effect: Effect.Effect<A, StoreUnavailable, R>) =>
  Effect.catchTag(effect, 'StoreUnavailable', (error) =>
    Effect.andThen(logUnavailable(error), Effect.fail(Unavailable.make({}))),
  )

/** The first row of a result, if any. */
export const first = <A>(rows: ReadonlyArray<A>) => Option.fromNullishOr(rows[0])

/** D1 binds at most 100 parameters to a statement, so id lists go in chunks. */
export const chunked = (ids: ReadonlyArray<string>) => Array.chunksOf(ids, 90).map((chunk) => [...chunk])

/** One query per chunk of ids, their rows together; no ids ask nothing. */
export const inChunks = <A>(ids: ReadonlyArray<string>, run: (chunk: Array<string>) => Promise<ReadonlyArray<A>>) =>
  Effect.map(
    Effect.forEach(chunked(ids), (chunk) => query(() => run(chunk))),
    (rows) => rows.flat(),
  )

/** Now, as the Date a row stores. */
export const nowDate = Effect.map(DateTime.now, DateTime.toDateUtc)

/** The D1 binding drizzle runs over. */
export type D1Binding = Parameters<typeof drizzle>[0]

/** The application's D1 database, as drizzle over the Worker's binding: one per runtime, given to every module's
 * service through its layer. */
export class Database extends Context.Service<Database, ReturnType<typeof drizzle>>()('@styld/server/kernel/Database') {
  static readonly layer = (binding: D1Binding) => Layer.sync(this, () => drizzle(binding))
}
