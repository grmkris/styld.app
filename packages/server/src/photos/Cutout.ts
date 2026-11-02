import { NoPersonFound } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import { readObject, storedAs, unavailable, writeObject } from '../capture/Shared.ts'
import { photoPrefix } from './Finding.ts'
import type { PhotoRow } from './Store.ts'
import { nowDate } from '../kernel/Db.ts'
import { Pacing } from '../kernel/Pacing.ts'
import { PhotoStore } from './Store.ts'
import { Garments } from '../capture/Garments.ts'
import { PaidAttempts } from '../usage/Attempts.ts'
import { outcomeUnknown } from '../providers/Errors.ts'

// Cut out the outfit (owner, 2026-10-31): the person in an outfit photo, cut out as one picture for collages. Free to
// the person, but SAM bills each call, so it is asked once per photo (`PaidAttempts`): the outcome is kept whether a
// person was found or not, two requests at once ask once, and each account asks at its own pace.

/** What asking SAM for the person made: the stored cut-out, or none when no person was found. */
const PersonCut = Schema.Struct({ key: Schema.NullOr(Schema.String) })

/** Ask SAM for the largest person in the photo and keep the picture beside it. */
const cut = (photo: PhotoRow, original: Uint8Array) =>
  Effect.gen(function* () {
    const person = yield* (yield* Garments).cut(original, { for: 'person' })
    if (Option.isNone(person)) return { key: null }
    const key = `${photoPrefix(photo.accountId, photo.id)}cutout.png`
    yield* writeObject(key, person.value, 'image/png').pipe(Effect.mapError(() => outcomeUnknown('meta-sam')))
    return { key }
  })

/** Cut the person out of the photo and keep the picture with it; none found is `NoPersonFound`, answered again from
 * that outcome without asking SAM. A photo cut once keeps its picture. */
export const cutOutPerson = (photo: PhotoRow) =>
  Effect.gen(function* () {
    if (photo.cutoutKey !== null) return
    yield* (yield* Pacing).account('cutout')
    const original = yield* readObject(photo.originalKey)
    if (Option.isNone(original)) return yield* unavailable()
    const attempts = yield* PaidAttempts
    const work = { key: `person/${photo.id}`, accountId: photo.accountId, provider: 'meta-sam', result: PersonCut }
    const made = yield* attempts.run(work, cut(photo, original.value)).pipe(
      Effect.catchTags({
        AttemptElsewhere: () => unavailable(),
        ProviderError: () => unavailable(),
      }),
    )
    if (made.key === null) return yield* NoPersonFound.make({})
    yield* storedAs((yield* PhotoStore).setCutout(photo.accountId, photo.id, made.key, yield* nowDate))
  })
