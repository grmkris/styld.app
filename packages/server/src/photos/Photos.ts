import {
  type AddPhoto,
  type AddPhotoToBoard,
  ImageType,
  LookId,
  OperationId,
  type MatchGarment,
  maximumLookPieces,
  NothingConfirmed,
  PieceId,
  type WearAgain,
  Photo,
  NotFound,
  UploadRefused,
  prices,
} from '@styld/protocol'
import { Context, Effect, Layer, Option, Predicate, Schema } from 'effect'
import { captureKey, enqueueMatch, readObject, storedAs, unavailable, writeObject } from '../capture/Parts.ts'
import type { CaptureRow, DetectionRow } from '../capture/Store.ts'
import { CurrentAccount } from '../CurrentAccount.ts'
import { Boards } from '../boards/Boards.ts'
import { Looks } from '../looks/Looks.ts'
import { receivedUpload, type Uploads } from '../mcp/ImageImport.ts'
import { deliverImage } from '../wardrobe/Delivery.ts'
import { accountPiece, usableUpload as wardrobeUpload } from '../wardrobe/Parts.ts'
import type { ShownImage } from '../wardrobe/Http.ts'
import type { ImageSize } from '../wardrobe/Media.ts'
import { cutOutPerson } from './Cutout.ts'
import { finding, makePhotoParts, type PhotoParts, photoHold, photoPrefix } from './Finding.ts'
import { Database } from '../kernel/Db.ts'
import { PieceQueue } from '../wardrobe/Processing.ts'
import { Wardrobe } from '../wardrobe/Wardrobe.ts'
import type { GarmentRow, PhotoRow } from './Store.ts'
import { nowDate } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { identify, once, priorResult, receiptRow, type Identified } from '../kernel/Receipts.ts'
import { deleteAfterRows, keysUnder, Media } from '../kernel/Media.ts'

// My Gallery for the website (owner, 2026-10-31): adding a photo spends its upload and holds a credit while Styld finds
// its garments; the person then confirms or corrects each match, marks favourites, and may delete a photo, which takes
// its objects with it. Every operation acts for `CurrentAccount`.

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

/** The account's own photo, or `NotFound`, as if another account's did not exist. */
const ownPhoto = (parts: PhotoParts, accountId: string, photoId: string) =>
  Effect.flatMap(
    storedAs(parts.photos.findPhoto(accountId, photoId)),
    Option.match({ onNone: () => Effect.fail(NotFound.make({})), onSome: Effect.succeed }),
  )

/** The account's own ready piece, or `NotFound` (`wardrobe/Parts.ts`). */
const ownPiece = (parts: PhotoParts, accountId: string, pieceId: string) =>
  accountPiece(parts.capture.wardrobeStore, accountId, pieceId).pipe(
    Effect.filterOrFail(
      (piece) => piece.status === 'ready',
      () => NotFound.make({}),
    ),
  )

/** A received image upload of this account that has not made anything yet (`wardrobe/Parts.ts`). */
const usableUpload = (parts: PhotoParts, accountId: string, uploadId: string) =>
  wardrobeUpload(parts.capture.wardrobeStore, accountId, uploadId).pipe(
    Effect.filterOrFail(
      ({ contentType }) => contentType.startsWith('image/'),
      () => UploadRefused.make({ reason: 'wrongType' }),
    ),
  )

const enqueue = (parts: PhotoParts, photoId: string) =>
  Effect.tryPromise({
    try: () => parts.capture.bindings.queue.send({ _tag: 'FindGarments', photoId }),
    catch: unavailable,
  })

/** The photo an operation already made, for the same upload; a conflict for another. A photo still being found goes
 * to the queue again, in case the first message never left. */
const replayed = (parts: PhotoParts, operation: Identified) =>
  Effect.gen(function* () {
    const { accountId, operationId } = operation
    const prior = yield* priorResult(
      operation,
      yield* storedAs(parts.capture.wardrobeStore.findReceipt(accountId, operationId)),
    )
    if (Option.isNone(prior)) return Option.none<PhotoRow>()
    const photo = yield* ownPhoto(parts, accountId, prior.value).pipe(Effect.mapError(unavailable))
    // Its credit is held again first (the same hold): the first request may have stopped before holding it.
    if (photo.status === 'finding') {
      yield* parts.capture.holds.reserve({ accountId, hold: photoHold(photo.id), credits: prices.galleryPhoto })
      yield* enqueue(parts, photo.id)
    }
    return Option.some(photo)
  })

