import {
  type AddPhoto,
  type AddPhotoToBoard,
  CurrentAccount,
  ImageType,
  LookId,
  type AddPhotoPiece,
  type MatchGarment,
  type UpdatePhoto,
  maximumLookPieces,
  NotFound,
  NothingConfirmed,
  OperationId,
  Photo,
  type PhotoPicture,
  PieceId,
  prices,
  UploadRefused,
  type WearAgain,
  Unavailable,
} from '@styld/protocol'
import { Context, Effect, Layer, Option, Predicate, Schema } from 'effect'
import { captureKey, enqueueMatch, readObject, writeObject } from '../capture/Shared.ts'
import type { CaptureRow, DetectionRow } from '../capture/Store.ts'
import { Boards } from '../boards/Boards.ts'
import { Looks } from '../looks/Looks.ts'
import { receivedUpload } from '../wardrobe/Received.ts'
import { imageAddresses, SignedMedia } from '../kernel/SignedMedia.ts'
import { accountPiece, usableUpload as wardrobeUpload } from '../wardrobe/Shared.ts'
import { cutOutPerson } from './Cutout.ts'
import { refinding } from './Refind.ts'
import { finding, type PhotoServices, photoHold } from './Finding.ts'
import { PieceQueue } from '../wardrobe/Processing.ts'
import { Wardrobe } from '../wardrobe/Wardrobe.ts'
import type { GarmentRow, PhotoRow } from './Store.ts'
import { nowDate, stored } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { deleting, identify, madeBefore, once, receiptRow, type Identified } from '../kernel/Receipts.ts'
import { deleteAfterRows, Media } from '../kernel/Media.ts'
import { clearOwed } from '../kernel/MediaDeletions.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { owedPhotoOf, PhotoStore } from './Store.ts'
import { Holds } from '../usage/Holds.ts'
import { called } from '../kernel/Bindings.ts'

// My Gallery for the website (owner, 2026-10-31): adding a photo spends its upload and holds a credit while Styld finds
// its garments; the person then confirms or corrects each match, marks favourites, and may delete a photo, which takes
// its objects with it. Every operation acts for `CurrentAccount`.

/** A stored photo as the protocol shows it. A confirmed garment whose piece was deleted shows as unmatched. Only the
 * service writes rows, through the same schemas; one that does not decode is a bug. */
const toPhoto = Effect.fnUntraced(function* (row: PhotoRow, garments: ReadonlyArray<GarmentRow>) {
  // The original is signed first: an assistant view keeps each photo's first thumbnail, the photo as taken, which is
  // a try-on's "before" (`mcp/MediaViewTools.ts`), never the person cut out of it.
  const images = yield* imageAddresses({
    entityId: row.id,
    key: row.originalKey,
    contentType: row.contentType,
    version: String(row.updatedAt.getTime()),
  })
  const cutoutImages =
    row.cutoutKey === null
      ? Option.none()
      : yield* imageAddresses({
          entityId: row.id,
          key: row.cutoutKey,
          contentType: 'image/png',
          version: row.cutoutKey,
        })
  // A piece added by hand whose piece was deleted is nothing of the photo any more, so it is not shown.
  const shownGarments = yield* Effect.forEach(
    garments.filter(
      ({ photoId, cutoutKey, pieceId }) => photoId === row.id && (cutoutKey !== null || pieceId !== null),
    ),
    (garment) =>
      Effect.gen(function* () {
        // A garment added by hand has no cut-out yet, so no picture.
        const image =
          garment.cutoutKey === null
            ? Option.none()
            : yield* (yield* SignedMedia).address({
                entityId: garment.id,
                key: garment.cutoutKey,
                contentType: 'image/png',
                variant: 'thumb',
                version: garment.cutoutKey,
              })
        return {
          id: garment.id,
          type: garment.type,
          colours: garment.colours,
          match: garment.pieceId === null && garment.state !== 'offered' ? 'unmatched' : garment.state,
          pieceId: garment.pieceId,
          ...Option.match(image, { onNone: () => ({}), onSome: (address) => ({ image: address }) }),
        }
      }),
  )
  return yield* Schema.decodeUnknownEffect(Photo)({
    id: row.id,
    status: row.status,
    favourite: row.favourite,
    garments: shownGarments,
    lookId: row.lookId,
    hasCutout: row.cutoutKey !== null,
    createdAt: row.createdAt.toISOString(),
    ...Option.match(images, { onNone: () => ({}), onSome: (addresses) => ({ images: addresses }) }),
    ...Option.match(cutoutImages, { onNone: () => ({}), onSome: (addresses) => ({ cutoutImages: addresses }) }),
  }).pipe(Effect.orDie)
})

