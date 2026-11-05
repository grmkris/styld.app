import {
  accounts,
  detections,
  operationReceipts,
  pieceBackPictures,
  piecePictures,
  pieceProvenance,
  pieceTurns,
  pieces,
  uploads,
} from '@styld/db'
import { and, asc, desc, eq, exists, gt, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { GeneratedGarment, Pattern, PieceType } from '@styld/protocol'
import { Array, Context, Effect, Layer } from 'effect'
import { receiptRows, recordedWrites } from '../kernel/Receipts.ts'
import { PictureRows } from '../capture/Rows.ts'
import { forgetChecks } from '../safety/Checks.ts'
import { chunked, Database, fenced, first, inChunks, query } from '../kernel/Db.ts'
import { type OwedPrefix, owedMedia } from '../kernel/MediaDeletions.ts'
import { piecePrefix } from './Media.ts'

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
    | 'seasons'
    | 'rainproof'
    | 'category'
    | 'occasions'
    | 'pattern'
    | 'brand'
    | 'shopUrl'
    | 'backImageKey'
    | 'rotation'
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
  /** A house garment the seed generated, recorded with its piece (owner, 4 November 2026). */
  generated: (db: Database['Service'], piece: Pick<PieceRow, 'id' | 'accountId' | 'createdAt'>, of: GeneratedGarment) =>
    db.insert(pieceProvenance).values({
      pieceId: piece.id,
      accountId: piece.accountId,
      origin: 'generated',
      manifestId: of.manifestId,
      model: of.model,
      promptDigest: of.promptDigest,
      updatedAt: piece.createdAt,
    }),
  /** A failed import keeps its identity and source photo when the operator starts it again. */
  retryImport: (db: Database['Service'], accountId: string, pieceId: string, at: Date) =>
    db
      .update(pieces)
      .set({ status: 'processing', updatedAt: at })
      .where(
        and(
          eq(pieces.id, pieceId),
          eq(pieces.accountId, accountId),
          eq(pieces.source, 'import'),
          eq(pieces.status, 'failed'),
          exists(
            db
              .select({ id: accounts.id })
              .from(accounts)
              .where(and(eq(accounts.id, accountId), eq(accounts.enabled, true))),
          ),
        ),
      ),
  /** The back a guided-camera shot brought, for the account's pieces made from these detections that have none yet:
   * a back that finished after its front was kept (capture's pairing). */
  backOfDetections: (
    db: Database['Service'],
    accountId: string,
    detectionIds: ReadonlyArray<string>,
    backKey: string,
  ) =>
    db
      .update(pieces)
      .set({ backImageKey: backKey })
      .where(
        and(
          eq(pieces.accountId, accountId),
          isNull(pieces.backImageKey),
          inArray(pieces.detectionId, [...detectionIds]),
        ),
      )
      .returning({ id: pieces.id }),
}
export const UploadRows = {
  /** An upload Styld stored itself and a piece took at once: an imported piece's photo. */
  insertUsed: (db: Database['Service'], row: UploadRow, claim: SQL) =>
    db.insert(uploads).values({
      ...row,
      status: 'used',
      // The NOT NULL constraint fences adoption against account closure in the same batch as the piece.
      accountId: sql`(${db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, row.accountId), eq(accounts.enabled, true), claim))})`,
    }),
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
  /** Uploads never used, in `status`, whose path expired before `before`; oldest first, over the status and expiry
   * index. */
  unusedUploads: (status: 'pending' | 'received', before: Date, limit: number) =>
    query(() =>
      db
        .select({ id: uploads.id })
        .from(uploads)
        .where(and(eq(uploads.status, status), lt(uploads.expiresAt, before)))
        .orderBy(asc(uploads.expiresAt))
        .limit(limit),
    ).pipe(Effect.map((rows) => rows.map(({ id }) => id))),
  /** Forget uploads nothing used, unless something used them meanwhile; the objects of those forgotten. */
  forgetUploads: (uploadIds: ReadonlyArray<string>) =>
    Effect.map(
      Effect.forEach(chunked(uploadIds), (chunk) =>
        query(() =>
          db
            .delete(uploads)
            .where(and(inArray(uploads.id, chunk), ne(uploads.status, 'used')))
            .returning({ objectKey: uploads.objectKey }),
        ),
      ),
      (rows) => rows.flat().map(({ objectKey }) => objectKey),
    ),
  /** What of the account's uploads waits unused: paths not yet expired, and bytes received that nothing used. */
  waitingUploads: (accountId: string, now: Date) =>
    query(() =>
      db
        .select({ count: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${uploads.bytes}), 0)` })
        .from(uploads)
        .where(
          and(
            eq(uploads.accountId, accountId),
            or(and(eq(uploads.status, 'pending'), gt(uploads.expiresAt, now)), eq(uploads.status, 'received')),
          ),
        ),
    ).pipe(Effect.map((rows) => rows[0] ?? { count: 0, bytes: 0 })),
  markUploadReceived: (uploadId: string) =>
    query(() =>
      db
        .update(uploads)
        .set({ status: 'received' })
        .where(and(eq(uploads.id, uploadId), eq(uploads.status, 'pending'))),
    ).pipe(Effect.asVoid),
})

/** The row of a piece's own table (its clean picture, back picture or turn) that is the account's. */
const ownedBy = (
  table: { readonly pieceId: SQLiteColumn; readonly accountId: SQLiteColumn },
  accountId: string,
  pieceId: string,
) => and(eq(table.pieceId, pieceId), eq(table.accountId, accountId))

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
        .where(ownedBy(pieceTurns, accountId, pieceId))
        .limit(1),
    ).pipe(Effect.map(first)),
  pictureOf: (accountId: string, pieceId: string) =>
    query(() =>
      db
        .select()
        .from(piecePictures)
        .where(ownedBy(piecePictures, accountId, pieceId))
        .limit(1),
    ).pipe(Effect.map(first)),
  /** The piece's pressed back picture, drawn from its back (owner, 4 November). */
  backPictureOf: (accountId: string, pieceId: string) =>
    query(() =>
      db
        .select()
        .from(pieceBackPictures)
        .where(ownedBy(pieceBackPictures, accountId, pieceId))
        .limit(1),
    ).pipe(Effect.map(first)),
  /** The statement that shows the drawing or the photo, capture's (`PictureRows`), for its operation's batch. */
  choosePicture: (accountId: string, pieceId: string, shown: 'clean' | 'photo', at: Date) =>
    PictureRows.show(db, accountId, pieceId, shown, at),
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
    fenced(() =>
      db.batch([
        db
          .update(pieces)
          .set({ backImageKey: back.key, updatedAt: back.at })
          .where(and(eq(pieces.id, pieceId), eq(pieces.accountId, accountId)))
          .returning(),
        spendUpload(db, back.uploadId),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.map(([updated]) => first(updated))),
})

/** Which of these pieces are house garments the seed generated (owner, 4 November 2026), for every module that reads
 * it: the wardrobe never redraws them, and public reads mark them Generated. */
export const generatedAmong = (db: Database['Service'], pieceIds: ReadonlyArray<string>) =>
  Effect.map(
    inChunks(pieceIds, (chunk) =>
      db
        .select({ id: pieceProvenance.pieceId })
        .from(pieceProvenance)
        .where(and(inArray(pieceProvenance.pieceId, chunk), eq(pieceProvenance.origin, 'generated'))),
    ),
    (rows): ReadonlySet<string> => new Set(rows.map(({ id }) => id)),
  )

/** Reads for the queue, which acts for no one in particular: pieces to process. */
const queueQueries = (db: Database['Service']) => ({
  /** For the processing queue, which acts for no one in particular. */
  findPieceForProcessing: (pieceId: string) =>
    query(() => db.select().from(pieces).where(eq(pieces.id, pieceId)).limit(1)).pipe(Effect.map(first)),
  /** Which of these pieces are house garments the seed generated: never redrawn, and shown marked Generated. */
  generatedAmong: (pieceIds: ReadonlyArray<string>) => generatedAmong(db, pieceIds),
  /** What Clef read from a generated piece's picture on import, kept for the operator's report. */
  describedGenerated: (pieceId: string, type: PieceType | null, whole: number, at: Date) =>
    query(() =>
      db
        .update(pieceProvenance)
        .set({ describedType: type, describedWhole: whole, updatedAt: at })
        .where(eq(pieceProvenance.pieceId, pieceId)),
    ).pipe(Effect.asVoid),
})

/** A deleted piece's own prefix, owed a delete. */
export const owedPieceOf = (accountId: string, pieceId: string): OwedPrefix => ({
  prefix: piecePrefix(accountId, pieceId),
  accountId,
  owner: 'piece',
})

/** Deleting pieces, and the record of their prefixes still owed a delete (`kernel/MediaDeletions.ts`). */
const deleteQueries = (db: Database['Service']) => ({
  owedMedia: owedMedia(db),
  /** Removes the account's pieces, their uploads and their content checks, and records the delete's receipt, as one
   * batch; the ids go in chunks under D1's parameter limit. What the pieces were in goes with them (looks, pins, worn
   * days, pictures), and a photo's garment matched to one keeps its place, matched to nothing. Each piece's own
   * prefix is recorded as owed a delete in the same batch (`kernel/MediaDeletions.ts`), so its objects go even when R2
   * cannot remove them now. */
  deletePieces: (accountId: string, rows: ReadonlyArray<PieceRow>, receipt: ReceiptRow) =>
    fenced(() =>
      db.batch([
        db.insert(operationReceipts).values(receipt),
        ...owedMedia(db).owe(
          rows.map(({ id }) => owedPieceOf(accountId, id)),
          receipt.createdAt,
        ),
        ...chunked(rows.map(({ id }) => id)).flatMap((chunk) => [
          db.delete(pieces).where(and(eq(pieces.accountId, accountId), inArray(pieces.id, chunk))),
          forgetChecks(db, accountId, 'piece', chunk),
        ]),
        ...chunked(rows.flatMap(({ uploadId }) => (uploadId === null ? [] : [uploadId]))).map((chunk) =>
          db.delete(uploads).where(inArray(uploads.id, chunk)),
        ),
      ]),
    ).pipe(Effect.asVoid),
})

/** The wardrobe's rows in D1. Every read and write of a person's rows names their account, so
 * one account can never reach another's pieces.
 * @internal Exported for its tests. */
export const makeStore = (db: Database['Service']) => ({
  ...uploadQueries(db),
  ...pictureQueries(db),
  ...queueQueries(db),
  ...backQueries(db),
  ...deleteQueries(db),
  listPieces: (accountId: string) =>
    query(() => db.select().from(pieces).where(eq(pieces.accountId, accountId)).orderBy(desc(pieces.createdAt))),
  /** The account's ready pieces, newest first, of the type and pattern when the search names them (`Search.ts`). */
  readyPieces: (accountId: string, only: { readonly type?: PieceType; readonly pattern?: Pattern }) =>
    query(() =>
      db
        .select()
        .from(pieces)
        .where(
          and(
            eq(pieces.accountId, accountId),
            eq(pieces.status, 'ready'),
            only.type === undefined ? undefined : eq(pieces.type, only.type),
            only.pattern === undefined ? undefined : eq(pieces.pattern, only.pattern),
          ),
        )
        .orderBy(desc(pieces.createdAt)),
    ),
  findPiece: (accountId: string, pieceId: string) =>
    query(() =>
      db
        .select()
        .from(pieces)
        .where(and(eq(pieces.id, pieceId), eq(pieces.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  ...receiptRows(db),
  ...recordedWrites(db),
  /** The piece, its upload spent and the operation's receipt, as one atomic batch. The unique
   * upload id fails the whole batch when the upload already made a piece. */
  addPiece: (piece: PieceRow, receipt: ReceiptRow) =>
    fenced(() =>
      db.batch([
        db.insert(pieces).values(piece),
        spendUpload(db, piece.uploadId ?? ''),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.asVoid),
  /** How the account already spells one of its categories under a type, whatever the case it is asked in, so "ski
   * pants" joins "Ski pants" rather than making a second card (T-12). */
  categorySpelling: (accountId: string, type: PieceType, name: string) =>
    query(() =>
      db
        .selectDistinct({ category: pieces.category })
        .from(pieces)
        .where(
          and(eq(pieces.accountId, accountId), eq(pieces.type, type), sql`lower(${pieces.category}) = lower(${name})`),
        )
        .limit(1),
    ).pipe(Effect.map((rows) => rows[0]?.category ?? null)),
  /** The statement that moves every piece of one of the account's categories to another name, or out of any (null),
   * for its operation's batch (`recorded`). */
  recategorise: (accountId: string, type: PieceType, name: string, to: string | null, at: Date) =>
    db
      .update(pieces)
      .set({ category: to, updatedAt: at })
      .where(
        and(eq(pieces.accountId, accountId), eq(pieces.type, type), sql`lower(${pieces.category}) = lower(${name})`),
      ),
  /** The statement that changes the account's piece, for its operation's batch (`recorded`). */
  updatePiece: (accountId: string, pieceId: string, changes: PieceChanges) =>
    db
      .update(pieces)
      .set(changes)
      .where(and(eq(pieces.id, pieceId), eq(pieces.accountId, accountId))),
  /** The pieces with these ids, whoever's they are: a delete refuses another account's piece. */
  piecesWithIds: (pieceIds: ReadonlyArray<string>) =>
    inChunks(pieceIds, (chunk) => db.select().from(pieces).where(inArray(pieces.id, chunk))),
  keysInUse: (accountId: string, keys: ReadonlyArray<string>) => keysInUse(db, accountId, keys),
  /** Records the processed photo; a piece no longer processing is left as it is. */
  finishProcessing: (
    pieceId: string,
    changes: Pick<PieceRow, 'status' | 'imageKey' | 'updatedAt'> &
      Partial<Pick<PieceRow, 'type' | 'colours' | 'seasons' | 'rainproof' | 'occasions' | 'pattern'>>,
  ) =>
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
