import { accounts, detections, operationReceipts, piecePictures, pieceTurns, pieces, uploads } from '@styld/db'
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Option } from 'effect'
import { receiptRows } from '../kernel/Receipts.ts'
import { chunked, first, query, StoreUnavailable } from '../kernel/Db.ts'

export type PieceRow = typeof pieces.$inferSelect
export type UploadRow = typeof uploads.$inferSelect
export type ReceiptRow = typeof operationReceipts.$inferSelect
export type PictureRow = typeof piecePictures.$inferSelect
export type TurnRow = typeof pieceTurns.$inferSelect

export type PieceChanges = Partial<
  Pick<
    PieceRow,
    | 'name'
    | 'notes'
    | 'type'
    | 'colours'
    | 'season'
    | 'occasions'
    | 'pattern'
    | 'brand'
    | 'shopUrl'
    | 'suggestedAt'
    | 'backImageKey'
    | 'updatedAt'
  >
>

/** Which of these pieces belong to the account. */
export const ownPieceIds = (db: ReturnType<typeof drizzle>, accountId: string, pieceIds: ReadonlyArray<string>) =>
  Effect.map(
    Effect.forEach(chunked(pieceIds), (chunk) =>
      query(() =>
        db
          .select({ id: pieces.id })
          .from(pieces)
          .where(and(eq(pieces.accountId, accountId), inArray(pieces.id, chunk))),
      ),
    ),
    (rows) => new Set(rows.flat().map(({ id }) => id)),
  )

/** The key of an upload the account received and has not used, read inside the statement that records what
 * the upload makes. Once the upload is spent it reads as null, which a NOT NULL column refuses, failing the
 * whole batch: spending the upload and recording what it made are one atomic step. */
export const receivedUploadKey = (db: ReturnType<typeof drizzle>, accountId: string, uploadId: string) =>
  sql<string>`${db
    .select({ key: uploads.objectKey })
    .from(uploads)
    .where(and(eq(uploads.id, uploadId), eq(uploads.accountId, accountId), eq(uploads.status, 'received')))}`

/** Spend an upload, in the batch that records what it made. */
export const spendUpload = (db: ReturnType<typeof drizzle>, uploadId: string) =>
  db.update(uploads).set({ status: 'used' }).where(eq(uploads.id, uploadId))

/** Uploads, and whether their account still takes photos. */
const uploadQueries = (db: ReturnType<typeof drizzle>) => ({
  accountEnabled: (accountId: string) =>
    query(() =>
      db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.enabled, true)))
        .limit(1),
    ).pipe(Effect.map((rows) => rows.length === 1)),
  insertUpload: (row: UploadRow) => query(() => db.insert(uploads).values(row)).pipe(Effect.asVoid),
  findUpload: (uploadId: string) =>
    query(() => db.select().from(uploads).where(eq(uploads.id, uploadId)).limit(1)).pipe(Effect.map(first)),
  /** A pending upload's token, replaced: the first answer with its token was lost. */
  reissueUpload: (uploadId: string, tokenDigest: string) =>
    query(() =>
      db
        .update(uploads)
        .set({ tokenDigest })
        .where(and(eq(uploads.id, uploadId), eq(uploads.status, 'pending'))),
    ).pipe(Effect.asVoid),
  markUploadReceived: (uploadId: string) =>
    query(() =>
      db
        .update(uploads)
        .set({ status: 'received' })
        .where(and(eq(uploads.id, uploadId), eq(uploads.status, 'pending'))),
    ).pipe(Effect.asVoid),
})

/** A photo one capture shared between pieces is deleted only with the last one showing it. */
const sharedPhotoQueries = (db: ReturnType<typeof drizzle>) => ({
  /** Whether another piece, or a piece still waiting in the tray, shows this photo. */
  originalInUse: (accountId: string, key: string, exceptPieceId: string) =>
    Effect.all([
      query(() =>
        db
          .select({ id: pieces.id })
          .from(pieces)
          .where(and(eq(pieces.accountId, accountId), eq(pieces.originalKey, key), ne(pieces.id, exceptPieceId)))
          .limit(1),
      ),
      query(() =>
        db
          .select({ id: detections.id })
          .from(detections)
          .where(
            and(eq(detections.accountId, accountId), eq(detections.sourceKey, key), eq(detections.status, 'review')),
          )
          .limit(1),
      ),
    ]).pipe(Effect.map(([others, waiting]) => others.length > 0 || waiting.length > 0)),
})