/** Hold the credit, then write the photo and spend its upload; give the credit back if the write fails. */
const added = (parts: PhotoParts, operation: Identified, input: AddPhoto) =>
  Effect.gen(function* () {
    const { accountId } = operation
    const upload = yield* usableUpload(parts, accountId, input.uploadId)
    const id = yield* newId('ph')
    const at = yield* nowDate
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
    // The photo first, then its credit: every hold has a row its sweep can settle. Past the daily limit the photo is
    // undone and its upload can be used again.
    yield* storedAs(parts.photos.addPhoto(row, yield* receiptRow(operation, id)))
    yield* parts.capture.holds
      .reserve({ accountId, hold: photoHold(id), credits: prices.galleryPhoto })
      .pipe(
        Effect.tapErrorTag('LimitReached', () =>
          storedAs(parts.photos.undoPhoto(row, operation.operationId)).pipe(
            Effect.ignore({ log: true, message: 'Styld.Photos.add could not undo a photo past the limit' }),
          ),
        ),
      )
    yield* enqueue(parts, id)
    return row
  })

/** The photo's objects, once its row is gone: its original upload, and everything under its own prefix. */
const deleteObjects = (parts: PhotoParts, row: PhotoRow) =>
  Effect.gen(function* () {
    const bucket = parts.capture.bindings.bucket
    const listed = yield* keysUnder(bucket, photoPrefix(row.accountId, row.id)).pipe(Effect.orElseSucceed(() => []))
    yield* deleteAfterRows(bucket, [row.originalKey, ...listed], 'photo')
  })

/** A garment offered to the review tray, as a capture of its own (source `photos`, no credit). Its picture is copied
 * under the capture, so the photo and the tray never share an object; a cut-out is compared with the wardrobe there,
 * so the tray asks "Already in your wardrobe?" rather than adding a silent duplicate. */
const offered = (parts: PhotoParts, photo: PhotoRow, garment: GarmentRow) =>
  Effect.gen(function* () {
    const captureId = yield* newId('cp')
    const detectionId = yield* newId('dt')
    const bytes = yield* readObject(parts.capture, garment.cutoutKey)
    if (Option.isNone(bytes)) return yield* unavailable()
    const contentType = 'image/png'
    const key = captureKey(photo.accountId, captureId, `${detectionId}.png`)
    yield* writeObject(parts.capture, key, bytes.value, contentType)
    const at = yield* nowDate
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
      cutoutKey: key,
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
      matching: garment.type === null ? null : 'waiting',
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
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'addPhoto',
      input: [input.uploadId],
    })
    const earlier = yield* replayed(parts, operation)
    const row = Option.isSome(earlier) ? earlier.value : yield* added(parts, operation, input)
    return yield* toPhoto(row, [])
  }),
  getPhoto: Effect.fn('Styld.Photos.get')(function* (photoId: string) {
    const { accountId } = yield* CurrentAccount
    const [photo] = yield* photosOf(parts, [yield* ownPhoto(parts, accountId, photoId)])
    return photo ?? (yield* NotFound.make({}))
  }),
})

