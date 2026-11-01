import { isBusy } from '../providers/Errors.ts'
import { Effect, Option } from 'effect'
import { comparedTypes, sameAs } from '../capture/Matching.ts'
import { type CaptureBindings, makeParts, readObject, storedAs, unavailable, writeObject } from '../capture/Parts.ts'
import { type Garment, Garments, judgedAt } from '../capture/Garments.ts'
import { capturePolicy } from '../capture/Policy.ts'
import { modelPicture } from '@styld/imaging'
import { type Ending, Holds, holdId } from '../usage/Holds.ts'
import type { ImageBindings } from '../wardrobe/Delivery.ts'
import { accountPrefix } from '../wardrobe/Media.ts'
import { type GarmentRow, makePhotoStore, type PhotoRow } from './Store.ts'
import { nowDate } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'

// Finding the garments in an outfit photo, one delivery of the piece queue at a time (owner, 2026-10-31). The same
// cutting and suggesting as capture, without the held-piece rule: every garment the person wears counts. Each is
// compared with the wardrobe's pieces in its place; the person confirms or corrects the match.

/** What a photo's work shares: capture's parts (bindings, stores, objects), the Images binding its routes resize
 * with, the photo store and its ids. */
export const makePhotoParts = (bindings: CaptureBindings & ImageBindings) =>
  Effect.gen(function* () {
    return {
      capture: yield* makeParts(bindings),
      images: { bucket: bindings.bucket, images: bindings.images } satisfies ImageBindings,
      photos: makePhotoStore(bindings.database),
    }
  })
export type PhotoParts = Effect.Success<ReturnType<typeof makePhotoParts>>

/** Where a photo's own objects live, under the account's prefix so deleting the account sweeps them. */
export const photoPrefix = (accountId: string, photoId: string) => `${accountPrefix(accountId)}photos/${photoId}/`

/** The Wallet operation holding a photo's credit. */
export const photoHold = (photoId: string) => holdId('photo', photoId, 0)

/** Settle a photo's credit by how finding its garments ended. */
const settlePhoto = Effect.fnUntraced(function* (accountId: string, photoId: string, ending: Ending) {
  yield* (yield* Holds).settle(accountId, photoHold(photoId), ending)
})

/** One garment found in the photo: stored, and matched with the wardrobe's pieces in its place, at the one bar for
 * "the same garment?" (`Policy.ts`). */
const garmentOf = (parts: PhotoParts, photo: PhotoRow, garment: Garment, position: number) =>
  Effect.gen(function* () {
    const { suggestion } = garment
    const id = yield* newId('pg')
    const cutoutKey = `${photoPrefix(photo.accountId, photo.id)}${id}.png`
    yield* writeObject(parts.capture, cutoutKey, garment.png, 'image/png')
    const types = comparedTypes(suggestion.type ?? null)
    const { matching } = capturePolicy
    const candidates = Option.isNone(types)
      ? []
      : yield* storedAs(
          parts.capture.store.wardrobeCandidates(photo.accountId, types.value, suggestion.colours[0], matching.pieces),
        )
    const picture = modelPicture(garment.picture, judgedAt)
    const match = yield* sameAs(parts.capture, picture, candidates, ({ imageKey }) => imageKey, matching.same)
    return {
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
    } satisfies GarmentRow
  })

/** The garments the pipeline finds in the photo, stored and matched. */
const garmentsIn = (parts: PhotoParts, photo: PhotoRow) =>
  Effect.gen(function* () {
    const original = yield* readObject(parts.capture, photo.originalKey)
    if (Option.isNone(original)) return yield* unavailable()
    const { garments } = yield* (yield* Garments).find(original.value, { for: 'gallery' })
    return yield* Effect.forEach(garments, (garment, position) => garmentOf(parts, photo, garment, position), {
      concurrency: 4,
    })
  })

/** The queue side of My Gallery. */
export const finding = (parts: PhotoParts) => ({
  /** Find a photo's garments once; its credit is spent when they are stored. */
  findGarments: Effect.fn('Styld.Photos.find')(function* (photoId: string) {
    const photo = yield* storedAs(parts.photos.photoForWork(photoId))
    if (Option.isNone(photo)) return
    if (photo.value.status === 'finding') {
      // Only a busy provider is tried again: one that may have taken the paid work (SAM bills each call) is never
      // sent it twice, and a refusal would repeat. Both end the photo as failed, its credit back.
      const garments = yield* garmentsIn(parts, photo.value).pipe(
        Effect.map(Option.some),
        Effect.catchTag('ProviderError', (error) =>
          isBusy(error) ? Effect.fail(error) : Effect.succeed(Option.none<ReadonlyArray<GarmentRow>>()),
        ),
      )
      if (Option.isNone(garments)) {
        yield* storedAs(parts.photos.failFinding(photoId, yield* nowDate))
        return yield* settlePhoto(photo.value.accountId, photoId, 'failed')
      }
      yield* storedAs(parts.photos.finishFinding(photoId, garments.value, yield* nowDate))
    }
    // Settled after the status moved, and again by any later delivery: the first settlement stands.
    yield* settlePhoto(photo.value.accountId, photoId, photo.value.status === 'failed' ? 'failed' : 'succeeded')
  }),
  /** The last attempt failed: the photo shows as failed, and its credit comes back once. */
  failFinding: Effect.fn('Styld.Photos.failFinding')(function* (photoId: string) {
    const photo = yield* storedAs(parts.photos.photoForWork(photoId))
    if (Option.isNone(photo)) return
    yield* storedAs(parts.photos.failFinding(photoId, yield* nowDate))
    const ended = yield* storedAs(parts.photos.photoForWork(photoId))
    if (Option.isSome(ended))
      yield* settlePhoto(photo.value.accountId, photoId, ended.value.status === 'ready' ? 'succeeded' : 'failed')
  }),
})