/** Pieces' clean pictures as their owner reads and chooses them. The picture job writes everything else. */
const pictureQueries = (db: ReturnType<typeof drizzle>) => ({
  picturesOf: (accountId: string) =>
    query(() => db.select().from(piecePictures).where(eq(piecePictures.accountId, accountId))),
  turnsOf: (accountId: string) => query(() => db.select().from(pieceTurns).where(eq(pieceTurns.accountId, accountId))),
  turnOf: (accountId: string, pieceId: string) =>
    query(() =>
      db
        .select()
        .from(pieceTurns)
        .where(and(eq(pieceTurns.pieceId, pieceId), eq(pieceTurns.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  pictureOf: (accountId: string, pieceId: string) =>
    query(() =>
      db
        .select()
        .from(piecePictures)
        .where(and(eq(piecePictures.pieceId, pieceId), eq(piecePictures.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  /** Show the drawing or the photo; only a drawing that is ready or proposed can be chosen. The picture, if chosen. */
  choosePicture: (accountId: string, pieceId: string, shown: 'clean' | 'photo', at: Date) =>
    query(() =>
      db
        .update(piecePictures)
        .set({ shown, updatedAt: at })
        .where(
          and(
            eq(piecePictures.pieceId, pieceId),
            eq(piecePictures.accountId, accountId),
            inArray(piecePictures.state, ['ready', 'proposed']),
          ),
        )
        .returning(),
    ).pipe(Effect.map(first)),
})

/** A piece's back, written with its upload spent and the operation's receipt. */
const backQueries = (db: ReturnType<typeof drizzle>) => ({
  /** A back for the piece, its upload spent and the operation's receipt, as one atomic batch. */
  setBack: (
    accountId: string,
    pieceId: string,
    back: { readonly key: string; readonly uploadId: string; readonly at: Date },
    receipt: ReceiptRow,
  ) =>
    Effect.tryPromise({
      try: () =>
        db.batch([
          db
            .update(pieces)
            .set({ backImageKey: back.key, updatedAt: back.at })
            .where(and(eq(pieces.id, pieceId), eq(pieces.accountId, accountId)))
            .returning(),
          spendUpload(db, back.uploadId),
          db.insert(operationReceipts).values(receipt),
        ]),
      catch: () => StoreUnavailable.make({}),
    }).pipe(Effect.map(([updated]) => first(updated))),
})

/** Reads for the queue, which acts for no one in particular: pieces to process and pieces to ask about. */
const queueQueries = (db: ReturnType<typeof drizzle>) => ({
  /** Ready pieces carried over from the old categories that the decision model has not been asked about yet. */
  piecesToSuggest: (limit: number) =>
    query(() =>
      db
        .select({ id: pieces.id })
        .from(pieces)
        .where(and(isNull(pieces.suggestedAt), eq(pieces.status, 'ready')))
        .limit(limit),
    ).pipe(Effect.map((rows) => rows.map(({ id }) => id))),
  /** For the processing queue, which acts for no one in particular. */
  findPieceForProcessing: (pieceId: string) =>
    query(() => db.select().from(pieces).where(eq(pieces.id, pieceId)).limit(1)).pipe(Effect.map(first)),
})

/** The wardrobe's rows in D1. Every read and write of a person's rows names their account, so
 * one account can never reach another's pieces. */
export const makeStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  return {
    ...uploadQueries(db),
    ...sharedPhotoQueries(db),
    ...pictureQueries(db),
    ...queueQueries(db),
    ...backQueries(db),
    listPieces: (accountId: string) =>
      query(() => db.select().from(pieces).where(eq(pieces.accountId, accountId)).orderBy(desc(pieces.createdAt))),
    findPiece: (accountId: string, pieceId: string) =>
      query(() =>
        db
          .select()
          .from(pieces)
          .where(and(eq(pieces.id, pieceId), eq(pieces.accountId, accountId)))
          .limit(1),
      ).pipe(Effect.map(first)),
    ...receiptRows(db),
    /** The piece, its upload spent and the operation's receipt, as one atomic batch. The unique
     * upload id fails the whole batch when the upload already made a piece. */
    addPiece: (piece: PieceRow, receipt: ReceiptRow) =>
      Effect.tryPromise({
        try: () =>
          db.batch([
            db.insert(pieces).values(piece),
            spendUpload(db, piece.uploadId ?? ''),
            db.insert(operationReceipts).values(receipt),
          ]),
        catch: () => StoreUnavailable.make({}),
      }).pipe(Effect.asVoid),
    updatePiece: (accountId: string, pieceId: string, changes: PieceChanges) =>
      query(() =>
        db
          .update(pieces)
          .set(changes)
          .where(and(eq(pieces.id, pieceId), eq(pieces.accountId, accountId)))
          .returning(),
      ).pipe(Effect.map(first)),
    /** Removes the piece and its upload; returns the piece so its photos can be deleted. */
    deletePiece: (accountId: string, pieceId: string) =>
      query(() =>
        db
          .delete(pieces)
          .where(and(eq(pieces.id, pieceId), eq(pieces.accountId, accountId)))
          .returning(),
      ).pipe(
        Effect.map(first),
        Effect.tap((deleted) =>
          Option.match(deleted, {
            onNone: () => Effect.void,
            onSome: ({ uploadId }) =>
              uploadId === null ? Effect.void : query(() => db.delete(uploads).where(eq(uploads.id, uploadId))),
          }),
        ),
      ),
    /** Records the processed photo; a piece no longer processing is left as it is. */
    finishProcessing: (pieceId: string, changes: Pick<PieceRow, 'status' | 'imageKey' | 'updatedAt'>) =>
      query(() =>
        db
          .update(pieces)
          .set(changes)
          .where(and(eq(pieces.id, pieceId), eq(pieces.status, 'processing'))),
      ).pipe(Effect.asVoid),
  }
}

export type Store = ReturnType<typeof makeStore>
