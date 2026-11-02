import { accounts, detections, operationReceipts, piecePictures, pieceTurns, pieces, uploads } from '@styld/db'
import { and, asc, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm'
import { Array, Context, Effect, Layer } from 'effect'
import { receiptRows } from '../kernel/Receipts.ts'
import { PictureRows } from '../capture/Rows.ts'
import { forgetCheck } from '../safety/Checks.ts'
import { chunked, Database, first, query, StoreUnavailable } from '../kernel/Db.ts'

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
    | 'backImageKey'
    | 'updatedAt'
  >
>

/** Which of these pieces belong to the account. */
export const ownPieceIds = (db: Database['Service'], accountId: string, pieceIds: ReadonlyArray<string>) =>
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
export const receivedUploadKey = (db: Database['Service'], accountId: string, uploadId: string) =>
  sql<string>`${db
    .select({ key: uploads.objectKey })
    .from(uploads)
    .where(and(eq(uploads.id, uploadId), eq(uploads.accountId, accountId), eq(uploads.status, 'received')))}`

/** Spend an upload, in the batch that records what it made: the one way an upload is used. Only a received upload can
 * be spent; spending one already used (or not yet received) sets its status to null, which the NOT NULL column refuses,
 * failing the whole batch, so one upload never makes two things (a capture and a piece's back, say). */
export const spendUpload = (db: Database['Service'], uploadId: string) =>
  db
    .update(uploads)
    .set({ status: sql<'used'>`CASE WHEN ${uploads.status} = 'received' THEN 'used' END` })
    .where(eq(uploads.id, uploadId))

/** The wardrobe's statements for another module's batch: a piece it creates (a kept detection), and an upload given
 * back when the batch that spent it is undone. */
export const PieceRows = {
  insert: (db: Database['Service'], row: PieceRow) => db.insert(pieces).values(row),
}
export const UploadRows = {
  spend: spendUpload,
  restore: (db: Database['Service'], uploadId: string) =>
    db
      .update(uploads)
      .set({ status: 'received' })
      .where(and(eq(uploads.id, uploadId), eq(uploads.status, 'used'))),
}

/** Which of these stored objects the account still shows: as a piece's photo, image or back, or as an open detection's
 * photo, cut-out or back in the tray. The one in-use check: an object goes only when nothing shows it.
 * @internal Exported for its tests. */
export const keysInUse = (db: Database['Service'], accountId: string, keys: ReadonlyArray<string>) =>
  Effect.map(
    // Each key is bound three times, so a chunk holds 30 of them.
    Effect.forEach(Array.chunksOf(keys, 30), (chunk) =>
      Effect.all([
        query(() =>
          db
            .select({ a: pieces.originalKey, b: pieces.imageKey, c: pieces.backImageKey })
            .from(pieces)
            .where(
              and(
                eq(pieces.accountId, accountId),
                or(
                  inArray(pieces.originalKey, [...chunk]),
                  inArray(pieces.imageKey, [...chunk]),
                  inArray(pieces.backImageKey, [...chunk]),
                ),
              ),
            ),
        ),
        query(() =>
          db
            .select({ a: detections.sourceKey, b: detections.cutoutKey, c: detections.backCutoutKey })
            .from(detections)
            .where(
              and(
                eq(detections.accountId, accountId),
                eq(detections.status, 'review'),
                or(
                  inArray(detections.sourceKey, [...chunk]),
                  inArray(detections.cutoutKey, [...chunk]),
                  inArray(detections.backCutoutKey, [...chunk]),
                ),
              ),
            ),
        ),
      ]),
    ),
    (found) => new Set(found.flat(2).flatMap(({ a, b, c }) => [a, b, c].filter((key) => key !== null))),
  )

/** Uploads, and whether their account still takes photos. */
const uploadQueries = (db: Database['Service']) => ({
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
  /** Uploads never used: a path whose bytes never came before it expired, or bytes received but used by nothing a
   * day after the path expired. Oldest first. */
  unusedUploads: (expiredBefore: Date, receivedBefore: Date, limit: number) =>
    query(() =>
      db
        .select({ id: uploads.id, objectKey: uploads.objectKey })
        .from(uploads)
        .where(
          or(
            and(eq(uploads.status, 'pending'), lt(uploads.expiresAt, expiredBefore)),
            and(eq(uploads.status, 'received'), lt(uploads.expiresAt, receivedBefore)),
          ),
        )
        .orderBy(asc(uploads.expiresAt))
        .limit(limit),
    ),
  /** Forget an upload nothing used, unless something used it meanwhile. */
  forgetUpload: (uploadId: string) =>
    query(() => db.delete(uploads).where(and(eq(uploads.id, uploadId), ne(uploads.status, 'used')))).pipe(
      Effect.asVoid,
    ),
  markUploadReceived: (uploadId: string) =>
    query(() =>
      db
        .update(uploads)
        .set({ status: 'received' })
        .where(and(eq(uploads.id, uploadId), eq(uploads.status, 'pending'))),
    ).pipe(Effect.asVoid),
})

/** Pieces' clean pictures as their owner reads and chooses them. The picture job writes everything else. */
const pictureQueries = (db: Database['Service']) => ({
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
  /** Show the drawing or the photo, by capture's statement (`PictureRows`). The picture, if chosen. */
  choosePicture: (accountId: string, pieceId: string, shown: 'clean' | 'photo', at: Date) =>
    query(() => PictureRows.show(db, accountId, pieceId, shown, at)).pipe(Effect.map(first)),
})

/** A piece's back, written with its upload spent and the operation's receipt. */
const backQueries = (db: Database['Service']) => ({
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

/** Reads for the queue, which acts for no one in particular: pieces to process. */
const queueQueries = (db: Database['Service']) => ({
  /** For the processing queue, which acts for no one in particular. */
  findPieceForProcessing: (pieceId: string) =>
    query(() => db.select().from(pieces).where(eq(pieces.id, pieceId)).limit(1)).pipe(Effect.map(first)),
})

/** The wardrobe's rows in D1. Every read and write of a person's rows names their account, so
 * one account can never reach another's pieces.
 * @internal Exported for its tests. */
export const makeStore = (db: Database['Service']) => ({
  ...uploadQueries(db),
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
  /** Removes the piece, its upload and its content check, and records the delete's receipt, as one batch. */
  deletePiece: (accountId: string, piece: PieceRow, receipt: ReceiptRow) =>
    query(() =>
      db.batch([
        db
          .delete(pieces)
          .where(and(eq(pieces.id, piece.id), eq(pieces.accountId, accountId)))
          .returning({ id: pieces.id }),
        forgetCheck(db, accountId, { kind: 'piece', id: piece.id }),
        db.insert(operationReceipts).values(receipt),
        ...(piece.uploadId === null ? [] : [db.delete(uploads).where(eq(uploads.id, piece.uploadId))]),
      ]),
    ).pipe(Effect.map(([deleted]) => deleted.length > 0)),
  keysInUse: (accountId: string, keys: ReadonlyArray<string>) => keysInUse(db, accountId, keys),
  /** Records the processed photo; a piece no longer processing is left as it is. */
  finishProcessing: (pieceId: string, changes: Pick<PieceRow, 'status' | 'imageKey' | 'updatedAt'>) =>
    query(() =>
      db
        .update(pieces)
        .set(changes)
        .where(and(eq(pieces.id, pieceId), eq(pieces.status, 'processing'))),
    ).pipe(Effect.asVoid),
})

export type Store = ReturnType<typeof makeStore>

/** The wardrobe's store over the application's one database, for the modules that read or spend its rows. */
export class WardrobeStore extends Context.Service<WardrobeStore, Store>()('@styld/server/wardrobe/WardrobeStore') {
  static readonly layer = Layer.effect(this, Effect.map(Database, makeStore))
}
