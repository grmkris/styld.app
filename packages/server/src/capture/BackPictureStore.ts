import { detections, pieceBackPictures, pieces } from '@styld/db'
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { Effect } from 'effect'
import { anyOf } from '../kernel/Conditional.ts'
import { type Database as Db, first, query } from '../kernel/Db.ts'

type Database = Db['Service']

/** A piece's back picture row (`piece_back_pictures`). */
export type BackPictureRow = typeof pieceBackPictures.$inferSelect
type BackPictureState = BackPictureRow['state']

/** Pieces' back pictures (owner, 4 November 2026): drawn only from a back the person photographed. Only the back picture
 * job and a back being set or removed write them, and the job moves one on only from a state it was read in. */
export const backPictureRows = (db: Database) => ({
  findBackPicture: (pieceId: string) =>
    query(() => db.select().from(pieceBackPictures).where(eq(pieceBackPictures.pieceId, pieceId)).limit(1)).pipe(
      Effect.map(first),
    ),
  /** The back pictures of these pieces. */
  backPicturesOf: (pieceIds: ReadonlyArray<string>) =>
    pieceIds.length === 0
      ? Effect.succeed([])
      : query(() =>
          db
            .select()
            .from(pieceBackPictures)
            .where(inArray(pieceBackPictures.pieceId, [...pieceIds])),
        ),
  /** Move a back picture on from one of `from`, with `changes`; whether it moved. */
  moveBackPicture: (pieceId: string, from: ReadonlyArray<BackPictureState>, changes: Partial<BackPictureRow>) =>
    query(() =>
      db
        .update(pieceBackPictures)
        .set(changes)
        .where(and(eq(pieceBackPictures.pieceId, pieceId), inArray(pieceBackPictures.state, [...from])))
        .returning({ pieceId: pieceBackPictures.pieceId }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** A back picture to draw from the piece's back `sourceKey`: added, or queued again when the back changed (a drawing
   * on its way of the old back then fails its next move and is dropped). Whether one waits to be drawn. */
  queueBackPicture: (
    row: { readonly pieceId: string; readonly accountId: string; readonly sourceKey: string },
    at: Date,
  ) =>
    query(() =>
      db
        .insert(pieceBackPictures)
        .values({ ...row, state: 'queued', version: 0, createdAt: at, updatedAt: at })
        .onConflictDoUpdate({
          target: pieceBackPictures.pieceId,
          set: { state: 'queued', sourceKey: row.sourceKey, claimedAt: null, updatedAt: at },
          setWhere: anyOf(ne(pieceBackPictures.sourceKey, row.sourceKey), eq(pieceBackPictures.state, 'queued')),
        })
        .returning({ pieceId: pieceBackPictures.pieceId }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** The account's pieces kept from a capture's detections that have a back: a camera back shot that finished after
   * its front was kept gave them theirs. */
  backedPiecesOf: (accountId: string, captureId: string) =>
    query(() =>
      db
        .select({ id: pieces.id })
        .from(pieces)
        .innerJoin(detections, eq(detections.id, pieces.detectionId))
        .where(
          and(eq(pieces.accountId, accountId), eq(detections.captureId, captureId), isNotNull(pieces.backImageKey)),
        ),
    ).pipe(Effect.map((rows) => rows.map(({ id }) => id))),
  /** Forget a piece's back picture when its back is removed; the drawing it had, to delete. */
  dropBackPicture: (pieceId: string) =>
    query(() =>
      db
        .delete(pieceBackPictures)
        .where(eq(pieceBackPictures.pieceId, pieceId))
        .returning({ cleanKey: pieceBackPictures.cleanKey }),
    ).pipe(Effect.map((rows) => rows.flatMap(({ cleanKey }) => (cleanKey === null ? [] : [cleanKey])))),
})
