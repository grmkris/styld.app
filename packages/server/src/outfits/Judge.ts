import type { Occasion, OutfitBrief, Season } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { askClef, clefCost, imageOf, noulOf, type RunClef } from '../capture/Clef.ts'
import type { CaptureMetrics } from '../capture/Metrics.ts'
import type { Picture } from '../capture/Providers.ts'
import { collect } from '../Streams.ts'
import { deliverImage, type ImageBindings } from '../wardrobe/Delivery.ts'
import { piecePrefix } from '../wardrobe/Media.ts'
import type { Owned } from './Wearables.ts'

// Clef ranks outfits by looking at them (owner, 2026-10-31): one call an outfit, the pictures of its pieces in wearing
// order, asked whether they go together and whether they suit what the outfit is for. Each piece's picture is resized
// once and kept beside the piece, so it goes when the piece does.

/** An outfit's score, 0 to 1, and what Clef's answer cost. */
export interface Judged {
  readonly score: number
  readonly costMicroUsd: number
}

/** How outfits are judged: by Clef on the preview and natively (through its stand-in), or not at all. */
export interface OutfitJudge {
  readonly judge: (pictures: ReadonlyArray<Picture>, brief: OutfitBrief) => Effect.Effect<Option.Option<Judged>>
}

const occasionWords: Readonly<Record<Occasion, string>> = {
  casual: 'an everyday, casual day',
  smart: 'the office or a nice dinner',
  formal: 'a formal event',
  sport: 'sport and exercise',
  lounge: 'lounging at home',
}

const seasonWords: Readonly<Record<Season, string | null>> = {
  warm: 'warm weather',
  cold: 'cold weather',
  allYear: null,
}

/** What the outfit is for, in Clef's words, when the brief says anything. */
const purposeOf = (brief: OutfitBrief): Option.Option<string> => {
  const parts = [
    brief.occasion === undefined ? null : occasionWords[brief.occasion],
    brief.season === undefined ? null : seasonWords[brief.season],
    brief.words === undefined ? null : `“${brief.words}”`,
  ].filter((part) => part !== null)
  return parts.length === 0 ? Option.none() : Option.some(parts.join(', '))
}

/** Clef judges: how well the pieces go together, times how well they suit the purpose when there is one. A failed call
 * leaves the outfit unjudged. */
export const clefJudge = (run: RunClef, metrics: CaptureMetrics['Service']): OutfitJudge => ({
  judge: (pictures, brief) => {
    const purpose = purposeOf(brief)
    return askClef(run, metrics, 'outfit', {
      model: 'clef-flash',
      state: 'Each image shows one piece of clothing from one person’s wardrobe. Worn together, they are one outfit.',
      images: pictures.map(imageOf),
      questions: {
        goes: { type: 'noul', instructions: 'Do these pieces look good worn together as one outfit?' },
        ...Option.match(purpose, {
          onNone: () => ({}),
          onSome: (words) => ({ suits: { type: 'noul', instructions: `Is this outfit right for ${words}?` } }),
        }),
      },
    }).pipe(
      Effect.map((answer) => {
        const suits = Option.isSome(purpose) ? noulOf(answer, 'suits') : 1
        return Option.some({ score: noulOf(answer, 'goes') * suits, costMicroUsd: clefCost(answer).costMicroUsd })
      }),
      Effect.orElseSucceed(() => Option.none<Judged>()),
    )
  },
})

/** Without Clef, outfits keep the rules' order. */
export const noJudge: OutfitJudge = { judge: () => Effect.succeed(Option.none()) }

/** The largest picture sent when the Images binding cannot resize one. */
const largestPicture = 2 * 1024 * 1024

const judgingKey = (accountId: string, owned: Owned) =>
  `${piecePrefix(accountId, owned.wearable.id)}judging-${owned.picture.version}.webp`

const pictureType = (contentType: string | undefined): Option.Option<Picture['contentType']> =>
  contentType === 'image/webp' || contentType === 'image/png' || contentType === 'image/jpeg'
    ? Option.some(contentType)
    : Option.none()

/** A piece's picture for Clef: kept beside the piece after the first time, else its shown image at the grid's
 * thumbnail size, kept for next time. None when it cannot be read or is too large to send. */
export const judgingPicture = (bindings: ImageBindings, accountId: string, owned: Owned) =>
  Effect.gen(function* () {
    const key = judgingKey(accountId, owned)
    const kept = yield* Effect.tryPromise(() => bindings.bucket.get(key))
    if (kept !== null) {
      const bytes = new Uint8Array(yield* Effect.tryPromise(() => kept.arrayBuffer()))
      return Option.map(pictureType(kept.httpMetadata?.contentType), (contentType): Picture => ({ bytes, contentType }))
    }
    const shown = yield* deliverImage(bindings, owned.picture, 'thumb')
    if (Option.isNone(shown)) return Option.none<Picture>()
    const bytes = yield* Effect.tryPromise(() => collect(shown.value.body))
    const contentType = pictureType(shown.value.contentType)
    if (Option.isNone(contentType) || bytes.byteLength > largestPicture) return Option.none<Picture>()
    yield* Effect.tryPromise(() =>
      bindings.bucket.put(key, bytes, { httpMetadata: { contentType: contentType.value } }),
    )
    return Option.some<Picture>({ bytes, contentType: contentType.value })
  }).pipe(Effect.orElseSucceed(() => Option.none<Picture>()))
