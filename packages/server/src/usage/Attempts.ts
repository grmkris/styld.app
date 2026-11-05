import { paidAttempts } from '@styld/db'
import { type LimitReached, Unavailable } from '@styld/protocol'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { Context, Duration, Effect, Exit, Layer, Option, Predicate, Schema } from 'effect'
import { Database, first, nowDate, query, stored } from '../kernel/Db.ts'
import { outcomeUnknown, type ProviderError } from '../providers/Errors.ts'
import { type Ending, failedEnding, HoldId, Holds } from './Holds.ts'

// Paid provider work a queue may deliver more than once (a redelivery, a replayed request sending the job again) runs
// once: one delivery claims it (a conditional D1 write), runs it and stores its result; a delivery that finds the
// result resumes from it, one that finds a live claim leaves the work to it, and one that finds a claim whose delivery
// died without a result reports the provider's outcome as unknown, which refunds and is never sent again (owner,
// 2026-11-01). A claim is released when the work fails before the provider could have taken it, so the queue tries
// again as a new attempt.

/** A queue consumer runs for 15 minutes at most: a claim older than that belongs to a delivery that died. */
const lease = Duration.minutes(15)

/** Another delivery holds the work's claim and is still within its lease: the work is left to it. */
export class AttemptElsewhere extends Schema.TaggedError<AttemptElsewhere>()('AttemptElsewhere', {}) {}

/** One piece of paid work. */
export interface Work<A> {
  /** What the work is, as its kind and entity (`piece/<id>`); one claim at a time per key. */
  readonly key: string
  readonly accountId: string
  /** The provider an attempt lost with its delivery is reported as. */
  readonly provider: string
  /** What the work answers, stored as JSON. */
  readonly result: Schema.Codec<A, unknown>
}

/** Work that holds the account's credits for each attempt, settled once its result is stored. */
export interface PerAttempt<A> {
  readonly hold: (attempt: number) => HoldId
  readonly credits: number
  /** Whether a result is paid for: work that answered but made nothing is refunded. */
  readonly paidFor: (result: A) => boolean
}

