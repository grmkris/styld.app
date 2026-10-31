import {
  type AddPhoto,
  type MatchGarment,
  maximumLookPieces,
  NothingConfirmed,
  PieceId,
  type WearAgain,
  OperationConflict,
  Photo,
  PhotoNotFound,
  PieceNotFound,
  UploadRefused,
} from '@styld/protocol'
import { Context, DateTime, Effect, Option, Predicate, Schema } from 'effect'
import { captureKey, enqueueMatch, readObject, storedAs, unavailable, writeObject } from '../capture/Parts.ts'
import type { CaptureRow, DetectionRow } from '../capture/Store.ts'
import type { CaptureConfig } from '../capture/Policy.ts'
import type { GarmentSegmenter, GarmentVision, PictureWork } from '../capture/Providers.ts'
import { Usage } from '../capture/Usage.ts'
import { CurrentAccount } from '../CurrentAccount.ts'
import type { Looks } from '../looks/Looks.ts'
import { deliverImage } from '../wardrobe/Delivery.ts'
import type { ShownImage } from '../wardrobe/Http.ts'
import type { ImageSize } from '../wardrobe/Media.ts'
import { finding, type PhotoParts, photoHold, photoPrefix } from './Finding.ts'
import type { GarmentRow, PhotoRow } from './Store.ts'

// My Gallery for the website (owner, 2026-10-31): adding a photo spends its upload and holds a credit while Styld finds
// its garments; the person then confirms or corrects each match, marks favourites, and may delete a photo, which takes
// its objects with it. Every operation acts for `CurrentAccount`.

const now = Effect.map(DateTime.now, DateTime.toDateUtc)

/** A stored photo as the protocol shows it. A confirmed garment whose piece was deleted shows as unmatched. Only the
 * service writes rows, through the same schemas; one that does not decode is a bug. */
const toPhoto = (row: PhotoRow, garments: ReadonlyArray<GarmentRow>) =>
  Schema.decodeUnknownEffect(Photo)({
    id: row.id,
    status: row.status,
    favourite: row.favourite,
    garments: garments
      .filter(({ photoId }) => photoId === row.id)
      .map((garment) => ({
        id: garment.id,
        type: garment.type,
        colours: garment.colours,
        match: garment.pieceId === null && garment.state !== 'offered' ? 'unmatched' : garment.state,
        pieceId: garment.pieceId,
      })),
    lookId: row.lookId,
    hasCutout: row.cutoutKey !== null,
    createdAt: row.createdAt.toISOString(),
  }).pipe(Effect.orDie)

/** Photos as the protocol shows them, each with its garments. */
const photosOf = (parts: PhotoParts, rows: ReadonlyArray<PhotoRow>) =>
  Effect.gen(function* () {
    const garments = yield* storedAs(parts.photos.garmentsOf(rows.map(({ id }) => id)))
    return yield* Effect.forEach(rows, (row) => toPhoto(row, garments))
  })

/** The account's own photo, or `PhotoNotFound`, as if another account's did not exist. */
const ownPhoto = (parts: PhotoParts, accountId: string, photoId: string) =>
  Effect.flatMap(
    storedAs(parts.photos.findPhoto(accountId, photoId)),
    Option.match({ onNone: () => Effect.fail(PhotoNotFound.make({})), onSome: Effect.succeed }),
  )

/** The account's own ready piece, or `PieceNotFound`. */
const ownPiece = (parts: PhotoParts, accountId: string, pieceId: string) =>
  Effect.flatMap(
    storedAs(parts.capture.wardrobeStore.findPiece(accountId, pieceId)),
    Option.match({
      onNone: () => Effect.fail(PieceNotFound.make({})),
      onSome: (piece) => (piece.status === 'ready' ? Effect.succeed(piece) : Effect.fail(PieceNotFound.make({}))),
    }),
  )

/** A received upload of this account that has not made anything yet. */
const usableUpload = (parts: PhotoParts, accountId: string, uploadId: string) =>
  Effect.gen(function* () {
    const row = yield* storedAs(parts.capture.wardrobeStore.findUpload(uploadId))
    if (Option.isNone(row) || row.value.accountId !== accountId)
      return yield* UploadRefused.make({ reason: 'notFound' })
    if (row.value.status === 'used') return yield* UploadRefused.make({ reason: 'alreadyUsed' })
    if (row.value.status !== 'received') return yield* UploadRefused.make({ reason: 'notReceived' })
    if (!row.value.contentType.startsWith('image/')) return yield* UploadRefused.make({ reason: 'wrongType' })
    return row.value
  })

