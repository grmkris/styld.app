import { Effect, Layer, Option } from 'effect'
import { accountPrefix } from '../wardrobe/Media.ts'
import { CutoutFailed, GarmentCutout } from '../wardrobe/Processing.ts'
import type { WardrobeBindings } from '../wardrobe/Wardrobe.ts'
import { CaptureMetrics } from './Metrics.ts'
import { decodePng, encodePng, opaqueBounds, crop } from './Pixels.ts'
import { CaptureConfig } from './Policy.ts'
import { type CutPiece, segmentedPieces } from './PhotoPipeline.ts'
import { GarmentSegmenter, GarmentVision, PictureWork } from './Providers.ts'
import { Usage } from './Usage.ts'

type Requirements = GarmentVision | PictureWork | GarmentSegmenter | Usage | CaptureConfig | CaptureMetrics

/** The largest garment in a piece's photo: what an assistant meant when it added one piece. */
const largestGarment = (original: Uint8Array) =>
  Effect.gen(function* () {
    const policy = yield* CaptureConfig
    const work = yield* PictureWork
    const copies = yield* work.workingCopies(original)
    const route = yield* (yield* GarmentVision).route({ bytes: copies.small, contentType: 'image/jpeg' })
    if (route.garments === 'one' && route.confidence >= policy.routeConfidence && policy.single === 'cloudflare') {
      const foreground = decodePng(yield* work.foreground(original))
      const bounds = opaqueBounds(foreground)
      if (bounds !== undefined) return Option.some(encodePng(crop(foreground, bounds)))
    }
    const found = yield* (yield* GarmentSegmenter).still({ bytes: copies.jpeg, contentType: 'image/jpeg' }, 'clothing')
    const pieces = segmentedPieces(decodePng(copies.png), found)
    const largest = pieces.reduce<CutPiece | undefined>(
      (best, piece) => (best === undefined || piece.area > best.area ? piece : best),
      undefined,
    )
    return Option.fromNullishOr(largest?.png)
  })

/** The garment cut-out behind `piece_add`: the same providers as the tray, without a review step,
 * because the person asked their assistant for this piece. It costs a photo's credit; past the daily
 * limit, or when nothing can be cut out, the piece keeps its original photo. */
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
        const usage = yield* Usage
        const operation = `piece/${input.pieceId}`
        const held = yield* usage.reserve(input.accountId, operation, policy.credits.photo).pipe(
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
        if (original === undefined) return kept
        const outcome = yield* largestGarment(original).pipe(
          Effect.map((png) => ({ png, settle: 'consumed' as const })),
          // A failure worth retrying gives the credit back and goes to the queue; a refusal keeps the
          // original photo; a lost answer keeps it too, and may have been billed.
          Effect.catchTags({
            ProviderFailed: ({ retryable }) =>
              retryable
                ? usage
                    .settle(input.accountId, operation, 'refunded')
                    .pipe(Effect.ignore, Effect.andThen(Effect.fail(CutoutFailed.make({}))))
                : Effect.succeed({ png: Option.none<Uint8Array>(), settle: 'refunded' as const }),
            ProviderOutcomeUnknown: () =>
              Effect.succeed({ png: Option.none<Uint8Array>(), settle: 'consumed' as const }),
          }),
        )
        yield* usage.settle(input.accountId, operation, outcome.settle).pipe(Effect.ignore)
        const png = outcome.png
        if (Option.isNone(png)) return kept
        const key = `${accountPrefix(input.accountId)}pieces/${input.pieceId}/cutout.png`
        yield* Effect.tryPromise({
          try: () => bucket.put(key, png.value, { httpMetadata: { contentType: 'image/png' } }),
          catch: () => CutoutFailed.make({}),
        })
        return { imageKey: key }
      })
      return { cut: (input) => cut(input).pipe(Effect.provide(services)) }
    }),
  )