/** Photos as the protocol shows them, each with its garments. */
const photosOf = (rows: ReadonlyArray<PhotoRow>) =>
  Effect.gen(function* () {
    const garments = yield* stored((yield* PhotoStore).garmentsOf(rows.map(({ id }) => id)))
    return yield* Effect.forEach(rows, (row) => toPhoto(row, garments))
  })

/** The account's own photo, or `NotFound`, as if another account's did not exist. */
const ownPhoto = (accountId: string, photoId: string) =>
  Effect.flatMap(
    stored(Effect.flatMap(PhotoStore, (store) => store.findPhoto(accountId, photoId))),
    Option.match({ onNone: () => Effect.fail(NotFound.make({})), onSome: Effect.succeed }),
  )

/** The account's own photo as it stands, as the protocol shows it. */
const shownPhoto = (accountId: string, photoId: string) =>
  Effect.gen(function* () {
    const [photo] = yield* photosOf([yield* ownPhoto(accountId, photoId)])
    return photo ?? (yield* NotFound.make({}))
  })

/** A change to a photo done once per operation id (`once`): a repeat answers the photo as it stands and changes
 * nothing, so a late repeat never undoes a later change; the same id for anything else is `OperationConflict`. */
const changedOnce = <E, R>(
  operation: { readonly operationId: string; readonly command: string; readonly input: unknown },
  photoId: string,
  change: Effect.Effect<unknown, E, R>,
) =>
  Effect.gen(function* () {
    const { accountId } = yield* CurrentAccount
    return yield* once(
      yield* WardrobeStore,
      { accountId, ...operation },
      {
        replay: () => shownPhoto(accountId, photoId),
        run: Effect.andThen(
          change,
          Effect.map(shownPhoto(accountId, photoId), (photo) => [photo, photoId] as const),
        ),
      },
    )
  })

/** The account's own ready piece, or `NotFound` (`wardrobe/Shared.ts`). */
const ownPiece = (accountId: string, pieceId: string) =>
  accountPiece(accountId, pieceId).pipe(
    Effect.filterOrFail(
      (piece) => piece.status === 'ready',
      () => NotFound.make({}),
    ),
  )

/** A received image upload of this account that has not made anything yet (`wardrobe/Shared.ts`). */
const usableUpload = (accountId: string, uploadId: string) =>
  wardrobeUpload(accountId, uploadId).pipe(
    Effect.filterOrFail(
      ({ contentType }) => contentType.startsWith('image/'),
      () => UploadRefused.make({ reason: 'wrongType' }),
    ),
  )

const enqueue = (photoId: string) =>
  Effect.flatMap(PieceQueue, (queue) => called(() => queue.send({ _tag: 'FindGarments', photoId })))

/** The photo an operation already made, for the same upload; a conflict for another. A photo still being found goes
 * to the queue again, in case the first message never left. */
const replayed = (operation: Identified) =>
  Effect.gen(function* () {
    const made = yield* madeBefore(yield* WardrobeStore, operation)
    if (Option.isNone(made)) return Option.none<PhotoRow>()
    const { accountId } = operation
    const photo = yield* ownPhoto(accountId, made.value).pipe(Effect.mapError(() => Unavailable.make({})))
    // Its credit is held again first (the same hold): the first request may have stopped before holding it.
    if (photo.status === 'finding') {
      yield* (yield* Holds).reserve({ accountId, hold: photoHold(photo.id), credits: prices.galleryPhoto })
      yield* enqueue(photo.id)
    }
    return Option.some(photo)
  })

