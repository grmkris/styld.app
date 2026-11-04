import { operationReceipts, outfitPhotos, photoGarments } from '@styld/db'
import { accountOfEmail } from '@styld/auth/provisioning'
import { and, asc, desc, eq, inArray, exists, isNotNull, isNull, ne, notExists } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { insertWhen } from '../kernel/Conditional.ts'
import { OfferedRows } from '../capture/Rows.ts'
import type { CaptureRow, DetectionRow } from '../capture/Store.ts'
import { type ReceiptRow, spendUpload, UploadRows } from '../wardrobe/Store.ts'
import { forgetReceipt } from '../kernel/Receipts.ts'
import { Database, first, inChunks, query } from '../kernel/Db.ts'

export type PhotoRow = typeof outfitPhotos.$inferSelect
export type GarmentRow = typeof photoGarments.$inferSelect

/** The most photos one list reads, newest first. */
const mostListed = 200

type Db = Database['Service']

const ofAccount = (accountId: string, photoId: string) =>
  and(eq(outfitPhotos.id, photoId), eq(outfitPhotos.accountId, accountId))

const finishFinding = (db: Db, photoId: string, garments: ReadonlyArray<GarmentRow>, at: Date) => {
  const current = and(eq(outfitPhotos.id, photoId), eq(outfitPhotos.status, 'finding'))
  const owns = exists(db.select({ id: outfitPhotos.id }).from(outfitPhotos).where(current))
  return query(() =>
    db.batch([
      db.delete(photoGarments).where(and(eq(photoGarments.photoId, photoId), owns)),
      ...garments.map((garment) => insertWhen(db, photoGarments, garment, owns)),
      db.update(outfitPhotos).set({ status: 'ready', updatedAt: at }).where(current).returning({ id: outfitPhotos.id }),
    ]),
  ).pipe(Effect.asVoid)
}

/** Reading photos and their garments. */
const reads = (db: Db) => ({
  findPhoto: (accountId: string, photoId: string) =>
    query(() => db.select().from(outfitPhotos).where(ofAccount(accountId, photoId)).limit(1)).pipe(Effect.map(first)),
  photoForWork: (photoId: string) =>
    query(() => db.select().from(outfitPhotos).where(eq(outfitPhotos.id, photoId)).limit(1)).pipe(Effect.map(first)),
  listPhotos: (accountId: string) =>
    query(() =>
      db
        .select()
        .from(outfitPhotos)
        .where(eq(outfitPhotos.accountId, accountId))
        .orderBy(desc(outfitPhotos.createdAt))
        .limit(mostListed),
    ),
  /** The photos a piece is confirmed in, newest first. */
  photosOfPiece: (accountId: string, pieceId: string) =>
    query(() =>
      db
        .selectDistinct({ photo: outfitPhotos })
        .from(outfitPhotos)
        .innerJoin(photoGarments, eq(photoGarments.photoId, outfitPhotos.id))
        .where(
          and(
            eq(outfitPhotos.accountId, accountId),
            eq(photoGarments.pieceId, pieceId),
            eq(photoGarments.state, 'confirmed'),
          ),
        )
        .orderBy(desc(outfitPhotos.createdAt))
        .limit(mostListed),
    ).pipe(Effect.map((rows) => rows.map(({ photo }) => photo))),
  /** The account an email signs in to, for the operator, who names accounts by email. */
  accountOf: (email: string) => query(() => accountOfEmail(db, email)).pipe(Effect.map(first)),
  garmentsOf: (photoIds: ReadonlyArray<string>) =>
    inChunks(photoIds, (chunk) =>
      db.select().from(photoGarments).where(inArray(photoGarments.photoId, chunk)).orderBy(asc(photoGarments.position)),
    ),
})

