import { captures } from '@styld/db'
import { and, eq, inArray, type SQL } from 'drizzle-orm'
import { Effect, Option } from 'effect'
import { type Database as Db, query } from '../kernel/Db.ts'
import { allowed, lifecycle } from '../kernel/Lifecycle.ts'
import type { Ending } from '../usage/Holds.ts'

// A capture's lifecycle (`captures.status`), and the one writer of it: every move goes from the state the capture was
// read in, along `captureLifecycle`. An upload is processed into the review tray, or fails, or its provider's answer is
// lost (`unknown`); the person may try a failed, lost or stuck one again (`processing` once more, as its next attempt),
// and a capture leaves the tray `done` once nothing in it waits. A garment offered from an outfit photo starts in the
// tray.

type Database = Db['Service']
type CaptureRow = typeof captures.$inferSelect
export type CaptureState = CaptureRow['status']

/** What a move writes besides the status. */
export type CaptureChanges = Partial<Omit<CaptureRow, 'id' | 'accountId' | 'status'>>

export const captureLifecycle = lifecycle<CaptureState>('capture', {
  // Found its garments, failed, or lost its answer; a stuck one is tried again as its next attempt, and a retry whose
  // credits could not be held goes back to the state it was claimed from.
  processing: ['review', 'failed', 'unknown', 'processing'],
  review: ['done'],
  failed: ['processing'],
  unknown: ['processing'],
  done: [],
})

/** The state a capture of the person's own upload is created in. */
export const uploadedCaptureState = 'processing' as const satisfies CaptureState
/** The state a garment offered from an outfit photo is created in: in the tray at once. */
export const offeredCaptureState = 'review' as const satisfies CaptureState

/** How a capture's status ended its hold, once it ended: in the tray or done it succeeded. A capture still
 * processing has not ended. */
export const endingOf = (status: CaptureState): Option.Option<Ending> => {
  switch (status) {
    case 'review':
    case 'done':
      return Option.some('succeeded')
    case 'failed':
      return Option.some('failed')
    case 'unknown':
      return Option.some('unknown')
    case 'processing':
      return Option.none()
  }
}

/** Captures moved from one of `from` to `to` within `scope`, as a statement; it returns the captures it moved. */
const captureMove = (
  db: Database,
  scope: SQL | undefined,
  from: ReadonlyArray<CaptureState>,
  to: CaptureState,
  changes: CaptureChanges,
) =>
  db
    .update(captures)
    .set({ ...changes, status: to })
    .where(and(scope, inArray(captures.status, [...from])))
    .returning({ id: captures.id })

/** Move the account's capture from the state, attempt and moment it was read in to `to`, with `changes`; whether it
 * moved. Of two requests or deliveries that read it alike, one moves it. */
export const advanceCapture = (
  db: Database,
  capture: Pick<CaptureRow, 'id' | 'accountId'>,
  seen: Pick<CaptureRow, 'status' | 'attempt' | 'updatedAt'>,
  to: CaptureState,
  changes: CaptureChanges,
) =>
  Effect.andThen(
    allowed(captureLifecycle, [seen.status], to),
    query(() =>
      captureMove(
        db,
        and(
          eq(captures.id, capture.id),
          eq(captures.accountId, capture.accountId),
          eq(captures.attempt, seen.attempt),
          eq(captures.updatedAt, seen.updatedAt),
        ),
        [seen.status],
        to,
        changes,
      ),
    ),
  ).pipe(Effect.map((rows) => rows.length > 0))

/** The moves written inside another statement's batch, each on the table (`CaptureLifecycle.test.ts`). */
export const batchedCaptureMoves = {
  /** A processing attempt found its garments: into the tray. */
  found: { from: ['processing'], to: 'review' },
  /** Nothing in the tray waits any more: a back folded into its front, or every card decided. */
  emptied: { from: ['review'], to: 'done' },
} as const satisfies Record<string, { readonly from: ReadonlyArray<CaptureState>; readonly to: CaptureState }>

/** The capture's current attempt found its garments, as a statement for the batch that stores them; it returns the
 * capture when it moved. */
export const intoTray = (db: Database, capture: Pick<CaptureRow, 'id' | 'attempt'>, changes: CaptureChanges) =>
  captureMove(
    db,
    and(eq(captures.id, capture.id), eq(captures.attempt, capture.attempt)),
    batchedCaptureMoves.found.from,
    batchedCaptureMoves.found.to,
    changes,
  )

/** Captures with nothing left waiting in the tray, out of it, as a statement for a batch. */
export const outOfTray = (db: Database, scope: SQL | undefined, at: Date) =>
  captureMove(db, scope, batchedCaptureMoves.emptied.from, batchedCaptureMoves.emptied.to, { updatedAt: at })
