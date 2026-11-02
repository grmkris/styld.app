import { captures, outfitPhotos, piecePictures, pieces, pieceTurns } from '@styld/db'
import { and, asc, eq, inArray, lt, or } from 'drizzle-orm'
import { Cause, DateTime, Duration, Effect } from 'effect'
import { Database, query } from '../kernel/Db.ts'

// What the cron does every ten minutes: every sweep runs on its own, so one that fails never skips the rest. A sweep
// finds rows stuck in a state no delivery will move them out of, oldest first and a batch at a time over an index, and
// hands each to the module that owns it, which ends it as its own job would have given it up (its credits back).

/** One sweep: what it is called, and its run over the application's services (`R`), answering how many rows it
 * moved. */
export interface Sweep<R = never> {
  readonly name: string
  readonly run: Effect.Effect<number, unknown, R>
}

/** Run every sweep at once, each isolated: a failure is logged, and the others carry on. */
export const runSweeps = Effect.fn('Styld.Sweeps.run')(function* (sweeps: ReadonlyArray<Sweep>) {
  yield* Effect.forEach(
    sweeps,
    ({ name, run }) =>
      run.pipe(
        Effect.tap((count) =>
          Effect.logInfo('Styld.Sweep').pipe(Effect.annotateLogs({ 'styld.sweep': name, 'styld.sweep.count': count })),
        ),
        Effect.withSpan(`Styld.Sweep.${name}`),
        Effect.catchCause((cause) =>
          Effect.logWarning('Styld.Sweep failed').pipe(
            Effect.annotateLogs({ 'styld.sweep': name, 'styld.sweep.cause': Cause.pretty(cause) }),
          ),
        ),
      ),
    { concurrency: 'unbounded', discard: true },
  )
})

/** The most rows one sweep moves.
 * @internal Exported for its tests. */
export const sweepBatch = 50

/** How long a row may sit in a working state before nothing will move it: every queue gives a job up well within
 * this (three or four deliveries, seconds apart), and the slowest provider work (a turn, 15 minutes) too. */
const stuckAfter = Duration.minutes(30)

/** A turn's video waits this long for the owner's browser to cut it into frames. */
export const unbuiltAfter = Duration.hours(2)

/** The moment `patience` ago. */
export const before = (patience: Duration.Duration) =>
  Effect.map(DateTime.now, (now) => DateTime.toDateUtc(DateTime.subtractDuration(now, patience)))

/** Hand each stuck row to its owner; one that cannot be moved now is logged and left for the next sweep. */
const sweepEach = <A, R>(rows: ReadonlyArray<A>, move: (row: A) => Effect.Effect<unknown, unknown, R>) =>
  Effect.as(
    Effect.forEach(rows, (row) => move(row).pipe(Effect.ignore({ log: true, message: 'Styld.Sweep left a row' })), {
      discard: true,
    }),
    rows.length,
  )

const ids = (rows: ReadonlyArray<{ readonly id: string }>) => rows.map(({ id }) => id)

/** The rows stuck in a working state since before a moment, oldest first: read here, moved by their owners.
 * @internal Exported for its tests. */
export const stuckRows = (db: Database['Service']) => ({
  pieces: (until: Date) =>
    query(() =>
      db
        .select({ id: pieces.id })
        .from(pieces)
        .where(and(inArray(pieces.status, ['processing']), lt(pieces.updatedAt, until)))
        .orderBy(asc(pieces.updatedAt))
        .limit(sweepBatch),
    ).pipe(Effect.map(ids)),
  captures: (until: Date) =>
    query(() =>
      db
        .select({ id: captures.id })
        .from(captures)
        .where(and(inArray(captures.status, ['processing']), lt(captures.updatedAt, until)))
        .orderBy(asc(captures.updatedAt))
        .limit(sweepBatch),
    ).pipe(Effect.map(ids)),
  pictures: (until: Date) =>
    query(() =>
      db
        .select({ id: piecePictures.pieceId })
        .from(piecePictures)
        .where(
          and(inArray(piecePictures.state, ['queued', 'generating', 'checking']), lt(piecePictures.updatedAt, until)),
        )
        .orderBy(asc(piecePictures.updatedAt))
        .limit(sweepBatch),
    ).pipe(Effect.map(ids)),
  /** Turns stuck on their way, and videos the owner's browser never cut into frames. */
  turns: (until: Date, unbuilt: Date) =>
    query(() =>
      db
        .select({ id: pieceTurns.pieceId })
        .from(pieceTurns)
        .where(
          or(
            and(inArray(pieceTurns.state, ['requested', 'anchoring', 'generating']), lt(pieceTurns.updatedAt, until)),
            and(eq(pieceTurns.state, 'video-ready'), lt(pieceTurns.updatedAt, unbuilt)),
          ),
        )
        .orderBy(asc(pieceTurns.updatedAt))
        .limit(sweepBatch),
    ).pipe(Effect.map(ids)),
  photos: (until: Date) =>
    query(() =>
      db
        .select({ id: outfitPhotos.id })
        .from(outfitPhotos)
        .where(and(inArray(outfitPhotos.status, ['finding']), lt(outfitPhotos.updatedAt, until)))
        .orderBy(asc(outfitPhotos.updatedAt))
        .limit(sweepBatch),
    ).pipe(Effect.map(ids)),
})

/** Where stuck rows are read from. */
export type StuckRows = ReturnType<typeof stuckRows>

/** A sweep of rows stuck since `stuckAfter`, each moved by the module that owns it. */
export const moving = <R>(
  name: string,
  find: (stuck: StuckRows, until: Date) => Effect.Effect<ReadonlyArray<string>, unknown>,
  move: (id: string) => Effect.Effect<unknown, unknown, R>,
): Sweep<Database | R> => ({
  name,
  run: Effect.gen(function* () {
    const found = yield* find(stuckRows(yield* Database), yield* before(stuckAfter))
    return yield* sweepEach(found, move)
  }),
})