/** Changing a photo: favourite, delete, match, offer and wear again. */
const changing = (parts: PhotoParts, looks: Looks['Service']) => ({
  updatePhoto: Effect.fn('Styld.Photos.update')(function* (photoId: string, input: { readonly favourite: boolean }) {
    const { accountId } = yield* CurrentAccount
    const updated = yield* storedAs(parts.photos.setFavourite(accountId, photoId, input.favourite, yield* nowDate))
    if (Option.isNone(updated)) return yield* NotFound.make({})
    const [photo] = yield* photosOf(parts, [updated.value])
    return photo ?? (yield* NotFound.make({}))
  }),
  /** Delete a photo: its row and garments first, then its objects. */
  deletePhoto: Effect.fn('Styld.Photos.delete')(function* (photoId: string) {
    const { accountId } = yield* CurrentAccount
    const deleted = yield* storedAs(parts.photos.deletePhoto(accountId, photoId))
    if (Option.isNone(deleted)) return yield* NotFound.make({})
    yield* deleteObjects(parts, deleted.value)
  }),
  matchGarment: Effect.fn('Styld.Photos.match')(function* (photoId: string, garmentId: string, input: MatchGarment) {
    const { accountId } = yield* CurrentAccount
    yield* ownPhoto(parts, accountId, photoId)
    if (input.pieceId !== null) yield* ownPiece(parts, accountId, input.pieceId)
    if (!(yield* storedAs(parts.photos.matchGarment(accountId, photoId, garmentId, input.pieceId))))
      return yield* NotFound.make({})
    const [photo] = yield* photosOf(parts, [yield* ownPhoto(parts, accountId, photoId)])
    return photo ?? (yield* NotFound.make({}))
  }),
  /** Offer a garment to the review tray, once: offering it again answers the photo as it is. */
  offerGarment: Effect.fn('Styld.Photos.offer')(function* (photoId: string, garmentId: string) {
    const { accountId } = yield* CurrentAccount
    const photo = yield* ownPhoto(parts, accountId, photoId)
    const garment = (yield* storedAs(parts.photos.garmentsOf([photoId]))).find(({ id }) => id === garmentId)
    if (garment === undefined) return yield* NotFound.make({})
    if (garment.state !== 'offered') yield* offered(parts, photo, garment)
    const [shown] = yield* photosOf(parts, [photo])
    return shown ?? (yield* NotFound.make({}))
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
    yield* storedAs(parts.photos.setLook(accountId, photoId, look.id, yield* nowDate))
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

/** What a photo's page leans on beyond its own store: looks to wear it again, boards and uploads to pin it. */
export interface PhotoServices {
  readonly looks: Looks['Service']
  readonly boards: Pick<Boards['Service'], 'addPhotoImage' | 'addPins'>
  readonly uploads: Uploads
}

/** The board operations a photo goes on a board under: keyed by the photo and the board, so putting the photo on the
 * same board again, whatever the request's id, answers the same picture and the same look pin. Ids are at most 64
 * characters: the photo's and the board's are 25 each. */
const boardOperations = (photoId: string, boardId: string) => ({
  image: OperationId.make(`pi-${photoId}-${boardId}`.slice(0, 64)),
  look: OperationId.make(`pl-${photoId}-${boardId}`.slice(0, 64)),
})

/** The photo's picture for a board (the person cut out of it once there is one) as a received upload. */
const photoUpload = (parts: PhotoParts, services: PhotoServices, photo: PhotoRow) =>
  Effect.gen(function* () {
    const bytes = yield* readObject(parts.capture, photo.cutoutKey ?? photo.originalKey)
    if (Option.isNone(bytes)) return yield* unavailable()
    const contentType = yield* Schema.decodeUnknownEffect(ImageType)(
      photo.cutoutKey === null ? photo.contentType : 'image/png',
    ).pipe(Effect.mapError(unavailable))
    return yield* receivedUpload(services.uploads, { contentType, bytes: bytes.value }).pipe(
      Effect.mapError(unavailable),
    )
  })

/** A board's refusal as the photo's: a board that is not the person's stays so, anything else is unavailable. */
const onBoard = <A, E>(effect: Effect.Effect<A, E, CurrentAccount>) =>
  effect.pipe(Effect.mapError((error) => (Predicate.isTagged(error, 'NotFound') ? error : unavailable())))

/** A photo for collages: the person cut out of it, and putting it on a board as its own picture (the cut-out once
 * there is one), held back from visitors, with the look worn from it. A retried request whose picture is on the board
 * already answers as done. */
const boarding = (parts: PhotoParts, services: PhotoServices) => ({
  /** Cut the person out of the photo for collages, once; free. */
  cutOut: Effect.fn('Styld.Photos.cutOut')(function* (photoId: string) {
    const { accountId } = yield* CurrentAccount
    yield* cutOutPerson(parts, yield* ownPhoto(parts, accountId, photoId))
    const [shown] = yield* photosOf(parts, [yield* ownPhoto(parts, accountId, photoId)])
    return shown ?? (yield* NotFound.make({}))
  }),
  /** Put the photo on one of the person's boards, once: a repeat of the operation answers done, and the photo's
   * picture is uploaded only until the board holds it. */
  addToBoard: Effect.fn('Styld.Photos.addToBoard')(function* (photoId: string, input: AddPhotoToBoard) {
    const { accountId } = yield* CurrentAccount
    const photo = yield* ownPhoto(parts, accountId, photoId)
    const onBoardOnce = Effect.gen(function* () {
      const operations = boardOperations(photo.id, input.boardId)
      const placed = yield* storedAs(parts.capture.wardrobeStore.findReceipt(accountId, operations.image))
      if (Option.isNone(placed)) {
        const uploadId = yield* photoUpload(parts, services, photo)
        yield* onBoard(services.boards.addPhotoImage(input.boardId, { operationId: operations.image, uploadId }))
      }
      if (photo.lookId !== null)
        yield* onBoard(
          services.boards.addPins(input.boardId, {
            operationId: operations.look,
            lookIds: [LookId.make(photo.lookId)],
          }),
        )
    })
    yield* once(
      parts.capture.wardrobeStore,
      { accountId, operationId: input.operationId, command: 'addPhotoToBoard', input: [photoId, input.boardId] },
      { replay: () => Effect.void, run: Effect.as(onBoardOnce, [undefined, photoId] as const) },
    )
  }),
})

const operations = (parts: PhotoParts, services: PhotoServices) => ({
  ...reading(parts),
  ...changing(parts, services.looks),
  ...boarding(parts, services),
})

/** My Gallery over the application's database, media and piece queue, with the looks, boards and uploads it leans
 * on. Callers provide only `CurrentAccount`. */
const make = Effect.gen(function* () {
  const database = yield* Database
  const media = yield* Media
  const parts = yield* makePhotoParts({
    database: database.$client,
    bucket: media.bucket,
    images: media.images,
    queue: yield* PieceQueue,
  })
  return operations(parts, { looks: yield* Looks, boards: yield* Boards, uploads: yield* Wardrobe })
})

/** My Gallery for `CurrentAccount`, and its queue work. */
export class Photos extends Context.Service<Photos, Effect.Success<typeof make>>()('@styld/server/photos/Photos') {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Photos.of(service)),
  )
}
