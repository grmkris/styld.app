import { NoPersonFound } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { readObject, storedAs, unavailable, writeObject } from '../capture/Shared.ts'
import { photoPrefix } from './Finding.ts'
import type { PhotoRow } from './Store.ts'
import { nowDate } from '../kernel/Db.ts'
import { PhotoStore } from './Store.ts'
import { Garments } from '../capture/Garments.ts'

// Cut out the outfit (owner, 2026-10-31): the person in an outfit photo, cut out as one picture for collages. Free;
// SAM is asked for the person, and the largest one it finds is kept beside the photo. A photo cut once keeps it.

/** Cut the person out of the photo and keep the picture with it; none found is `NoPersonFound`. */
export const cutOutPerson = (photo: PhotoRow) =>
  Effect.gen(function* () {
    if (photo.cutoutKey !== null) return
    const original = yield* readObject(photo.originalKey)
    if (Option.isNone(original)) return yield* unavailable()
    const person = yield* (yield* Garments)
      .cut(original.value, { for: 'person' })
      .pipe(Effect.catchTag('ProviderError', () => Effect.fail(unavailable())))
    if (Option.isNone(person)) return yield* NoPersonFound.make({})
    const key = `${photoPrefix(photo.accountId, photo.id)}cutout.png`
    yield* writeObject(key, person.value, 'image/png')
    const at = yield* nowDate
    yield* storedAs((yield* PhotoStore).setCutout(photo.accountId, photo.id, key, at))
  })
