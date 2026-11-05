import { tryOns } from '@styld/db'
import { and, eq, inArray } from 'drizzle-orm'
import { Effect, Option } from 'effect'
import { type Database as Db, query } from '../kernel/Db.ts'
import { allowed, lifecycle } from '../kernel/Lifecycle.ts'
import type { Ending } from '../usage/Holds.ts'

// A try-on's lifecycle (`try_ons.status`), and the one writer of it: every move goes from the status the try-on was
// read in, along `tryOnLifecycle`. A try-on waits for its credits (`admitting`), is drawn once (`drawing`), and ends
// done, refused by the image model, or failed; an ended try-on never moves again.

type Database = Db['Service']
type TryOnRow = typeof tryOns.$inferSelect
export type TryOnState = TryOnRow['status']

/** What a move writes besides the status. */
export type TryOnChanges = Partial<Omit<TryOnRow, 'id' | 'accountId' | 'status'>>

/** @internal Exported for its tests. */
export const tryOnLifecycle = lifecycle<TryOnState>('try-on', {
  admitting: ['drawing', 'failed'],
  drawing: ['done', 'refused', 'failed'],
  done: [],
  refused: [],
  failed: [],
})

/** The status a try-on is created in. */
export const firstTryOnState = 'admitting' as const satisfies TryOnState

/** The statuses of a try-on not yet ended. */
export const runningTryOn = ['admitting', 'drawing'] as const satisfies ReadonlyArray<TryOnState>

/** How a try-on that ended settles its credits: spent once its result is stored, given back otherwise; a try-on not
 * yet ended has not. */
export const tryOnEnding = (status: TryOnState): Option.Option<Ending> =>
  status === 'done'
    ? Option.some('succeeded')
    : status === 'refused' || status === 'failed'
      ? Option.some('failed')
      : Option.none()

/** Move the try-on from one of `from` to `to`, with `changes`; whether it moved. */
export const advanceTryOn = (
  db: Database,
  tryOnId: string,
  from: ReadonlyArray<TryOnState>,
  to: TryOnState,
  changes: TryOnChanges,
) =>
  Effect.andThen(
    allowed(tryOnLifecycle, from, to),
    query(() =>
      db
        .update(tryOns)
        .set({ ...changes, status: to })
        .where(and(eq(tryOns.id, tryOnId), inArray(tryOns.status, [...from])))
        .returning({ id: tryOns.id }),
    ),
  ).pipe(Effect.map((rows) => rows.length > 0))
