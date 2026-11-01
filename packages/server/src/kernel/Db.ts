import { Array, DateTime, Effect, Option, Schema } from 'effect'

// What every store shares: how a D1 call fails, the first row of a result, id lists cut to D1's parameter limit and the
// time a row is written at. One copy here; each module's Store builds its queries on these.

/** D1 did not answer; the request may be retried. */
export class StoreUnavailable extends Schema.TaggedError<StoreUnavailable>()('StoreUnavailable', {}) {}

/** A D1 call: its rejection is the store being unavailable. */
export const query = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => StoreUnavailable.make({}) })

/** The first row of a result, if any. */
export const first = <A>(rows: ReadonlyArray<A>) => Option.fromNullishOr(rows[0])

/** D1 binds at most 100 parameters to a statement, so id lists go in chunks. */
export const chunked = (ids: ReadonlyArray<string>) => Array.chunksOf(ids, 90).map((chunk) => [...chunk])

/** Now, as the Date a row stores. */
export const nowDate = Effect.map(DateTime.now, DateTime.toDateUtc)
