import { piecePictures, pieces } from '@styld/db'
import { and, desc, eq, isNotNull, isNull, lt, ne } from 'drizzle-orm'
import { Array, Effect } from 'effect'
import { type Database as Db, query } from '../kernel/Db.ts'

type Database = Db['Service']
type NewPicture = typeof piecePictures.$inferInsert

/** The operator's backfill of clean pictures (`Backfill.ts`): which of an account's pieces have none, adding theirs,
 * and the drawings proposed before 4 November. */
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
    Effect.map(
      Effect.forEach(Array.chunksOf(pictures, 50), (chunk) =>
        query(() => {
          const [head, ...rest] = Array.map(chunk, (picture) =>
            db
              .insert(piecePictures)
              .values(picture)
              .onConflictDoNothing()
              .returning({ pieceId: piecePictures.pieceId }),
          )
          return db.batch([head, ...rest])
        }),
      ),
      (results) => results.flat(2).map(({ pieceId }) => pieceId),
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
})
