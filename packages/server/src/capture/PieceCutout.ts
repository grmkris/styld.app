import { Effect, Layer, Option } from 'effect'
import { accountPrefix } from '../wardrobe/Media.ts'
import { CutoutFailed, GarmentCutout } from '../wardrobe/Processing.ts'
import type { WardrobeBindings } from '../wardrobe/Wardrobe.ts'
import { CaptureMetrics } from './Metrics.ts'
import { CaptureConfig } from './Policy.ts'
import { foregroundPiece, samPieces } from './PhotoPipeline.ts'
import { GarmentSegmenter, GarmentVision, PictureWork } from './Providers.ts'
import { Usage } from './Usage.ts'

type Requirements = GarmentVision | PictureWork | GarmentSegmenter | Usage | CaptureConfig | CaptureMetrics

/** The largest garment in a piece's photo: what an assistant meant when it added one piece. The same
 * steps as the tray's photos: background removal for a confident single garment, SAM otherwise. */
const largestGarment = (original: Uint8Array) =>
  Effect.gen(function* () {
    const policy = yield* CaptureConfig
    const copies = yield* (yield* PictureWork).workingCopies(original)
    const route = yield* (yield* GarmentVision).route({ bytes: copies.small, contentType: 'image/jpeg' })
    if (route.garments === 'one' && route.confidence >= policy.routeConfidence && policy.single === 'cloudflare') {
      const [foreground] = yield* foregroundPiece(original)
      if (foreground !== undefined) return Option.some(foreground.png)
    }
    const [largest] = yield* samPieces(copies)
    return Option.fromNullishOr(largest?.png)
  })

const holdOf = (pieceId: string) => `piece/${pieceId}`

/** Consume or refund a piece's credit. The Wallet answers a repeated settle as already done. */
const settle = (accountId: string, pieceId: string, outcome: 'consumed' | 'refunded') =>
  Effect.gen(function* () {
    yield* (yield* Usage).settle(accountId, holdOf(pieceId), outcome)
  }).pipe(Effect.mapError(() => CutoutFailed.make({})))

/** The garment cut-out behind `piece_add`: the same providers as the tray, without a review step,
 * because the person asked their assistant for this piece. It costs a photo's credit, held across the
 * queue's attempts and given back only when the queue gives up (`release`). Past the daily limit, or
 * when nothing can be cut out, the piece keeps its original photo. */
export const pieceCutout = (bucket: WardrobeBindings['bucket']) =>
  Layer.effect(
    GarmentCutout,
    Effect.gen(function* () {
      const services = yield* Effect.context<Requirements>()
      const cut = Effect.fn('Styld.Capture.pieceCutout')(function* (input: {
        readonly accountId: string
        readonly pieceId: string
        readonly originalKey: string
      }) {
        const policy = yield* CaptureConfig
        const kept = { imageKey: input.originalKey }
        if (policy.providers === 'off') return kept
        // A retried attempt repeats the same reservation, which the Wallet answers as already held.
        const held = yield* (yield* Usage).reserve(input.accountId, holdOf(input.pieceId), policy.credits.photo).pipe(
          Effect.as(true),
          Effect.catchTag('DailyLimitReached', () => Effect.succeed(false)),
          Effect.mapError(() => CutoutFailed.make({})),
        )
        if (!held) return kept
        const original = yield* Effect.tryPromise({
          try: async () => {
            const object = await bucket.get(input.originalKey)
            return object === null ? undefined : new Uint8Array(await object.arrayBuffer())
          },
          catch: () => CutoutFailed.make({}),
        })
        if (original === undefined) {
          yield* settle(input.accountId, input.pieceId, 'refunded')
          return kept
        }
        const outcome = yield* largestGarment(original).pipe(
          Effect.map((png) => ({ png, settle: 'consumed' as const })),
          // A failure worth retrying goes back to the queue with the credit still held; a refusal keeps the
          // original photo and gives the credit back; a lost answer keeps it too, and may have been billed.
          Effect.catchTags({
            ProviderFailed: ({ retryable }) =>
              retryable
                ? Effect.fail(CutoutFailed.make({}))
                : Effect.succeed({ png: Option.none<Uint8Array>(), settle: 'refunded' as const }),
            ProviderOutcomeUnknown: () =>
              Effect.succeed({ png: Option.none<Uint8Array>(), settle: 'consumed' as const }),
          }),
        )
        const png = outcome.png
        if (Option.isSome(png)) {
          const key = `${accountPrefix(input.accountId)}pieces/${input.pieceId}/cutout.png`
          yield* Effect.tryPromise({
            try: () => bucket.put(key, png.value, { httpMetadata: { contentType: 'image/png' } }),
            catch: () => CutoutFailed.make({}),
          })
          yield* settle(input.accountId, input.pieceId, outcome.settle)
          return { imageKey: key }
        }
        yield* settle(input.accountId, input.pieceId, outcome.settle)
        return kept
      })
      /** The queue gave up on the piece: its held credit comes back. */
      const release = Effect.fn('Styld.Capture.pieceCutoutRelease')(function* (input: {
        readonly accountId: string
        readonly pieceId: string
      }) {
        yield* settle(input.accountId, input.pieceId, 'refunded')
      })
      return {
        cut: (input) => cut(input).pipe(Effect.provide(services)),
        release: (input) => release(input).pipe(Effect.provide(services)),
      }
    }),
  )
