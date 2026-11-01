import { NoPersonFound } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { readObject, storedAs, unavailable, writeObject } from '../capture/Parts.ts'
import { segmentedPieces } from '../capture/PhotoPipeline.ts'
import { decodedPng } from '../capture/Pixels.ts'
import { CaptureConfig } from '../capture/Policy.ts'
import { GarmentSegmenter, PictureWork } from '../capture/Providers.ts'
import { type PhotoParts, photoPrefix } from './Finding.ts'
import type { PhotoRow } from './Store.ts'
import { nowDate } from '../kernel/Db.ts'

// Cut out the outfit (owner, 2026-10-31): the person in an outfit photo, cut out as one picture for collages. Free;
// SAM is asked for the person, and the largest one it finds is kept beside the photo. A photo cut once keeps it.

/** Cut the person out of the photo and keep the picture with it; none found is `NoPersonFound`. With the providers
 * off (native acceptance), nothing can be cut. */
export const cutOutPerson = (parts: PhotoParts, photo: PhotoRow) =>
  Effect.gen(function* () {
    if (photo.cutoutKey !== null) return
    const policy = yield* CaptureConfig
    if (policy.providers === 'off') return yield* unavailable()
    const original = yield* readObject(parts.capture, photo.originalKey)
    if (Option.isNone(original)) return yield* unavailable()
    const copies = yield* (yield* PictureWork).workingCopies(original.value).pipe(Effect.mapError(unavailable))
    const found = yield* (yield* GarmentSegmenter)
      .still({ bytes: copies.jpeg, contentType: 'image/jpeg' }, 'person')
      .pipe(Effect.mapError(unavailable))
    const picture = yield* decodedPng(copies.png).pipe(Effect.mapError(unavailable))
    const [person] = segmentedPieces(picture, found, picture, policy.edges).toSorted((a, b) => b.area - a.area)
    if (person === undefined) return yield* NoPersonFound.make({})
    const key = `${photoPrefix(photo.accountId, photo.id)}cutout.png`
    yield* writeObject(parts.capture, key, person.png, 'image/png')
    const at = yield* nowDate
    yield* storedAs(parts.photos.setCutout(photo.accountId, photo.id, key, at))
  })
