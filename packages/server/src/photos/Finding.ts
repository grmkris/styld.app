import { Effect, Option } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as Base64Url from 'effect/encoding/Base64Url'
import { comparedTypes, sameAs } from '../capture/Matching.ts'
import { type CaptureBindings, makeParts, readObject, storedAs, unavailable, writeObject } from '../capture/Parts.ts'
import { type CutPiece, morePrompts, samPieces, verdictOf } from '../capture/PhotoPipeline.ts'
import { CaptureConfig } from '../capture/Policy.ts'
import { GarmentVision, PictureWork } from '../capture/Providers.ts'
import { Usage } from '../capture/Usage.ts'
import type { ImageBindings } from '../wardrobe/Delivery.ts'
import { accountPrefix } from '../wardrobe/Media.ts'
import { type GarmentRow, makePhotoStore, type PhotoRow } from './Store.ts'
import { nowDate } from '../kernel/Db.ts'

// Finding the garments in an outfit photo, one delivery of the piece queue at a time (owner, 2026-10-31). The same
// cutting and suggesting as capture, without the held-piece rule: every garment the person wears counts. Each is
// compared with the wardrobe's pieces in its place; the person confirms or corrects the match.

/** What a photo's work shares: capture's parts (bindings, stores, objects), the Images binding its routes resize
 * with, the photo store and its ids. */
export const makePhotoParts = (bindings: CaptureBindings & ImageBindings) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    return {
      capture: yield* makeParts(bindings),
      images: { bucket: bindings.bucket, images: bindings.images } satisfies ImageBindings,
      photos: makePhotoStore(bindings.database),
      newId: (prefix: 'ph' | 'pg') =>
        crypto.randomBytes(16).pipe(
          Effect.map((bytes) => `${prefix}_${Base64Url.encode(bytes)}`),
          Effect.mapError(unavailable),
        ),
    }
  })
export type PhotoParts = Effect.Success<ReturnType<typeof makePhotoParts>>

/** Where a photo's own objects live, under the account's prefix so deleting the account sweeps them. */
export const photoPrefix = (accountId: string, photoId: string) => `${accountPrefix(accountId)}photos/${photoId}/`

/** The Wallet operation holding a photo's credit. */
export const photoHold = (photoId: string) => `photo/${photoId}`

/** The most garments one photo keeps, the largest first. */
const mostGarments = 8

/** How sure Clef must be that a worn garment is one of the person's pieces before Styld suggests it. Lower than
 * capture's bar (0.8): a worn garment is folded and partly hidden, and the person confirms every match. */
const wornMatchBar = 0.6

/** One cut-out garment: what Clef takes it for, stored, and matched with the wardrobe's pieces in its place. A scrap
 * is none. */
const garmentOf = (parts: PhotoParts, photo: PhotoRow, piece: CutPiece, position: number) =>
  Effect.gen(function* () {
    const policy = yield* CaptureConfig
    const small = { bytes: yield* (yield* PictureWork).thumbnail(piece.png, 512), contentType: 'image/webp' } as const
    const suggestion = yield* (yield* GarmentVision).suggest(small)
    if (verdictOf(suggestion.whole) === 'drop') return Option.none<GarmentRow>()
    const id = yield* parts.newId('pg')
    const cutoutKey = `${photoPrefix(photo.accountId, photo.id)}${id}.png`
    yield* writeObject(parts.capture, cutoutKey, piece.png, 'image/png')
    const types = comparedTypes(suggestion.type ?? null)
    const candidates = Option.isNone(types)
      ? []
      : yield* storedAs(
          parts.capture.store.wardrobeCandidates(
            photo.accountId,
            types.value,
            suggestion.colours[0],
            policy.matching.pieces,
          ),
        )
    const match = yield* sameAs(parts.capture, small, candidates, ({ imageKey }) => imageKey, wornMatchBar)
    return Option.some<GarmentRow>({
      id,
      photoId: photo.id,
      accountId: photo.accountId,
      position,
      cutoutKey,
      type: suggestion.type ?? null,
      colours: suggestion.colours,
      pieceId: Option.match(match, { onNone: () => null, onSome: ({ id: pieceId }) => pieceId }),
      state: Option.isSome(match) ? 'suggested' : 'unmatched',
      captureId: null,
    })
  })

/** The garments SAM finds in the photo, and the shoes, bags and hats it is asked for besides. */
const garmentsIn = (parts: PhotoParts, photo: PhotoRow) =>
  Effect.gen(function* () {
    const original = yield* readObject(parts.capture, photo.originalKey)
    if (Option.isNone(original)) return yield* unavailable()
    const copies = yield* (yield* PictureWork).workingCopies(original.value)
    const pieces = (yield* samPieces(copies, morePrompts)).slice(0, mostGarments)
    const found = yield* Effect.forEach(pieces, (piece, position) => garmentOf(parts, photo, piece, position), {
      concurrency: 4,
    })
    return found.flatMap(Option.toArray)
  })

/** With the providers off (native acceptance), the whole photo stands for one garment, matched by the person. */
const wholePhoto = (parts: PhotoParts, photo: PhotoRow) =>
  Effect.map(parts.newId('pg'), (id): ReadonlyArray<GarmentRow> => [
    {
      id,
      photoId: photo.id,
      accountId: photo.accountId,
      position: 0,
      cutoutKey: photo.originalKey,
      type: null,
      colours: [],
      pieceId: null,
      state: 'unmatched',
      captureId: null,
    },
  ])

/** The queue side of My Gallery. */
export const finding = (parts: PhotoParts) => ({
  /** Find a photo's garments once; its credit is spent when they are stored. */
  findGarments: Effect.fn('Styld.Photos.find')(function* (photoId: string) {
    const photo = yield* storedAs(parts.photos.photoForWork(photoId))
    if (Option.isNone(photo) || photo.value.status !== 'finding') return
    const providers = (yield* CaptureConfig).providers
    const garments = providers === 'off' ? yield* wholePhoto(parts, photo.value) : yield* garmentsIn(parts, photo.value)
    yield* storedAs(parts.photos.finishFinding(photoId, garments, yield* nowDate))
    yield* (yield* Usage)
      .settle(photo.value.accountId, photoHold(photoId), 'consumed')
      .pipe(Effect.ignore({ log: true }))
  }),
  /** The last attempt failed: the photo shows as failed, and its credit comes back once. */
  failFinding: Effect.fn('Styld.Photos.failFinding')(function* (photoId: string) {
    const photo = yield* storedAs(parts.photos.photoForWork(photoId))
    if (Option.isNone(photo)) return
    if (yield* storedAs(parts.photos.failFinding(photoId, yield* nowDate)))
      yield* (yield* Usage)
        .settle(photo.value.accountId, photoHold(photoId), 'refunded')
        .pipe(Effect.ignore({ log: true }))
  }),
})