/** Hold the credit, then write the photo and spend its upload; give the credit back if the write fails. */
const added = (operation: Identified, input: AddPhoto) =>
  Effect.gen(function* () {
    const { accountId } = operation
    const upload = yield* usableUpload(accountId, input.uploadId)
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
    yield* stored((yield* PhotoStore).addPhoto(row, yield* receiptRow(operation, id)))
    yield* (yield* Holds)
      .reserve({ accountId, hold: photoHold(id), credits: prices.galleryPhoto })
      .pipe(
        Effect.tapErrorTag('LimitReached', () =>
          stored(Effect.flatMap(PhotoStore, (store) => store.undoPhoto(row, operation.operationId))).pipe(
            Effect.ignore({ log: true, message: 'Styld.Photos.add could not undo a photo past the limit' }),
          ),
        ),
      )
    yield* enqueue(id)
    return row
  })

/** The photo's objects, once its row is gone: its original upload, and everything under its own prefix, which its
 * delete recorded as owed (`kernel/MediaDeletions.ts`), so what R2 cannot remove now the sweep removes later. */
const deleteObjects = (row: PhotoRow) =>
  Effect.gen(function* () {
    const bucket = (yield* Media).bucket
    yield* deleteAfterRows(bucket, [row.originalKey], 'photo')
    yield* clearOwed((yield* PhotoStore).owedMedia, bucket, [owedPhotoOf(row.accountId, row.id)])
  })

/** A garment offered to the review tray, as a capture of its own (source `photos`, no credit). Its picture is copied
 * under the capture, so the photo and the tray never share an object; a cut-out is compared with the wardrobe there,
 * so the tray asks "Already in your wardrobe?" rather than adding a silent duplicate. */
const offered = (photo: PhotoRow, garment: GarmentRow) =>
  Effect.gen(function* () {
    const captureId = yield* newId('cp')
    const detectionId = yield* newId('dt')
    // A garment added by hand has no cut-out to offer yet.
    const bytes = garment.cutoutKey === null ? Option.none() : yield* readObject(garment.cutoutKey)
    if (Option.isNone(bytes)) return yield* Unavailable.make({})
    const contentType = 'image/png'
    const key = captureKey(photo.accountId, captureId, `${detectionId}.png`)
    yield* writeObject(key, bytes.value, contentType)
    const at = yield* nowDate
    const capture = {
      id: captureId,
      accountId: photo.accountId,
      kind: 'photo',
      source: 'photos',
      status: 'review',
      uploadId: null,
      garmentId: garment.id,
      originalKey: key,
      contentType,
      bytes: bytes.value.byteLength,
      side: null,
      pairsWith: null,
      route: null,
      provider: null,
      providerFileId: null,
      frameCount: null,
      durationMs: null,
      width: null,
      height: null,
      credits: 0,
      attempt: 0,
      importId: null,
      trackingStartedAt: null,
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
      confidence: null,
      preselected: true,
      suggestedType: garment.type,
      suggestedAlternative: null,
      suggestedColours: garment.colours,
      suggestedSeasons: [],
      suggestedRainproof: false,
      suggestedCategory: null,
      suggestedOccasions: [],
      suggestedPattern: null,
      whole: null,
      groupOf: null,
      duplicateOf: null,
      matching: garment.type === null ? null : 'waiting',
      matchClaimedAt: null,
      createdAt: at,
    } satisfies DetectionRow
    yield* stored((yield* PhotoStore).offerGarment(garment.id, capture, detection))
    if (detection.matching === 'waiting') yield* enqueueMatch(captureId)
  })

/** Reading and adding photos, and the queue's work. */
const reading = Effect.map(Effect.context<PhotoServices>(), (context) => ({
  listPhotos: Effect.fn('Styld.Photos.list')(function* () {
    const { accountId } = yield* CurrentAccount
    return yield* photosOf(yield* stored((yield* PhotoStore).listPhotos(accountId)))
  }, Effect.provide(context)),
  addPhoto: Effect.fn('Styld.Photos.add')(function* (input: AddPhoto) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'addPhoto',
      input: [input.uploadId],
    })
    const earlier = yield* replayed(operation)
    const row = Option.isSome(earlier) ? earlier.value : yield* added(operation, input)
    return yield* toPhoto(row, [])
  }, Effect.provide(context)),
  getPhoto: Effect.fn('Styld.Photos.get')(function* (photoId: string) {
    const { accountId } = yield* CurrentAccount
    const [photo] = yield* photosOf([yield* ownPhoto(accountId, photoId)])
    return photo ?? (yield* NotFound.make({}))
  }, Effect.provide(context)),
}))

