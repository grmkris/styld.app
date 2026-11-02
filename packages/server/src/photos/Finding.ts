import { isBusy } from '../providers/Errors.ts'
import { GarmentMatch, PieceType } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import { comparedTypes, sameAs } from '../capture/Matching.ts'
import { type CaptureServices, readObject, storedAs, unavailable, writeObject } from '../capture/Shared.ts'
import { type Garment, judgedAt } from '../capture/Garments.ts'
import { capturePolicy } from '../capture/Policy.ts'
import { modelPicture } from '@styld/imaging'
import { type Ending, holdId } from '../usage/Holds.ts'
import type { Boards } from '../boards/Boards.ts'
import type { Looks } from '../looks/Looks.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { accountPrefix } from '../wardrobe/Media.ts'
import { type GarmentRow, PhotoStore, type PhotoRow } from './Store.ts'
import { nowDate } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { CaptureStore } from '../capture/Store.ts'
import { Garments } from '../capture/Garments.ts'
import { Holds } from '../usage/Holds.ts'
import { PaidAttempts } from '../usage/Attempts.ts'

// Finding the garments in an outfit photo, one delivery of the piece queue at a time (owner, 2026-10-31). The same
// cutting and suggesting as capture, without the held-piece rule: every garment the person wears counts. Each is
// compared with the wardrobe's pieces in its place; the person confirms or corrects the match.

/** The services My Gallery's operations act through, provided once by the `Photos` layer: its own store, capture's
 * services (stores, garment pipeline, media, piece queue, credits), and the looks, boards and uploads it leans on. */
export type PhotoServices = PhotoStore | CaptureServices | Looks | Boards | Wardrobe

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
const garmentOf = (photo: PhotoRow, garment: Garment, position: number) =>
  Effect.gen(function* () {
    const { suggestion } = garment
    const id = yield* newId('pg')
    const cutoutKey = `${photoPrefix(photo.accountId, photo.id)}${id}.png`
    yield* writeObject(cutoutKey, garment.png, 'image/png')
    const types = comparedTypes(suggestion.type ?? null)
    const { matching } = capturePolicy
    const candidates = Option.isNone(types)
      ? []
      : yield* storedAs(
          (yield* CaptureStore).wardrobeCandidates(
            photo.accountId,
            types.value,
            suggestion.colours[0],
            matching.pieces,
          ),
        )
    const picture = modelPicture(garment.picture, judgedAt)
    const match = yield* sameAs(picture, candidates, ({ imageKey }) => imageKey, matching.same)
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
    } satisfies GarmentRow
  })

/** The garments found in a photo, as their rows are written: what a delivery keeps once SAM answered, so a retry
 * writes them without asking it again. */
const FoundGarments = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    photoId: Schema.String,
    accountId: Schema.String,
    position: Schema.Number,
    cutoutKey: Schema.String,
    type: Schema.NullOr(PieceType),
    colours: Schema.Array(Schema.String),
    pieceId: Schema.NullOr(Schema.String),
    state: GarmentMatch,
  }),
)

/** The garments the pipeline finds in the photo, stored and matched. */
const garmentsIn = (photo: PhotoRow, original: Uint8Array) =>
  Effect.gen(function* () {
    const { garments } = yield* (yield* Garments).find(original, { for: 'gallery' })
    return yield* Effect.forEach(garments, (garment, position) => garmentOf(photo, garment, position), {
      concurrency: 4,
    })
  })

/** The queue side of My Gallery. */
export const finding = Effect.map(Effect.context<PhotoServices>(), (context) => ({
  /** Find a photo's garments once (`PaidAttempts`: a redelivery writes what the first found, and leaves one being
   * found to its delivery); its credit is spent when they are stored. */
  findGarments: Effect.fn('Styld.Photos.find')(function* (photoId: string) {
    const photo = yield* storedAs((yield* PhotoStore).photoForWork(photoId))
    if (Option.isNone(photo)) return
    if (photo.value.status === 'finding') {
      const original = yield* readObject(photo.value.originalKey)
      if (Option.isNone(original)) return yield* unavailable()
      const work = {
        key: `photo/${photoId}`,
        accountId: photo.value.accountId,
        provider: 'meta-sam',
        result: FoundGarments,
      }
      // Only a busy provider is tried again: one that may have taken the paid work (SAM bills each call) is never
      // sent it twice, and a refusal would repeat. Both end the photo as failed, its credit back.
      const garments = yield* (yield* PaidAttempts).run(work, garmentsIn(photo.value, original.value)).pipe(
        Effect.map(Option.some),
        Effect.catchTag('ProviderError', (error) =>
          isBusy(error) ? Effect.fail(error) : Effect.succeed(Option.none<ReadonlyArray<GarmentRow>>()),
        ),
        Effect.catchTag('AttemptElsewhere', () => Effect.succeed('elsewhere' as const)),
      )
      if (garments === 'elsewhere') return
      if (Option.isNone(garments)) {
        yield* storedAs((yield* PhotoStore).failFinding(photoId, yield* nowDate))
        return yield* settlePhoto(photo.value.accountId, photoId, 'failed')
      }
      yield* storedAs((yield* PhotoStore).finishFinding(photoId, garments.value, yield* nowDate))
    }
    // Settled after the status moved, and again by any later delivery: the first settlement stands.
    yield* settlePhoto(photo.value.accountId, photoId, photo.value.status === 'failed' ? 'failed' : 'succeeded')
  }, Effect.provide(context)),
  /** The last attempt failed: the photo shows as failed, and its credit comes back once. */
  failFinding: Effect.fn('Styld.Photos.failFinding')(function* (photoId: string) {
    const photo = yield* storedAs((yield* PhotoStore).photoForWork(photoId))
    if (Option.isNone(photo)) return
    yield* storedAs((yield* PhotoStore).failFinding(photoId, yield* nowDate))
    const ended = yield* storedAs((yield* PhotoStore).photoForWork(photoId))
    if (Option.isSome(ended))
      yield* settlePhoto(photo.value.accountId, photoId, ended.value.status === 'ready' ? 'succeeded' : 'failed')
  }, Effect.provide(context)),
}))
