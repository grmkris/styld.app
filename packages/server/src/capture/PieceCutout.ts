import { type PieceType, prices, slotOf } from '@styld/protocol'
import { Effect, Layer, Option } from 'effect'
import { accountPrefix } from '../wardrobe/Media.ts'
import { type CutSide, CutoutFailed, GarmentCutout } from '../wardrobe/Processing.ts'
import type { WardrobeBindings } from '../wardrobe/Parts.ts'
import { CaptureMetrics } from './Metrics.ts'
import { CaptureConfig, type CapturePolicy } from './Policy.ts'
import { type CutPiece, foregroundPiece, type morePrompts, samPieces, showsPerson } from './PhotoPipeline.ts'
import { GarmentSegmenter, GarmentVision, PictureWork, type Route } from './Providers.ts'
import { Usage } from './Usage.ts'

type Requirements = GarmentVision | PictureWork | GarmentSegmenter | Usage | CaptureConfig | CaptureMetrics

/** Who cuts out a piece's own photo. The person named the piece, so with nobody in the picture its whole foreground is
 * the piece, a pair of shoes or gloves included, which the route counts as two (v1 product shots carried over, 1 November:
 * every pair went to SAM and came back empty). With a person in it, background removal would keep the person.
 * @internal Exported for its tests. */
export const pieceCutterFor = (route: Route, policy: Pick<CapturePolicy, 'single'>): 'cloudflare' | 'sam' =>
  showsPerson(route) || policy.single === 'sam' ? 'sam' : 'cloudflare'

/** What SAM is asked for, besides clothing, to find a piece of this kind: "clothing" misses shoes, bags and hats.
 * @internal Exported for its tests. */
export const kindPrompt = (type: PieceType): Option.Option<(typeof morePrompts)[number]> => {
  if (slotOf(type) === 'shoes') return Option.some('shoes')
  if (type === 'bags') return Option.some('bag')
  return type === 'hats' ? Option.some('hat') : Option.none()
}

/** Of SAM's pieces, largest first, the largest found by the kind's own prompt, whose masks are tracked under its
 * name; else the largest garment.
 * @internal Exported for its tests. */
export const pieceOfKind = <Cut extends Pick<CutPiece, 'track'>>(
  pieces: ReadonlyArray<Cut>,
  kind: Option.Option<string>,
): Option.Option<Cut> =>
  Option.orElse(
    Option.flatMap(kind, (prompt) => Option.fromNullishOr(pieces.find(({ track }) => track.startsWith(`${prompt}-`)))),
    () => Option.fromNullishOr(pieces[0]),
  )

/** The piece in its own photo, cut out: background removal when nobody is in it, falling back to SAM. */
const pieceIn = (original: Uint8Array, type: PieceType) =>
  Effect.gen(function* () {
    const policy = yield* CaptureConfig
    const copies = yield* (yield* PictureWork).workingCopies(original)
    const route = yield* (yield* GarmentVision).route({ bytes: copies.small, contentType: 'image/jpeg' })
    if (pieceCutterFor(route, policy) === 'cloudflare') {
      const [foreground] = yield* foregroundPiece(original)
      if (foreground !== undefined) return Option.some(foreground.png)
    }
    const kind = kindPrompt(type)
    return Option.map(pieceOfKind(yield* samPieces(copies, Option.toArray(kind)), kind), ({ png }) => png)
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
        readonly type: PieceType
        readonly of: CutSide
      }) {
        const policy = yield* CaptureConfig
        const kept = { imageKey: input.originalKey }
        if (policy.providers === 'off') return kept
        const hold = holdOf(input.pieceId, input.of)
        // A retried attempt repeats the same reservation, which the Wallet answers as already held.
        const held = yield* (yield* Usage).reserve(input.accountId, hold, prices.photo).pipe(
          Effect.as(true),
          Effect.catchTag('LimitReached', () => Effect.succeed(false)),
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
        const outcome = yield* pieceIn(original, input.type).pipe(
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
