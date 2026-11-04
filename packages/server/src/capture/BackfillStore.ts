import { piecePictures, pieces } from '@styld/db'
import { and, desc, eq, inArray, isNotNull, isNull, lt, ne } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { Array, Effect } from 'effect'
import { type Database as Db, query } from '../kernel/Db.ts'

type Database = Db['Service']
type NewPicture = typeof piecePictures.$inferInsert

/** One statement for each item, sent fifty to a batch; the pieces the statements returned. */
const batchedPieces = <A>(
  db: Database,
  items: ReadonlyArray<A>,
  statement: (item: A) => BatchItem<'sqlite'> & PromiseLike<ReadonlyArray<{ readonly pieceId: string }>>,
) =>
  Effect.map(
    Effect.forEach(Array.chunksOf(items, 50), (chunk) =>
      query(() => {
        const [head, ...rest] = Array.map(chunk, statement)
        return db.batch([head, ...rest])
      }),
    ),
    (results) => results.flat(2).map(({ pieceId }) => pieceId),
  )

/** The drawings a changed prompt draws again: shown, dropped by the check, or failed. A retake and a piece kept as its
 * photo were the judge's call on the cut-out, not the prompt's, and stay; a picture on its way is left to its job. */
const redrawable = ['ready', 'proposed', 'rejected', 'failed'] as const

/** Drawings made before a prompt changed, queued again (owner, 4 November: the pressed prompt). */
const redrawRows = (db: Database) => ({
  /** The account's ready pieces whose drawing ended before `before`, newest piece first. */
  staleDrawings: (accountId: string, before: Date) =>
    query(() =>
      db
        .select({ pieceId: piecePictures.pieceId })
        .from(piecePictures)
        .innerJoin(pieces, eq(pieces.id, piecePictures.pieceId))
        .where(
          and(
            eq(piecePictures.accountId, accountId),
            eq(pieces.status, 'ready'),
            inArray(piecePictures.state, [...redrawable]),
            lt(piecePictures.updatedAt, before),
          ),
        )
        .orderBy(desc(pieces.createdAt)),
    ).pipe(Effect.map((rows) => rows.map(({ pieceId }) => pieceId))),
  /** Queue these drawings again at their turn, paid by Styld, each only while it still ended before `before`, so a
   * picture moved meanwhile keeps its own way; the pieces queued. Until the new drawing passes its check the piece shows
   * its cut-out, so a run queues only a minute's worth (`Backfill.ts`). */
  requeueDrawings: (pictures: ReadonlyArray<{ readonly pieceId: string; readonly turn: Date }>, before: Date) =>
    batchedPieces(db, pictures, ({ pieceId, turn }) =>
      db
        .update(piecePictures)
        .set({ state: 'queued', paid: false, claimedAt: null, updatedAt: turn })
        .where(
          and(
            eq(piecePictures.pieceId, pieceId),
            inArray(piecePictures.state, [...redrawable]),
            lt(piecePictures.updatedAt, before),
          ),
        )
        .returning({ pieceId: piecePictures.pieceId }),
    ),
})

/** The operator's backfill of clean pictures (`Backfill.ts`): which of an account's pieces have none, adding theirs,
 * the drawings proposed before 4 November, and drawings made before a prompt changed, queued again. */
export const backfillRows = (db: Database) => ({
  /** The account's ready pieces shown as a cut-out that have no clean picture, newest first. A photo never leaves
   * Styld, so a piece kept as its photo is not among them. */
  undrawnPieces: (accountId: string) =>
    query(() =>
      db
        .select({ id: pieces.id })
        .from(pieces)
        .leftJoin(piecePictures, eq(piecePictures.pieceId, pieces.id))
        .where(
          and(
            eq(pieces.accountId, accountId),
            eq(pieces.status, 'ready'),
            isNotNull(pieces.imageKey),
            ne(pieces.imageKey, pieces.originalKey),
            isNull(piecePictures.pieceId),
          ),
        )
        .orderBy(desc(pieces.createdAt)),
    ).pipe(Effect.map((rows) => rows.map(({ id }) => id))),
  /** Pictures for pieces that have none, one statement each; the pieces whose picture was added (a piece given one
   * meanwhile keeps its own). */
  addPictures: (pictures: ReadonlyArray<NewPicture>) =>
    batchedPieces(db, pictures, (picture) =>
      db.insert(piecePictures).values(picture).onConflictDoNothing().returning({ pieceId: piecePictures.pieceId }),
    ),
  /** The account's pictures still waiting for the queue since before `until`: their message may have been lost. */
  overduePictures: (accountId: string, until: Date) =>
    query(() =>
      db
        .select({ pieceId: piecePictures.pieceId })
        .from(piecePictures)
        .where(
          and(
            eq(piecePictures.accountId, accountId),
            eq(piecePictures.state, 'queued'),
            lt(piecePictures.updatedAt, until),
          ),
        ),
    ).pipe(Effect.map((rows) => rows.map(({ pieceId }) => pieceId))),
  /** Show the account's drawings proposed before 4 November, which passed the reject bar (`Policy.ts`); the pieces
   * whose drawing moved. */
  showProposed: (accountId: string, at: Date) =>
    query(() =>
      db
        .update(piecePictures)
        .set({ state: 'ready', updatedAt: at })
        .where(and(eq(piecePictures.accountId, accountId), eq(piecePictures.state, 'proposed')))
        .returning({ pieceId: piecePictures.pieceId }),
    ).pipe(Effect.map((rows) => rows.map(({ pieceId }) => pieceId))),
  ...redrawRows(db),
})