const enqueue = (parts: PhotoParts, photoId: string) =>
  Effect.tryPromise({ try: () => parts.capture.bindings.queue.send({ findIn: photoId }), catch: unavailable })

/** The photo an operation already made, for the same upload; a conflict for another. A photo still being found goes
 * to the queue again, in case the first message never left. */
const replayed = (parts: PhotoParts, accountId: string, input: AddPhoto) =>
  Effect.gen(function* () {
    const receipt = yield* storedAs(parts.capture.wardrobeStore.findReceipt(accountId, input.operationId))
    if (Option.isNone(receipt)) return Option.none<PhotoRow>()
    if (receipt.value.inputDigest !== input.uploadId) return yield* OperationConflict.make({})
    const photo = yield* ownPhoto(parts, accountId, receipt.value.result).pipe(Effect.mapError(unavailable))
    if (photo.status === 'finding') yield* enqueue(parts, photo.id)
    return Option.some(photo)
  })

/** Hold the credit, then write the photo and spend its upload; give the credit back if the write fails. */
const added = (parts: PhotoParts, accountId: string, input: AddPhoto) =>
  Effect.gen(function* () {
    const upload = yield* usableUpload(parts, accountId, input.uploadId)
    const id = yield* parts.newId('ph')
    const at = yield* now
    const usage = yield* Usage
    yield* usage.reserve(accountId, photoHold(id), 1)
    const row: PhotoRow = {
      id,
      accountId,
      uploadId: upload.id,
      originalKey: upload.objectKey,
      contentType: upload.contentType,
      status: 'finding',
      favourite: false,
      lookId: null,
      cutoutKey: null,
      createdAt: at,
      updatedAt: at,
    }
    const receipt = {
      accountId,
      operationId: input.operationId,
      command: 'addPhoto',
      inputDigest: input.uploadId,
      result: id,
      createdAt: at,
    }
    yield* storedAs(parts.photos.addPhoto(row, receipt)).pipe(
      Effect.tapError(() => usage.settle(accountId, photoHold(id), 'refunded').pipe(Effect.ignore({ log: true }))),
    )
    yield* enqueue(parts, id)
    return row
  })

/** The photo's objects: its original upload, and everything under its own prefix. */
const deleteObjects = (parts: PhotoParts, row: PhotoRow) =>
  Effect.gen(function* () {
    const bucket = parts.capture.bindings.bucket
    const listed = yield* Effect.tryPromise({
      try: () => bucket.list({ prefix: photoPrefix(row.accountId, row.id) }),
      catch: unavailable,
    })
    const keys = [row.originalKey, ...listed.objects.map(({ key }) => key)]
    yield* Effect.tryPromise({ try: () => bucket.delete(keys), catch: unavailable })
  })

/** A garment offered to the review tray, as a capture of its own (source `photos`, no credit). Its picture is copied
 * under the capture, so the photo and the tray never share an object; a cut-out is compared with the wardrobe there,
 * so the tray asks "Already in your wardrobe?" rather than adding a silent duplicate. */
const offered = (parts: PhotoParts, photo: PhotoRow, garment: GarmentRow) =>
  Effect.gen(function* () {
    const captureId = yield* parts.capture.randomId('cp')
    const detectionId = yield* parts.capture.randomId('dt')
    const bytes = yield* readObject(parts.capture, garment.cutoutKey)
    if (Option.isNone(bytes)) return yield* unavailable()
    // With the providers off the garment is the whole photo, as it was uploaded.
    const cutOut = garment.cutoutKey !== photo.originalKey
    const contentType = cutOut ? 'image/png' : photo.contentType
    const key = captureKey(photo.accountId, captureId, cutOut ? `${detectionId}.png` : detectionId)
    yield* writeObject(parts.capture, key, bytes.value, contentType)
    const at = yield* now
    const capture = {
      id: captureId,
      accountId: photo.accountId,
      kind: 'photo',
      source: 'photos',
      status: 'review',
      uploadId: garment.id,
      originalKey: key,
      contentType,
      bytes: bytes.value.byteLength,
      side: null,
      pairsWith: null,
      route: null,
      routeConfidence: null,
      provider: null,
      providerFileId: null,
      frameCount: null,
      durationMs: null,
      width: null,
      height: null,
      credits: 0,
      settlement: 'consumed',
      hold: null,
      attempt: 0,
      importId: null,
      trackingStartedAt: null,
      errorCode: null,
      createdAt: at,
      updatedAt: at,
    } satisfies CaptureRow
    const detection = {
      id: detectionId,
      captureId,
      accountId: photo.accountId,
      status: 'review',
      cutoutKey: cutOut ? key : null,
      sourceKey: key,
      backCutoutKey: null,
      track: null,
      confidence: null,
      preselected: true,
      suggestedType: garment.type,
      suggestedColours: garment.colours,
      suggestedSeason: null,
      suggestedOccasions: [],
      suggestedPattern: null,
      pieceId: null,
      whole: null,
      groupOf: null,
      duplicateOf: null,
      matching: cutOut && garment.type !== null ? 'waiting' : null,
      matchClaimedAt: null,
      createdAt: at,
    } satisfies DetectionRow
    yield* storedAs(parts.photos.offerGarment(garment.id, capture, detection))
    if (detection.matching === 'waiting') yield* enqueueMatch(parts.capture, captureId)
  })