/** Changing photos and their garments. */
const writes = (db: Db) => ({
  /** The photo, its upload spent and the operation's receipt, as one batch: an upload makes one photo. */
  addPhoto: (photo: PhotoRow, receipt: ReceiptRow) =>
    query(() =>
      db.batch([
        db.insert(outfitPhotos).values(photo),
        spendUpload(db, photo.uploadId),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.asVoid),
  /** Undo a photo whose credit could not be held: the photo, its receipt, and its upload received again. */
  undoPhoto: (photo: PhotoRow, operationId: string) =>
    query(() =>
      db.batch([
        db.delete(outfitPhotos).where(and(eq(outfitPhotos.id, photo.id), eq(outfitPhotos.status, 'finding'))),
        forgetReceipt(db, photo.accountId, operationId),
        UploadRows.restore(db, photo.uploadId),
      ]),
    ).pipe(Effect.asVoid),
  /** The garments found, and the photo ready, in one batch; only while it is still being found. */
  finishFinding: (photoId: string, garments: ReadonlyArray<GarmentRow>, at: Date) =>
    finishFinding(db, photoId, garments, at),
  /** The photo's finding given up: whether this call ended it. */
  failFinding: (photoId: string, at: Date) =>
    query(() =>
      db
        .update(outfitPhotos)
        .set({ status: 'failed', updatedAt: at })
        .where(and(eq(outfitPhotos.id, photoId), eq(outfitPhotos.status, 'finding')))
        .returning({ id: outfitPhotos.id }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  setFavourite: (accountId: string, photoId: string, favourite: boolean, at: Date) =>
    query(() =>
      db.update(outfitPhotos).set({ favourite, updatedAt: at }).where(ofAccount(accountId, photoId)).returning(),
    ).pipe(Effect.map(first)),
  /** The person cut out of the photo, for collages. */
  setCutout: (accountId: string, photoId: string, cutoutKey: string, at: Date) =>
    query(() => db.update(outfitPhotos).set({ cutoutKey, updatedAt: at }).where(ofAccount(accountId, photoId))).pipe(
      Effect.asVoid,
    ),
  /** The look "Wear it again" saved from the photo. */
  setLook: (accountId: string, photoId: string, lookId: string, at: Date) =>
    query(() => db.update(outfitPhotos).set({ lookId, updatedAt: at }).where(ofAccount(accountId, photoId))).pipe(
      Effect.asVoid,
    ),
  /** Remove the photo and its garments, with the delete's receipt; the row as it was, so its objects can go too. */
  deletePhoto: (accountId: string, photoId: string, receipt: ReceiptRow) =>
    query(() =>
      db.batch([
        db.delete(outfitPhotos).where(ofAccount(accountId, photoId)).returning(),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.map(([deleted]) => first(deleted))),
})

/** Changing a photo's garments: matched, offered to the review tray, or added and taken off by hand. */
const garmentWrites = (db: Db) => ({
  /** A photo found again (the operator's re-find): Styld's own guesses, suggested or unmatched, give way to what was
   * found now, in one batch and only while the photo is ready. What the person confirmed, offered or added by hand
   * stays, and a found garment already on the photo (a repeated delivery) is not written twice. */
  replaceGuesses: (photoId: string, found: ReadonlyArray<GarmentRow>) => {
    const ready = exists(
      db
        .select({ id: outfitPhotos.id })
        .from(outfitPhotos)
        .where(and(eq(outfitPhotos.id, photoId), eq(outfitPhotos.status, 'ready'))),
    )
    const absent = (id: string) =>
      notExists(db.select({ id: photoGarments.id }).from(photoGarments).where(eq(photoGarments.id, id)))
    return query(() =>
      db.batch([
        db
          .delete(photoGarments)
          .where(
            and(
              eq(photoGarments.photoId, photoId),
              inArray(photoGarments.state, ['suggested', 'unmatched']),
              isNotNull(photoGarments.cutoutKey),
              ready,
            ),
          ),
        ...found.map((garment) => insertWhen(db, photoGarments, garment, and(ready, absent(garment.id)) ?? ready)),
      ]),
    ).pipe(Effect.asVoid)
  },
  /** A garment offered to the review tray: its capture and detection, and the garment marked offered, in one batch. */
  offerGarment: (garmentId: string, capture: CaptureRow, detection: DetectionRow) =>
    query(() =>
      db.batch([
        ...OfferedRows.insert(db, capture, detection),
        db
          .update(photoGarments)
          .set({ state: 'offered', pieceId: null })
          .where(and(eq(photoGarments.id, garmentId), eq(photoGarments.accountId, capture.accountId))),
      ]),
    ).pipe(Effect.asVoid),
  /** A garment confirmed as a piece, or found in none: only the account's own, on its own photo, and never one offered
   * to the review tray, whose card keeping it is what confirms it (`Rows.ts`). */
  matchGarment: (accountId: string, photoId: string, garmentId: string, pieceId: string | null) =>
    query(() =>
      db
        .update(photoGarments)
        .set({ pieceId, state: pieceId === null ? 'unmatched' : 'confirmed' })
        .where(
          and(
            eq(photoGarments.id, garmentId),
            eq(photoGarments.photoId, photoId),
            eq(photoGarments.accountId, accountId),
            ne(photoGarments.state, 'offered'),
          ),
        )
        .returning({ id: photoGarments.id }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** A piece the person added to the photo by hand: only while the photo is theirs and ready (`finishFinding` writes
   * the garments of a photo still being found); whether it was added. */
  addGarment: (garment: GarmentRow) =>
    query(() =>
      insertWhen(
        db,
        photoGarments,
        garment,
        exists(
          db
            .select({ id: outfitPhotos.id })
            .from(outfitPhotos)
            .where(and(ofAccount(garment.accountId, garment.photoId), eq(outfitPhotos.status, 'ready'))),
        ),
      ),
    ).pipe(Effect.map(({ meta }) => meta.changes > 0)),
  /** A piece added by hand taken off the photo again: it was never found in it, so nothing is left behind. */
  removeAddedGarment: (accountId: string, photoId: string, garmentId: string) =>
    query(() =>
      db
        .delete(photoGarments)
        .where(
          and(
            eq(photoGarments.id, garmentId),
            eq(photoGarments.photoId, photoId),
            eq(photoGarments.accountId, accountId),
            isNull(photoGarments.cutoutKey),
          ),
        ),
    ).pipe(Effect.asVoid),
})

/** My Gallery's rows over D1: photos, their garments, and the receipt that makes adding one idempotent. */
export const makePhotoStore = (db: Db) => ({ ...reads(db), ...writes(db), ...garmentWrites(db) })

/** My Gallery's rows over the application's one database. */
export class PhotoStore extends Context.Service<PhotoStore, ReturnType<typeof makePhotoStore>>()(
  '@styld/server/photos/PhotoStore',
) {
  static readonly layer = Layer.effect(this, Effect.map(Database, makePhotoStore))
}