/** Changing a photo: favourite, delete, match, offer and wear again. */
const changing = Effect.map(Effect.context<PhotoServices>(), (context) => ({
  updatePhoto: Effect.fn('Styld.Photos.update')(function* (photoId: string, input: typeof UpdatePhoto.Type) {
    const { accountId } = yield* CurrentAccount
    const change = Effect.gen(function* () {
      const updated = yield* stored(
        (yield* PhotoStore).setFavourite(accountId, photoId, input.favourite, yield* nowDate),
      )
      if (Option.isNone(updated)) return yield* NotFound.make({})
    })
    const operation = { operationId: input.operationId, command: 'updatePhoto', input: [photoId, input.favourite] }
    return yield* changedOnce(operation, photoId, change)
  }, Effect.provide(context)),
  /** Delete a photo: its row and garments first, then its objects. A repeat of the same delete answers done. */
  deletePhoto: Effect.fn('Styld.Photos.delete')(function* (photoId: string, operationId: OperationId) {
    const { accountId } = yield* CurrentAccount
    const deletion = { accountId, operationId, command: 'deletePhoto', target: photoId }
    yield* deleting(yield* WardrobeStore, deletion, (receipt) =>
      Effect.gen(function* () {
        const deleted = yield* stored((yield* PhotoStore).deletePhoto(accountId, photoId, receipt))
        if (Option.isNone(deleted)) return yield* NotFound.make({})
        // A photo deleted while its garments were being found gets its credit back: no delivery will settle it now.
        if (deleted.value.status === 'finding') yield* (yield* Holds).settle(accountId, photoHold(photoId), 'failed')
        yield* deleteObjects(deleted.value)
      }),
    )
  }, Effect.provide(context)),
  /** "Wear it again": the photo's confirmed pieces as a look, remembered on the photo. Repeating the operation answers
   * the same look. */
  wearAgain: Effect.fn('Styld.Photos.wearAgain')(function* (photoId: string, input: WearAgain) {
    const { accountId } = yield* CurrentAccount
    yield* ownPhoto(accountId, photoId)
    const garments = yield* stored((yield* PhotoStore).garmentsOf([photoId]))
    const pieceIds = [
      ...new Set(
        garments.flatMap(({ state, pieceId }) => (state === 'confirmed' && pieceId !== null ? [pieceId] : [])),
      ),
    ].slice(0, maximumLookPieces)
    if (pieceIds.length === 0) return yield* NothingConfirmed.make({})
    const look = yield* (yield* Looks)
      .createLook({
        operationId: input.operationId,
        name: input.name,
        pieceIds: pieceIds.map((id) => PieceId.make(id)),
      })
      .pipe(Effect.mapError((error) => (Predicate.isTagged(error, 'OperationConflict') ? error : Unavailable.make({}))))
    yield* stored((yield* PhotoStore).setLook(accountId, photoId, look.id, yield* nowDate))
    return look
  }, Effect.provide(context)),
}))

/** Showing photos: a piece's, and their pictures. */
const showing = Effect.map(Effect.context<PhotoServices>(), (context) => ({
  piecePhotos: Effect.fn('Styld.Photos.ofPiece')(function* (pieceId: string) {
    const { accountId } = yield* CurrentAccount
    yield* ownPiece(accountId, pieceId)
    return yield* photosOf(yield* stored((yield* PhotoStore).photosOfPiece(accountId, pieceId)))
  }, Effect.provide(context)),
}))

/** The board operations a photo's picture goes on a board under: keyed by the photo, the picture and the board, so
 * putting the same picture on the same board again, whatever the request's id, answers the same picture; the photo and
 * its cut-out are two pictures, and the look pin is the photo's either way. The table's is keyed by the picture on the
 * board, so a picture taken off and put back is laid out again. Ids are at most 64 characters: the photo's and the
 * board's are 25 each. */
const boardOperations = (photoId: string, picture: PhotoPicture, boardId: string) => ({
  image: OperationId.make(`${picture === 'cutout' ? 'pc' : 'pi'}-${photoId}-${boardId}`.slice(0, 64)),
  look: OperationId.make(`pl-${photoId}-${boardId}`.slice(0, 64)),
  table: (imageId: string) => OperationId.make(`pt-${imageId}`.slice(0, 64)),
})

