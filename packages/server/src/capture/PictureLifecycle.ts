import { pieceBackPictures, piecePictures } from '@styld/db'
import { and, eq, inArray, ne, type SQL } from 'drizzle-orm'
import { Effect } from 'effect'
import { anyOf } from '../kernel/Conditional.ts'
import { type Database as Db, query } from '../kernel/Db.ts'
import { allowed, lifecycle } from '../kernel/Lifecycle.ts'

// The drawing lifecycle of either side of a piece (`piece_pictures`, `piece_back_pictures`), and the one writer of its
// state: every move goes from the state the row was read in, along `pictureLifecycle`. A drawing is queued, claimed
// (`generating`) and ends shown (`ready`), sent for a retake, kept as its photo or failed; `proposed` is a drawing that
// waited for its owner's tap until 4 November and shows like a ready one. Any ended drawing may be queued again (a
// redraw, the operator's backfill), and a redraw whose credit could not be held is taken back to where it was.

type Database = Db['Service']
type PictureRow = typeof piecePictures.$inferSelect
type BackPictureRow = typeof pieceBackPictures.$inferSelect
export type PictureState = PictureRow['state']

/** What a move writes besides the state. */
type Changes<Row> = Partial<Omit<Row, 'pieceId' | 'accountId' | 'state'>>
export type PictureChanges = Changes<PictureRow>
export type BackPictureChanges = Changes<BackPictureRow>

export const pictureLifecycle = lifecycle<PictureState>('piece picture', {
  // Claimed, or kept as the photo, sent for a retake or given up before a claim; a redraw taken back returns to the
  // state it was claimed from.
  queued: ['generating', 'kept-real', 'retake', 'failed', 'ready', 'proposed'],
  // Drawn, failed, or handed back to the queue while the image model is busy.
  generating: ['ready', 'failed', 'queued'],
  ready: ['queued'],
  // The operator's backfill shows every drawing proposed before 4 November.
  proposed: ['ready', 'queued'],
  retake: ['queued'],
  'kept-real': ['queued'],
  failed: ['queued'],
})

/** The state a picture is added in. */
export const firstPictureState = 'queued' as const satisfies PictureState

/** A piece's first picture, queued to be drawn free; `turn` is when it was last moved, `at` unless a run spreads its
 * pictures (`Backfill.ts`). */
export const firstPicture = (
  picture: Pick<PictureRow, 'pieceId' | 'accountId'>,
  at: Date,
  turn: Date = at,
): typeof piecePictures.$inferInsert => ({
  ...picture,
  state: firstPictureState,
  version: 0,
  redraws: 0,
  paid: false,
  createdAt: at,
  updatedAt: turn,
})

const ends = ['ready', 'proposed', 'retake', 'kept-real', 'failed'] as const satisfies ReadonlyArray<PictureState>

/** Whether a drawing has ended: shown, offered, sent for a retake, kept as its photo or failed. Only a new drawing
 * moves it on. */
export const hasEnded = (state: PictureState): state is (typeof ends)[number] => ends.some((end) => end === state)

/** The states a drawing is shown in: ready, or proposed (shown like any other since 4 November). */
export const drawnStates = ['ready', 'proposed'] as const satisfies ReadonlyArray<PictureState>

/** The drawings an operator's run draws again (`BackfillStore.ts`). `every`, after a changed prompt: shown or failed.
 * `ended` only those that failed (owner, 4 November). A retake and a piece kept as its photo were the judge's call on
 * the cut-out, not the prompt's, and stay; a picture on its way is left to its job. */
export const redrawable = {
  every: ['ready', 'proposed', 'failed'],
  ended: ['failed'],
} as const satisfies Record<string, ReadonlyArray<PictureState>>

/** A front picture moved from one of `from` to `to` within `scope`, as a statement for a batch; it returns the pieces
 * it moved. The caller's moves are on the table (`PictureLifecycle.test.ts`). */