/** The attempts' statements over the application's database. */
const attemptRows = (db: Database['Service']) => ({
  /** Claim the work as its next attempt, unless a claim is held or its result stored; the attempt claimed. */
  claim: (key: string, accountId: string, at: Date) =>
    query(() =>
      db
        .insert(paidAttempts)
        .values({ work: key, accountId, attempt: 1, holdId: null, claimedAt: at, result: null, updatedAt: at })
        .onConflictDoUpdate({
          target: paidAttempts.work,
          set: { attempt: sql`${paidAttempts.attempt} + 1`, holdId: null, claimedAt: at, updatedAt: at },
          // Taken again only once released, and never once its result is stored.
          setWhere: and(isNull(paidAttempts.claimedAt), isNull(paidAttempts.result)) ?? isNull(paidAttempts.result),
        })
        .returning({ attempt: paidAttempts.attempt }),
    ).pipe(Effect.map((rows) => Option.map(first(rows), ({ attempt }) => attempt))),
  find: (key: string) =>
    query(() => db.select().from(paidAttempts).where(eq(paidAttempts.work, key)).limit(1)).pipe(Effect.map(first)),
  /** The hold the claimed attempt is paid by. */
  paidBy: (key: string, attempt: number, hold: HoldId) =>
    query(() =>
      db
        .update(paidAttempts)
        .set({ holdId: hold })
        .where(and(eq(paidAttempts.work, key), eq(paidAttempts.attempt, attempt))),
    ),
  /** Store the attempt's result, while its claim stands; whether it was stored. */
  store: (key: string, attempt: number, result: string, at: Date) =>
    query(() =>
      db
        .update(paidAttempts)
        .set({ result, updatedAt: at })
        .where(and(eq(paidAttempts.work, key), eq(paidAttempts.attempt, attempt), isNull(paidAttempts.result)))
        .returning({ work: paidAttempts.work }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Let the work be claimed again as a new attempt. */
  release: (key: string, attempt: number, at: Date) =>
    query(() =>
      db
        .update(paidAttempts)
        .set({ claimedAt: null, updatedAt: at })
        .where(and(eq(paidAttempts.work, key), eq(paidAttempts.attempt, attempt), isNull(paidAttempts.result))),
    ),
  forget: (key: string) => query(() => db.delete(paidAttempts).where(eq(paidAttempts.work, key))),
})

/** The JSON a result is stored as. A stored result that no longer decodes is a broken invariant. */
const resultJson = <A>(work: Work<A>) => Schema.fromJsonString(Schema.toCodecJson(work.result))

/** What claiming found: the attempt now held, or the result an attempt stored and the hold that paid for it. */
type Begun<A> =
  | { readonly _tag: 'Claimed'; readonly attempt: number }
  | { readonly _tag: 'Stored'; readonly result: A; readonly hold: Option.Option<HoldId> }

/** The steps every run takes over the attempts' rows: claim, resume, store, release. */
const steps = (rows: ReturnType<typeof attemptRows>, holds: Holds['Service']) => {
  /** The work as another attempt left it: its stored result, a live claim to leave it to, or a claim whose
   * delivery died after the provider may have taken the work, never sent again and refunded. */
  const leftBy = Effect.fnUntraced(function* <A>(work: Work<A>, at: Date) {
    const found = yield* rows.find(work.key).pipe(stored)
    if (Option.isNone(found)) return yield* Unavailable.make({})
    const { result, claimedAt, holdId } = found.value
    const hold = Option.map(Option.fromNullishOr(holdId), (id) => HoldId.make(id))
    if (result !== null) {
      const decoded = yield* Schema.decodeUnknownEffect(resultJson(work))(result).pipe(Effect.orDie)
      return { _tag: 'Stored', result: decoded, hold } satisfies Begun<A>
    }
    // Released between the claim and this read: free again, so the caller tries again rather than leaving it.
    if (claimedAt === null) return yield* Unavailable.make({})
    if (at.getTime() - claimedAt.getTime() < Duration.toMillis(lease)) return yield* AttemptElsewhere.make({})
    if (Option.isSome(hold)) yield* holds.settle(work.accountId, hold.value, 'unknown')
    return yield* outcomeUnknown(work.provider)
  })
  const begin = Effect.fnUntraced(function* <A>(work: Work<A>) {
    const at = yield* nowDate
    const claimed = yield* rows.claim(work.key, work.accountId, at).pipe(stored)
    if (Option.isSome(claimed)) return { _tag: 'Claimed', attempt: claimed.value } satisfies Begun<A>
    return yield* leftBy(work, at)
  })
  const release = (key: string, attempt: number) =>
    Effect.ignore(Effect.flatMap(nowDate, (at) => rows.release(key, attempt, at)))
  /** Keep the attempt's result; whether it was kept. */
  const store = <A>(work: Work<A>, attempt: number, value: A) =>
    Effect.gen(function* () {
      const text = yield* Schema.encodeEffect(resultJson(work))(value).pipe(Effect.orDie)
      return yield* rows.store(work.key, attempt, text, yield* nowDate)
    }).pipe(Effect.orElseSucceed(() => false))
  /** Run the claimed attempt; one that failed before the provider could have taken the work is released. */
  const attempted = <A, E, R>(work: Work<A>, attempt: number, effect: Effect.Effect<A, E, R>) =>
    Effect.tap(Effect.exit(effect), (exit) =>
      Exit.isFailure(exit) && failedEnding(exit.cause) !== 'unknown' ? release(work.key, attempt) : Effect.void,
    )
  return { begin, release, store, attempted }
}

/** Paid provider work run once however often it is delivered (see above). */
export class PaidAttempts extends Context.Service<
  PaidAttempts,
  {
    /** Run the work once, or answer its stored result; it holds nothing of the account's (or holds it elsewhere). */
    readonly run: <A, E, R>(
      work: Work<A>,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | AttemptElsewhere | ProviderError | Unavailable, R>
    /** Run the work once for the account's credits, held per attempt and settled once its result is stored: consumed
     * for a result paid for, refunded for anything else. */
    readonly charged: <A, E, R>(
      work: Work<A>,
      paid: PerAttempt<A>,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | AttemptElsewhere | ProviderError | LimitReached | Unavailable, R>
    /** The work was given up: a hold its last attempt keeps without a stored result is refunded. */
    readonly abandon: (key: string, accountId: string) => Effect.Effect<void, Unavailable>
    /** Forget the work's attempts once its result is kept where it belongs. */
    readonly forget: (key: string) => Effect.Effect<void, Unavailable>
  }
>()('@styld/server/usage/PaidAttempts') {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const rows = attemptRows(yield* Database)
      const holds = yield* Holds
      const { begin, release, store, attempted } = steps(rows, holds)
      return PaidAttempts.of({
        run: Effect.fn('Styld.PaidAttempts.run')(function* <A, E, R>(work: Work<A>, effect: Effect.Effect<A, E, R>) {
          yield* Effect.annotateCurrentSpan('styld.work', work.key)
          const begun = yield* begin(work)
          if (Predicate.isTagged(begun, 'Stored')) return begun.result
          const exit = yield* attempted(work, begun.attempt, effect)
          if (Exit.isSuccess(exit)) yield* store(work, begun.attempt, exit.value)
          return yield* exit
        }),
        charged: Effect.fn('Styld.PaidAttempts.charged')(function* <A, E, R>(
          work: Work<A>,
          paid: PerAttempt<A>,
          effect: Effect.Effect<A, E, R>,
        ) {
          yield* Effect.annotateCurrentSpan('styld.work', work.key)
          const { accountId } = work
          const begun = yield* begin(work)
          const endingFor = (value: A): Ending => (paid.paidFor(value) ? 'succeeded' : 'failed')
          if (Predicate.isTagged(begun, 'Stored')) {
            // Resumed from its stored result: its settlement may have been lost, and the first one stands.
            if (Option.isSome(begun.hold)) yield* holds.settle(accountId, begun.hold.value, endingFor(begun.result))
            return begun.result
          }
          const hold = paid.hold(begun.attempt)
          yield* rows.paidBy(work.key, begun.attempt, hold).pipe(
            stored,
            Effect.andThen(holds.reserve({ accountId, hold, credits: paid.credits })),
            Effect.tapError(() => release(work.key, begun.attempt)),
          )
          const exit = yield* attempted(work, begun.attempt, effect)
          // Paid for only once its result is kept: one a retry could not find again is refunded.
          const kept = Exit.isSuccess(exit) && (yield* store(work, begun.attempt, exit.value))
          const ending = Exit.isSuccess(exit) ? (kept ? endingFor(exit.value) : 'unknown') : failedEnding(exit.cause)
          yield* holds
            .settle(accountId, hold, ending)
            .pipe(Effect.ignore({ log: true, message: 'Styld.PaidAttempts left a settlement to the sweep' }))
          return yield* exit
        }),
        abandon: Effect.fn('Styld.PaidAttempts.abandon')(function* (key: string, accountId: string) {
          const found = yield* rows.find(key).pipe(stored)
          if (Option.isNone(found) || found.value.result !== null || found.value.holdId === null) return
          yield* holds.settle(accountId, HoldId.make(found.value.holdId), 'failed')
        }),
        forget: (key) => rows.forget(key).pipe(Effect.asVoid, stored),
      })
    }),
  )
}