/** One of the photo's pictures for a board, the photo or the person cut out of it, as a received upload. A photo
 * with no cut-out has no cut-out to give. */
const photoUpload = (photo: PhotoRow, picture: PhotoPicture) =>
  Effect.gen(function* () {
    const key = picture === 'cutout' ? photo.cutoutKey : photo.originalKey
    if (key === null) return yield* Unavailable.make({})
    const bytes = yield* readObject(key)
    if (Option.isNone(bytes)) return yield* Unavailable.make({})
    const contentType = yield* Schema.decodeUnknownEffect(ImageType)(
      picture === 'cutout' ? 'image/png' : photo.contentType,
    ).pipe(Effect.mapError(() => Unavailable.make({})))
    return yield* receivedUpload(yield* Wardrobe, { contentType, bytes: bytes.value }).pipe(
      Effect.mapError(() => Unavailable.make({})),
    )
  })

/** A board's refusal as the photo's: a board that is not the person's stays so, anything else is unavailable. */
const onBoard = <A, E>(effect: Effect.Effect<A, E, CurrentAccount>) =>
  effect.pipe(Effect.mapError((error) => (Predicate.isTagged(error, 'NotFound') ? error : Unavailable.make({}))))

/** A photo for collages: the person cut out of it, and putting it on a board as its own picture (the photo or its
 * cut-out, as the person chose), held back from visitors, with the look worn from it. A retried request whose picture is on the board
 * already answers as done. */
const boarding = Effect.map(Effect.context<PhotoServices>(), (context) => ({
  /** Cut the person out of the photo for collages, once; free. */
  cutOut: Effect.fn('Styld.Photos.cutOut')(function* (photoId: string, operationId: string) {
    const { accountId } = yield* CurrentAccount
    const change = Effect.flatMap(ownPhoto(accountId, photoId), cutOutPerson)
    return yield* changedOnce({ operationId, command: 'cutOutPerson', input: photoId }, photoId, change)
  }, Effect.provide(context)),
  /** Put the photo on one of the person's boards, once, and answer its picture: a repeat of the operation answers the
   * same picture, and the photo's picture is uploaded only until the board holds it. Unless the request says not to,
   * the picture is laid on the board's table too (the board's own page lays it in the table it edits). */
  addToBoard: Effect.fn('Styld.Photos.addToBoard')(function* (photoId: string, input: AddPhotoToBoard) {
    const { accountId } = yield* CurrentAccount
    const photo = yield* ownPhoto(accountId, photoId)
    const placeOnTable = input.placeOnTable !== false
    const boards = yield* Boards
    const operations = boardOperations(photo.id, input.picture, input.boardId)
    const onBoardOnce = Effect.gen(function* () {
      const spot = yield* onBoard(
        boards.pictureSpot(input.boardId, [operations.image, OperationId.make(`pr-${input.operationId}`.slice(0, 64))]),
      )
      const image = Predicate.isTagged(spot, 'Held')
        ? spot.image
        : yield* onBoard(
            boards.addPhotoImage(input.boardId, {
              operationId: spot.operationId,
              uploadId: yield* photoUpload(photo, input.picture),
            }),
          )
      if (placeOnTable)
        yield* onBoard(
          boards.arrangeBoard(input.boardId, {
            operationId: operations.table(image.imageId),
            layout: 'keep',
            add: [{ _tag: 'TablePicture', imageId: image.imageId }],
          }),
        )
      if (photo.lookId !== null)
        yield* onBoard(
          boards.addPins(input.boardId, { operationId: operations.look, lookIds: [LookId.make(photo.lookId)] }),
        )
      return [image, image.imageId] as const
    })
    return yield* once(
      yield* WardrobeStore,
      {
        accountId,
        operationId: input.operationId,
        command: 'addPhotoToBoard',
        input: placeOnTable ? [photoId, input.boardId] : [photoId, input.boardId, 'pinOnly'],
      },
      { replay: (imageId) => onBoard(boards.boardPicture(input.boardId, imageId)), run: onBoardOnce },
    )
  }, Effect.provide(context)),
}))

