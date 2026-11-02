import { modelPicture, readPng } from '@styld/imaging'
import { isBusy } from '../providers/Errors.ts'
import { prices } from '@styld/protocol'
import { Effect, Layer, Option, Schema } from 'effect'
import { piecePrefix } from '../wardrobe/Media.ts'
import { type CutSide, CutoutFailed, GarmentCutout } from '../wardrobe/Processing.ts'
import { Media } from '../kernel/Media.ts'
import { Garments, judgedAt } from './Garments.ts'
import { GarmentVision } from './Providers.ts'
import { Holds, holdId, metered } from '../usage/Holds.ts'

type CutInput = Parameters<GarmentCutout['Service']['cut']>[0]

/** A side's credit: the front's for each queue delivery that cuts it, a back's once for its upload. */
const holdOf = (pieceId: string, of: CutSide) =>
  of.side === 'front' ? holdId('piece', pieceId, of.attempt) : holdId('back', of.uploadId, 0)

/** Where a side's cut-out is stored: under the piece, so it goes with it. */
const cutoutKey = (accountId: string, pieceId: string, of: CutSide) =>
  `${piecePrefix(accountId, pieceId)}${of.side === 'front' ? 'cutout' : `back-${of.uploadId}`}.png`

/** Nothing to cut: the photo is gone, or no garment was found in it. The side keeps its photo, and its credit back. */
class NoCutout extends Schema.TaggedError<NoCutout>()('NoCutout', {}) {}

/** The garment cut-out behind `piece_add` and a back added on the piece's page: the same pipeline as the tray, without
 * a review step, because the person asked for this piece. It costs a photo's credit, paid only for a cut-out stored
 * (`metered`); a piece imported from v1 is Styld's to pay for, so it holds none of the account's. Past the daily limit,
 * or when nothing can be cut out, the side keeps its original photo; a provider that is busy fails the attempt for the
 * queue to try again. Describing a stored cut-out asks the decision model what it shows (an import's attributes). */
export const pieceCutout = Layer.effect(
  GarmentCutout,
  Effect.gen(function* () {
    const { bucket } = yield* Media
    const garments = yield* Garments
    const vision = yield* GarmentVision
    const holds = yield* Holds
    const cutAndStore = Effect.fnUntraced(function* (input: CutInput) {
      const original = yield* Effect.tryPromise({
        try: async () => {
          const object = await bucket.get(input.originalKey)
          return object === null ? undefined : new Uint8Array(await object.arrayBuffer())
        },
        catch: () => CutoutFailed.make({}),
      })
      if (original === undefined) return yield* NoCutout.make({})
      const png = yield* garments.cut(original, { for: 'piece', type: input.type })
      if (Option.isNone(png)) return yield* NoCutout.make({})
      const key = cutoutKey(input.accountId, input.pieceId, input.of)
      yield* Effect.tryPromise({
        try: () => bucket.put(key, png.value, { httpMetadata: { contentType: 'image/png' } }),
        catch: () => CutoutFailed.make({}),
      })
      return { imageKey: key }
    })
    return GarmentCutout.of({
      cut: Effect.fn('Styld.Capture.pieceCutout')(function* (input: CutInput) {
        const kept = { imageKey: input.originalKey }
        const charge = { accountId: input.accountId, hold: holdOf(input.pieceId, input.of), credits: prices.photo }
        const work =
          input.of.side === 'front' && input.of.payer === 'styld'
            ? cutAndStore(input)
            : metered(charge, cutAndStore(input)).pipe(Effect.provideService(Holds, holds))
        return yield* work.pipe(
          Effect.catchTags({
            LimitReached: () => Effect.succeed(kept),
            NoCutout: () => Effect.succeed(kept),
            // A refusal, or an answer lost after the provider took the work, keeps the photo; busy tries again.
            ProviderError: (error) => (isBusy(error) ? CutoutFailed.make({}) : Effect.succeed(kept)),
            Unavailable: () => CutoutFailed.make({}),
          }),
        )
      }),
      describe: Effect.fn('Styld.Capture.describePiece')(function* (storedKey: string) {
        const stored = yield* Effect.tryPromise(async () => {
          const object = await bucket.get(storedKey)
          return object === null ? undefined : new Uint8Array(await object.arrayBuffer())
        }).pipe(Effect.option)
        const picture = Option.flatMap(Option.flatMap(stored, Option.fromNullishOr), readPng)
        if (Option.isNone(picture)) return Option.none()
        // A model that does not answer leaves the piece as it was mapped; the import does not wait on it.
        return yield* vision.suggest(modelPicture(picture.value, judgedAt)).pipe(Effect.option)
      }),
    })
  }),
)
