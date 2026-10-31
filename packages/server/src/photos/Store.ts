import { captures, detections, operationReceipts, outfitPhotos, photoGarments } from '@styld/db'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Option } from 'effect'
import type { CaptureRow, DetectionRow } from '../capture/Store.ts'
import { type ReceiptRow, spendUpload, StoreUnavailable } from '../wardrobe/Store.ts'

export type PhotoRow = typeof outfitPhotos.$inferSelect
export type GarmentRow = typeof photoGarments.$inferSelect

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => StoreUnavailable.make({}) })
const first = <A>(rows: ReadonlyArray<A>) => Option.fromNullishOr(rows[0])

/** The most photos one list reads, newest first. */
const mostListed = 200

type Db = ReturnType<typeof drizzle>

const ofAccount = (accountId: string, photoId: string) =>
  and(eq(outfitPhotos.id, photoId), eq(outfitPhotos.accountId, accountId))

/** Reading photos and their garments. */
const reads = (db: Db) => ({
  findPhoto: (accountId: string, photoId: string) =>
    attempt(() => db.select().from(outfitPhotos).where(ofAccount(accountId, photoId)).limit(1)).pipe(Effect.map(first)),
  photoForWork: (photoId: string) =>
    attempt(() => db.select().from(outfitPhotos).where(eq(outfitPhotos.id, photoId)).limit(1)).pipe(Effect.map(first)),
  listPhotos: (accountId: string) =>
    attempt(() =>
      db
        .select()
        .from(outfitPhotos)
        .where(eq(outfitPhotos.accountId, accountId))
        .orderBy(desc(outfitPhotos.createdAt))
        .limit(mostListed),
    ),
  /** The photos a piece is confirmed in, newest first. */
  photosOfPiece: (accountId: string, pieceId: string) =>
    attempt(() =>
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
  garmentsOf: (photoIds: ReadonlyArray<string>) =>
    photoIds.length === 0
      ? Effect.succeed<ReadonlyArray<GarmentRow>>([])
      : attempt(() =>
          db
            .select()
            .from(photoGarments)
            .where(inArray(photoGarments.photoId, [...photoIds]))
            .orderBy(asc(photoGarments.position)),
        ),
})

/** Changing photos and their garments. */
const writes = (db: Db) => ({
  /** The photo, its upload spent and the operation's receipt, as one batch: an upload makes one photo. */
  addPhoto: (photo: PhotoRow, receipt: ReceiptRow) =>
    attempt(() =>
      db.batch([
        db.insert(outfitPhotos).values(photo),
        spendUpload(db, photo.uploadId),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.asVoid),
  /** The garments found, and the photo ready, in one batch; only while it is still being found. */
  finishFinding: (photoId: string, garments: ReadonlyArray<GarmentRow>, at: Date) =>
    attempt(() =>
      db.batch([
        db.delete(photoGarments).where(eq(photoGarments.photoId, photoId)),
        ...garments.map((garment) => db.insert(photoGarments).values(garment)),
        db
          .update(outfitPhotos)
          .set({ status: 'ready', updatedAt: at })
          .where(and(eq(outfitPhotos.id, photoId), eq(outfitPhotos.status, 'finding'))),
      ]),
    ).pipe(Effect.asVoid),
  /** A garment offered to the review tray: its capture and detection, and the garment marked offered, in one batch. */
  offerGarment: (garmentId: string, capture: CaptureRow, detection: DetectionRow) =>
    attempt(() =>
      db.batch([
        db.insert(captures).values(capture),
        db.insert(detections).values(detection),
        db
          .update(photoGarments)
          .set({ state: 'offered', captureId: capture.id, pieceId: null })
          .where(and(eq(photoGarments.id, garmentId), eq(photoGarments.accountId, capture.accountId))),
      ]),
    ).pipe(Effect.asVoid),
  /** The photo's finding given up: whether this call ended it. */
  failFinding: (photoId: string, at: Date) =>
    attempt(() =>
      db
        .update(outfitPhotos)
        .set({ status: 'failed', updatedAt: at })
        .where(and(eq(outfitPhotos.id, photoId), eq(outfitPhotos.status, 'finding')))
        .returning({ id: outfitPhotos.id }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  setFavourite: (accountId: string, photoId: string, favourite: boolean, at: Date) =>
    attempt(() =>
      db.update(outfitPhotos).set({ favourite, updatedAt: at }).where(ofAccount(accountId, photoId)).returning(),
    ).pipe(Effect.map(first)),
  /** The person cut out of the photo, for collages. */
  setCutout: (accountId: string, photoId: string, cutoutKey: string, at: Date) =>
    attempt(() => db.update(outfitPhotos).set({ cutoutKey, updatedAt: at }).where(ofAccount(accountId, photoId))).pipe(
      Effect.asVoid,
    ),
  /** The look "Wear it again" saved from the photo. */
  setLook: (accountId: string, photoId: string, lookId: string, at: Date) =>
    attempt(() => db.update(outfitPhotos).set({ lookId, updatedAt: at }).where(ofAccount(accountId, photoId))).pipe(
      Effect.asVoid,
    ),
  /** A garment confirmed as a piece, or found in none: only the account's own, on its own photo. */
  matchGarment: (accountId: string, photoId: string, garmentId: string, pieceId: string | null) =>
    attempt(() =>
      db
        .update(photoGarments)
        .set({ pieceId, state: pieceId === null ? 'unmatched' : 'confirmed' })
        .where(
          and(
            eq(photoGarments.id, garmentId),
            eq(photoGarments.photoId, photoId),
            eq(photoGarments.accountId, accountId),
          ),
        )
        .returning({ id: photoGarments.id }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Remove the photo and its garments; the row as it was, so its objects can go too. */
  deletePhoto: (accountId: string, photoId: string) =>
    attempt(() => db.delete(outfitPhotos).where(ofAccount(accountId, photoId)).returning()).pipe(Effect.map(first)),
})

/** My Gallery's rows over D1: photos, their garments, and the receipt that makes adding one idempotent. */
export const makePhotoStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  return { ...reads(db), ...writes(db) }
}
export type PhotoStore = ReturnType<typeof makePhotoStore>