/** Matching a photo's garments: confirmed, offered to the review tray, or added and taken off by hand. */
const matching = Effect.map(Effect.context<PhotoServices>(), (context) => ({
  /** Confirm a garment as a piece, or say it is none of them. A garment waiting in the review tray stays there (its
   * card keeping it is what confirms it), and a piece added by hand that is none of them is taken off the photo. */
  matchGarment: Effect.fn('Styld.Photos.match')(function* (photoId: string, garmentId: string, input: MatchGarment) {
    const { accountId } = yield* CurrentAccount
    const change = Effect.gen(function* () {
      yield* ownPhoto(accountId, photoId)
      const store = yield* PhotoStore
      const garment = (yield* stored(store.garmentsOf([photoId]))).find(({ id }) => id === garmentId)
      if (garment === undefined) return yield* NotFound.make({})
      if (garment.state === 'offered') return
      if (input.pieceId !== null) yield* ownPiece(accountId, input.pieceId)
      if (garment.cutoutKey === null && input.pieceId === null)
        return yield* stored(store.removeAddedGarment(accountId, photoId, garmentId))
      yield* stored(store.matchGarment(accountId, photoId, garmentId, input.pieceId))
    })
    const operation = {
      operationId: input.operationId,
      command: 'matchGarment',
      input: [photoId, garmentId, input.pieceId],
    }
    return yield* changedOnce(operation, photoId, change)
  }, Effect.provide(context)),
  /** Add one of the person's pieces to a ready photo by hand, as a confirmed garment after the ones found; a piece
   * already confirmed in it is left as it is. A photo still being found is refused for now: its garments are about to
   * be written. */
  addPiece: Effect.fn('Styld.Photos.addPiece')(function* (photoId: string, input: AddPhotoPiece) {
    const { accountId } = yield* CurrentAccount
    const change = Effect.gen(function* () {
      const photo = yield* ownPhoto(accountId, photoId)
      const piece = yield* ownPiece(accountId, input.pieceId)
      if (photo.status !== 'ready') return yield* Unavailable.make({})
      const store = yield* PhotoStore
      const garments = yield* stored(store.garmentsOf([photoId]))
      if (garments.some(({ state, pieceId }) => state === 'confirmed' && pieceId === piece.id)) return
      const garment: GarmentRow = {
        id: yield* newId('pg'),
        photoId,
        accountId,
        position: Math.max(-1, ...garments.map(({ position }) => position)) + 1,
        cutoutKey: null,
        type: piece.type,
        colours: [],
        pieceId: piece.id,
        state: 'confirmed',
      }
      if (!(yield* stored(store.addGarment(garment)))) return yield* Unavailable.make({})
    })
    const operation = { operationId: input.operationId, command: 'addPhotoPiece', input: [photoId, input.pieceId] }
    return yield* changedOnce(operation, photoId, change)
  }, Effect.provide(context)),
  /** Offer a garment to the review tray, once: offering it again answers the photo as it is. */
  offerGarment: Effect.fn('Styld.Photos.offer')(function* (photoId: string, garmentId: string, operationId: string) {
    const { accountId } = yield* CurrentAccount
    const change = Effect.gen(function* () {
      const photo = yield* ownPhoto(accountId, photoId)
      const garment = (yield* stored((yield* PhotoStore).garmentsOf([photoId]))).find(({ id }) => id === garmentId)
      if (garment === undefined) return yield* NotFound.make({})
      if (garment.state !== 'offered') yield* offered(photo, garment)
    })
    return yield* changedOnce({ operationId, command: 'offerGarment', input: [photoId, garmentId] }, photoId, change)
  }, Effect.provide(context)),
}))

/** My Gallery over the services its operations yield (`PhotoServices`): its own store, capture's stores and garment
 * pipeline, media, the piece queue, credits, and the looks, boards and uploads it leans on. Callers provide only
 * `CurrentAccount`. */
const make = Effect.gen(function* () {
  return {
    ...(yield* finding),
    ...(yield* reading),
    ...(yield* changing),
    ...(yield* matching),
    ...(yield* refinding),
    ...(yield* showing),
    ...(yield* boarding),
  }
})

/** My Gallery for `CurrentAccount`, and its queue work. */
export class Photos extends Context.Service<Photos, Effect.Success<typeof make>>()('@styld/server/photos/Photos') {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Photos.of(service)),
  )
}