/** Reading and adding photos, and the queue's work. */
const reading = (parts: PhotoParts) => ({
  ...finding(parts),
  listPhotos: Effect.fn('Styld.Photos.list')(function* () {
    const { accountId } = yield* CurrentAccount
    return yield* photosOf(parts, yield* storedAs(parts.photos.listPhotos(accountId)))
  }),
  addPhoto: Effect.fn('Styld.Photos.add')(function* (input: AddPhoto) {
    const { accountId } = yield* CurrentAccount
    const earlier = yield* replayed(parts, accountId, input)
    const row = Option.isSome(earlier) ? earlier.value : yield* added(parts, accountId, input)
    return yield* toPhoto(row, [])
  }),
  getPhoto: Effect.fn('Styld.Photos.get')(function* (photoId: string) {
    const { accountId } = yield* CurrentAccount
    const [photo] = yield* photosOf(parts, [yield* ownPhoto(parts, accountId, photoId)])
    return photo ?? (yield* PhotoNotFound.make({}))
  }),
})

/** Changing a photo: favourite, delete, match, offer and wear again. */
const changing = (parts: PhotoParts, looks: Looks['Service']) => ({
  updatePhoto: Effect.fn('Styld.Photos.update')(function* (photoId: string, input: { readonly favourite: boolean }) {
    const { accountId } = yield* CurrentAccount
    const updated = yield* storedAs(parts.photos.setFavourite(accountId, photoId, input.favourite, yield* now))
    if (Option.isNone(updated)) return yield* PhotoNotFound.make({})
    const [photo] = yield* photosOf(parts, [updated.value])
    return photo ?? (yield* PhotoNotFound.make({}))
  }),
  /** Delete a photo: its objects first, so a retry finds the row and finishes. */
  deletePhoto: Effect.fn('Styld.Photos.delete')(function* (photoId: string) {
    const { accountId } = yield* CurrentAccount
    const row = yield* ownPhoto(parts, accountId, photoId)
    yield* deleteObjects(parts, row)
    yield* storedAs(parts.photos.deletePhoto(accountId, photoId))
  }),
  matchGarment: Effect.fn('Styld.Photos.match')(function* (photoId: string, garmentId: string, input: MatchGarment) {
    const { accountId } = yield* CurrentAccount
    yield* ownPhoto(parts, accountId, photoId)
    if (input.pieceId !== null) yield* ownPiece(parts, accountId, input.pieceId)
    if (!(yield* storedAs(parts.photos.matchGarment(accountId, photoId, garmentId, input.pieceId))))
      return yield* PhotoNotFound.make({})
    const [photo] = yield* photosOf(parts, [yield* ownPhoto(parts, accountId, photoId)])
    return photo ?? (yield* PhotoNotFound.make({}))
  }),
  /** Offer a garment to the review tray, once: offering it again answers the photo as it is. */
  offerGarment: Effect.fn('Styld.Photos.offer')(function* (photoId: string, garmentId: string) {
    const { accountId } = yield* CurrentAccount
    const photo = yield* ownPhoto(parts, accountId, photoId)
    const garment = (yield* storedAs(parts.photos.garmentsOf([photoId]))).find(({ id }) => id === garmentId)
    if (garment === undefined) return yield* PhotoNotFound.make({})
    if (garment.state !== 'offered') yield* offered(parts, photo, garment)
    const [shown] = yield* photosOf(parts, [photo])
    return shown ?? (yield* PhotoNotFound.make({}))
  }),
  /** "Wear it again": the photo's confirmed pieces as a look, remembered on the photo. Repeating the operation answers
   * the same look. */
  wearAgain: Effect.fn('Styld.Photos.wearAgain')(function* (photoId: string, input: WearAgain) {
    const { accountId } = yield* CurrentAccount
    yield* ownPhoto(parts, accountId, photoId)
    const garments = yield* storedAs(parts.photos.garmentsOf([photoId]))
    const pieceIds = [
      ...new Set(
        garments.flatMap(({ state, pieceId }) => (state === 'confirmed' && pieceId !== null ? [pieceId] : [])),
      ),
    ].slice(0, maximumLookPieces)
    if (pieceIds.length === 0) return yield* NothingConfirmed.make({})
    const look = yield* looks
      .createLook({
        operationId: input.operationId,
        name: input.name,
        pieceIds: pieceIds.map((id) => PieceId.make(id)),
      })
      .pipe(Effect.mapError((error) => (Predicate.isTagged(error, 'OperationConflict') ? error : unavailable())))
    yield* storedAs(parts.photos.setLook(accountId, photoId, look.id, yield* now))
    return look
  }),
  piecePhotos: Effect.fn('Styld.Photos.ofPiece')(function* (pieceId: string) {
    const { accountId } = yield* CurrentAccount
    yield* ownPiece(parts, accountId, pieceId)
    return yield* photosOf(parts, yield* storedAs(parts.photos.photosOfPiece(accountId, pieceId)))
  }),
  /** One of the account's photos, resized: none when it is not theirs or is gone. */
  photoImage: Effect.fn('Styld.Photos.image')(function* (photoId: string, size: ImageSize) {
    const { accountId } = yield* CurrentAccount
    const photo = yield* storedAs(parts.photos.findPhoto(accountId, photoId))
    if (Option.isNone(photo)) return Option.none<ShownImage>()
    const { originalKey: key, contentType } = photo.value
    const image = yield* deliverImage(parts.images, { key, contentType }, size).pipe(Effect.mapError(unavailable))
    return Option.map(image, (delivered): ShownImage => ({ ...delivered, version: `${photoId}.${size}` }))
  }),
  /** A garment found in one of the account's photos, at the grid's size. */
  garmentImage: Effect.fn('Styld.Photos.garmentImage')(function* (photoId: string, garmentId: string) {
    const { accountId } = yield* CurrentAccount
    if (Option.isNone(yield* storedAs(parts.photos.findPhoto(accountId, photoId)))) return Option.none<ShownImage>()
    const garment = (yield* storedAs(parts.photos.garmentsOf([photoId]))).find(({ id }) => id === garmentId)
    if (garment === undefined) return Option.none<ShownImage>()
    const stored = { key: garment.cutoutKey, contentType: 'image/png' }
    const image = yield* deliverImage(parts.images, stored, 'thumb').pipe(Effect.mapError(unavailable))
    return Option.map(image, (delivered): ShownImage => ({ ...delivered, version: garmentId }))
  }),
})