export const pictureMove = (
  db: Database,
  scope: SQL | undefined,
  from: ReadonlyArray<PictureState>,
  to: PictureState,
  changes: PictureChanges,
) =>
  db
    .update(piecePictures)
    .set({ ...changes, state: to })
    .where(and(scope, inArray(piecePictures.state, [...from])))
    .returning({ pieceId: piecePictures.pieceId })

const moved = (rows: ReadonlyArray<unknown>) => rows.length > 0

/** Move a piece's front picture from one of `from` to `to`, with `changes`; whether it moved. */
export const advancePicture = (
  db: Database,
  pieceId: string,
  from: ReadonlyArray<PictureState>,
  to: PictureState,
  changes: PictureChanges,
) =>
  Effect.andThen(
    allowed(pictureLifecycle, from, to),
    query(() => pictureMove(db, eq(piecePictures.pieceId, pieceId), from, to, changes)),
  ).pipe(Effect.map(moved))

/** Claim a front picture's next paid redraw, or take back one claimed: move it only from the state and the redraw it
 * was read in, so of two requests reading the same picture one owns the redraw and its hold; whether it moved. */
export const claimPicture = (
  db: Database,
  pieceId: string,
  seen: Pick<PictureRow, 'state' | 'redraws'>,
  to: PictureState,
  changes: PictureChanges,
) =>
  Effect.andThen(
    allowed(pictureLifecycle, [seen.state], to),
    query(() =>
      pictureMove(
        db,
        and(eq(piecePictures.pieceId, pieceId), eq(piecePictures.redraws, seen.redraws)),
        [seen.state],
        to,
        changes,
      ),
    ),
  ).pipe(Effect.map(moved))

/** Show every drawing of the account's proposed before 4 November; the pieces whose drawing moved. */
export const showProposed = (db: Database, accountId: string, at: Date) =>
  Effect.andThen(
    allowed(pictureLifecycle, ['proposed'], 'ready'),
    query(() => pictureMove(db, eq(piecePictures.accountId, accountId), ['proposed'], 'ready', { updatedAt: at })),
  ).pipe(Effect.map((rows) => rows.map(({ pieceId }) => pieceId)))

/** Move a piece's back picture from one of `from` to `to`, with `changes`; whether it moved. */
export const advanceBackPicture = (
  db: Database,
  pieceId: string,
  from: ReadonlyArray<PictureState>,
  to: PictureState,
  changes: BackPictureChanges,
) =>
  Effect.andThen(
    allowed(pictureLifecycle, from, to),
    query(() =>
      db
        .update(pieceBackPictures)
        .set({ ...changes, state: to })
        .where(and(eq(pieceBackPictures.pieceId, pieceId), inArray(pieceBackPictures.state, [...from])))
        .returning({ pieceId: pieceBackPictures.pieceId }),
    ),
  ).pipe(Effect.map(moved))

/** A back picture to draw from the piece's back `sourceKey`: added, or queued again from whatever state it is in when
 * the back changed (a drawing on its way of the old back then fails its next move and is dropped). The one move not
 * read first: a new back starts the drawing over. Whether one waits to be drawn. */
export const queueBackPicture = (
  db: Database,
  row: { readonly pieceId: string; readonly accountId: string; readonly sourceKey: string },
  at: Date,
) =>
  query(() =>
    db
      .insert(pieceBackPictures)
      .values({ ...row, state: firstPictureState, version: 0, createdAt: at, updatedAt: at })
      .onConflictDoUpdate({
        target: pieceBackPictures.pieceId,
        set: { state: firstPictureState, sourceKey: row.sourceKey, claimedAt: null, updatedAt: at },
        setWhere: anyOf(ne(pieceBackPictures.sourceKey, row.sourceKey), eq(pieceBackPictures.state, firstPictureState)),
      })
      .returning({ pieceId: pieceBackPictures.pieceId }),
  ).pipe(Effect.map(moved))
