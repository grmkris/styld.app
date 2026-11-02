import { modelPicture, readPng } from '@styld/imaging'
import { isBusy, outcomeUnknown } from '../providers/Errors.ts'
import { prices } from '@styld/protocol'
import { Effect, Layer, Option, Schedule, Schema } from 'effect'
import { piecePrefix } from '../wardrobe/Media.ts'
import { type CutSide, CutoutFailed, GarmentCutout } from '../wardrobe/Processing.ts'
import { Media } from '../kernel/Media.ts'
import { Garments, judgedAt } from './Garments.ts'
import { GarmentVision } from './Providers.ts'
import { holdId } from '../usage/Holds.ts'
import { PaidAttempts } from '../usage/Attempts.ts'

type CutInput = Parameters<GarmentCutout['Service']['cut']>[0]

/** What a side's cut-out made: its stored key, or none when no garment was found in the photo. */
const Cut = Schema.Struct({ imageKey: Schema.NullOr(Schema.String) })
type Cut = typeof Cut.Type

/** A side's paid work, run once however often it is asked for: the front's once per piece, a back's once per upload.
 * Each attempt at it holds a photo's credit of its own. */
const workOf = (input: CutInput) => ({
  key: input.of.side === 'front' ? `piece/${input.pieceId}` : `back/${input.of.uploadId}`,
  accountId: input.accountId,
  provider: 'meta-sam',
  result: Cut,
})

const chargeOf = (input: CutInput) => ({
  hold: (attempt: number) =>
    input.of.side === 'front' ? holdId('piece', input.pieceId, attempt) : holdId('back', input.of.uploadId, attempt),
  credits: prices.photo,
  // Paid only for a cut-out stored.
  paidFor: (cut: Cut) => cut.imageKey !== null,
})

/** Where a side's cut-out is stored: under the piece, so it goes with it. */
const cutoutKey = (accountId: string, pieceId: string, of: CutSide) =>
  `${piecePrefix(accountId, pieceId)}${of.side === 'front' ? 'cutout' : `back-${of.uploadId}`}.png`

/** The garment cut-out behind `piece_add` and a back added on the piece's page: the same pipeline as the tray, without
 * a review step, because the person asked for this piece. It costs a photo's credit, paid only for a cut-out stored; a
 * piece imported from v1 is Styld's to pay for, so it holds none of the account's. The cut runs once (`PaidAttempts`):
 * a repeat answers the stored cut-out, and an answer lost with its delivery is never asked for again. Past the daily
 * limit, or when nothing can be cut out, the side keeps its original photo; a provider that is busy fails the attempt
 * for the queue to try again. Describing a stored cut-out asks the decision model what it shows (an import's
 * attributes). */
export const pieceCutout = Layer.effect(
  GarmentCutout,
  Effect.gen(function* () {
    const { bucket } = yield* Media
    const garments = yield* Garments
    const vision = yield* GarmentVision
    const attempts = yield* PaidAttempts
    const read = (key: string) =>
      Effect.tryPromise({
        try: async () => {
          const object = await bucket.get(key)
          return object === null ? undefined : new Uint8Array(await object.arrayBuffer())
        },
        catch: () => CutoutFailed.make({}),
      }).pipe(Effect.map(Option.fromNullishOr))
    const cutAndStore = Effect.fnUntraced(function* (input: CutInput, original: Uint8Array) {
      const png = yield* garments.cut(original, { for: 'piece', type: input.type })
      if (Option.isNone(png)) return { imageKey: null } satisfies Cut
      const key = cutoutKey(input.accountId, input.pieceId, input.of)
      yield* Effect.tryPromise({
        try: () => bucket.put(key, png.value, { httpMetadata: { contentType: 'image/png' } }),
        catch: () => CutoutFailed.make({}),
      }).pipe(
        Effect.retry({ times: 2, schedule: Schedule.exponential('200 millis') }),
        Effect.mapError(() => outcomeUnknown('meta-sam')),
      )
      return { imageKey: key } satisfies Cut
    })
    return GarmentCutout.of({
      cut: Effect.fn('Styld.Capture.pieceCutout')(function* (input: CutInput) {
        const kept = { imageKey: input.originalKey }
        // Read before the work is claimed: a photo that cannot be read now is tried again as it was.
        const original = yield* read(input.originalKey)
        if (Option.isNone(original)) return kept
        const cutting = cutAndStore(input, original.value)
        const work =
          input.of.side === 'front' && input.of.payer === 'styld'
            ? attempts.run(workOf(input), cutting)
            : attempts.charged(workOf(input), chargeOf(input), cutting)
        const cut = yield* work.pipe(
          Effect.catchTags({
            LimitReached: () => Effect.succeed({ imageKey: null }),
            // A refusal, or an answer lost after the provider took the work, keeps the photo; busy tries again.
            ProviderError: (error) => (isBusy(error) ? CutoutFailed.make({}) : Effect.succeed({ imageKey: null })),
            Unavailable: () => CutoutFailed.make({}),
          }),
        )
        return cut.imageKey === null ? kept : { imageKey: cut.imageKey }
      }),
      describe: Effect.fn('Styld.Capture.describePiece')(function* (storedKey: string) {
        const stored = yield* read(storedKey).pipe(Effect.option)
        const picture = Option.flatMap(Option.flatten(stored), readPng)
        if (Option.isNone(picture)) return Option.none()
        // A model that does not answer leaves the piece as it was mapped; the import does not wait on it.
        return yield* vision.suggest(modelPicture(picture.value, judgedAt)).pipe(Effect.option)
      }),
    })
  }),
)