const operations = (parts: PhotoParts, looks: Looks['Service']) => ({ ...reading(parts), ...changing(parts, looks) })

/** The capture providers, metering and policy a photo's work uses. */
type Requirements = CaptureConfig | GarmentSegmenter | GarmentVision | PictureWork | Usage

/** Every operation with the providers it was built with: callers provide only `CurrentAccount`. */
const make = (parts: PhotoParts, looks: Looks['Service']) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<Requirements>()
    const bound =
      <Args extends ReadonlyArray<unknown>, A, E, R>(operation: (...args: Args) => Effect.Effect<A, E, R>) =>
      (...args: Args) =>
        Effect.provide(operation(...args), services)
    const all = operations(parts, looks)
    return {
      findGarments: bound(all.findGarments),
      failFinding: bound(all.failFinding),
      listPhotos: bound(all.listPhotos),
      addPhoto: bound(all.addPhoto),
      getPhoto: bound(all.getPhoto),
      updatePhoto: bound(all.updatePhoto),
      deletePhoto: bound(all.deletePhoto),
      matchGarment: bound(all.matchGarment),
      offerGarment: bound(all.offerGarment),
      wearAgain: bound(all.wearAgain),
      piecePhotos: bound(all.piecePhotos),
      photoImage: bound(all.photoImage),
      garmentImage: bound(all.garmentImage),
    }
  })

/** My Gallery for `CurrentAccount`, and its queue work. */
export class Photos extends Context.Service<Photos, Effect.Success<ReturnType<typeof make>>>()(
  '@styld/server/Photos',
) {}

export const makePhotos = make
