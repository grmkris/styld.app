import { Effect, Layer, Option } from 'effect'
import { accountPrefix } from '../wardrobe/Media.ts'
import { type CutSide, CutoutFailed, GarmentCutout } from '../wardrobe/Processing.ts'
import type { WardrobeBindings } from '../wardrobe/Parts.ts'
import { CaptureMetrics } from './Metrics.ts'
import { CaptureConfig } from './Policy.ts'
import { cutterFor, foregroundPiece, samPieces } from './PhotoPipeline.ts'
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
    if (cutterFor(route, policy) === 'cloudflare') {
      const [foreground] = yield* foregroundPiece(original)
      if (foreground !== undefined) return Option.some(foreground.png)
    }
    const [largest] = yield* samPieces(copies)
    return Option.fromNullishOr(largest?.png)
  })

/** A side's credit in the Wallet: the front's once per piece, a back's once per upload. */
const holdOf = (pieceId: string, of: CutSide) =>
  of.side === 'front' ? `piece/${pieceId}` : `piece/${pieceId}/back/${of.uploadId}`

/** Where a side's cut-out is stored. */
const keyOf = (accountId: string, pieceId: string, of: CutSide) =>
  `${accountPrefix(accountId)}pieces/${pieceId}/${of.side === 'front' ? 'cutout' : `back-${of.uploadId}`}.png`

/** Consume or refund a side's credit. The Wallet answers a repeated settle as already done. */
const settle = (accountId: string, hold: string, outcome: 'consumed' | 'refunded') =>
  Effect.gen(function* () {
    yield* (yield* Usage).settle(accountId, hold, outcome)
  }).pipe(Effect.mapError(() => CutoutFailed.make({})))

/** The garment cut-out behind `piece_add` and a back added on the piece's page: the same providers as the tray,
 * without a review step, because the person asked for this piece. It costs a photo's credit, held across the
 * attempts and given back only when the work gives up (`release`). Past the daily limit, or when nothing can be cut
 * out, the side keeps its original photo. */
export const pieceCutout = (bucket: WardrobeBindings['bucket']) =>
  Layer.effect(
    GarmentCutout,
    Effect.gen(function* () {
      const services = yield* Effect.context<Requirements>()
      const cut = Effect.fn('Styld.Capture.pieceCutout')(function* (input: {
        readonly accountId: string
        readonly pieceId: string
        readonly originalKey: string
        readonly of: CutSide
      }) {
        const policy = yield* CaptureConfig
        const kept = { imageKey: input.originalKey }
        if (policy.providers === 'off') return kept
        const hold = holdOf(input.pieceId, input.of)
        // A retried attempt repeats the same reservation, which the Wallet answers as already held.
        const held = yield* (yield* Usage).reserve(input.accountId, hold, policy.credits.photo).pipe(
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
          yield* settle(input.accountId, hold, 'refunded')
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
          const key = keyOf(input.accountId, input.pieceId, input.of)
          yield* Effect.tryPromise({
            try: () => bucket.put(key, png.value, { httpMetadata: { contentType: 'image/png' } }),
            catch: () => CutoutFailed.make({}),
          })
          yield* settle(input.accountId, hold, outcome.settle)
          return { imageKey: key }
        }
        yield* settle(input.accountId, hold, outcome.settle)
        return kept
      })
      /** The work gave up on the side: its held credit comes back. */
      const release = Effect.fn('Styld.Capture.pieceCutoutRelease')(function* (input: {
        readonly accountId: string
        readonly pieceId: string
        readonly of: CutSide
      }) {
        yield* settle(input.accountId, holdOf(input.pieceId, input.of), 'refunded')
      })
      return {
        cut: (input) => cut(input).pipe(Effect.provide(services)),
        release: (input) => release(input).pipe(Effect.provide(services)),
      }
    }),
  )
