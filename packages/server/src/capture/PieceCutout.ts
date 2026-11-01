import { type PieceType, prices, slotOf } from '@styld/protocol'
import { Effect, Layer, Option, Schema } from 'effect'
import { accountPrefix } from '../wardrobe/Media.ts'
import { type CutSide, CutoutFailed, GarmentCutout } from '../wardrobe/Processing.ts'
import type { WardrobeBindings } from '../wardrobe/Parts.ts'
import { CaptureMetrics } from './Metrics.ts'
import { CaptureConfig } from './Policy.ts'
import { type CutPiece, foregroundPiece, type morePrompts, samPieces, showsPerson } from './PhotoPipeline.ts'
import { GarmentSegmenter, GarmentVision, PictureWork, type Route } from './Providers.ts'
import { Holds, holdId, metered } from '../usage/Holds.ts'

type Requirements = GarmentVision | PictureWork | GarmentSegmenter | Holds | CaptureConfig | CaptureMetrics
type CutInput = Parameters<GarmentCutout['Service']['cut']>[0]

/** Who cuts out a piece's own photo. The person named the piece, so with nobody in the picture its whole foreground is
 * the piece, a pair of shoes or gloves included, which the route counts as two (v1 product shots carried over, 1 November:
 * every pair went to SAM and came back empty). With a person in it, background removal would keep the person.
 * @internal Exported for its tests. */
export const pieceCutterFor = (route: Route): 'cloudflare' | 'sam' => (showsPerson(route) ? 'sam' : 'cloudflare')

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
    const copies = yield* (yield* PictureWork).workingCopies(original)
    const route = yield* (yield* GarmentVision).route({ bytes: copies.small, contentType: 'image/jpeg' })
    if (pieceCutterFor(route) === 'cloudflare') {
      const [foreground] = yield* foregroundPiece(original)
      if (foreground !== undefined) return Option.some(foreground.png)
    }
    const kind = kindPrompt(type)
    return Option.map(pieceOfKind(yield* samPieces(copies, Option.toArray(kind)), kind), ({ png }) => png)
  })

/** A side's credit: the front's for each queue delivery that cuts it, a back's once for its upload. */
const holdOf = (pieceId: string, of: CutSide) =>
  of.side === 'front' ? holdId('piece', pieceId, of.attempt) : holdId('back', of.uploadId, 0)

/** Where a side's cut-out is stored. */
const keyOf = (accountId: string, pieceId: string, of: CutSide) =>
  `${accountPrefix(accountId)}pieces/${pieceId}/${of.side === 'front' ? 'cutout' : `back-${of.uploadId}`}.png`

/** Nothing to cut: the photo is gone, or no garment was found in it. The side keeps its photo, and its credit back. */
class NoCutout extends Schema.TaggedError<NoCutout>()('NoCutout', {}) {}

/** Cut the side out of its photo and store it. */
const cutAndStore = (bucket: WardrobeBindings['bucket'], input: CutInput) =>
  Effect.gen(function* () {
    const original = yield* Effect.tryPromise({
      try: async () => {
        const object = await bucket.get(input.originalKey)
        return object === null ? undefined : new Uint8Array(await object.arrayBuffer())
      },
      catch: () => CutoutFailed.make({}),
    })
    if (original === undefined) return yield* NoCutout.make({})
    const png = yield* pieceIn(original, input.type)
    if (Option.isNone(png)) return yield* NoCutout.make({})
    const key = keyOf(input.accountId, input.pieceId, input.of)
    yield* Effect.tryPromise({
      try: () => bucket.put(key, png.value, { httpMetadata: { contentType: 'image/png' } }),
      catch: () => CutoutFailed.make({}),
    })
    return { imageKey: key }
  })

/** The garment cut-out behind `piece_add` and a back added on the piece's page: the same providers as the tray,
 * without a review step, because the person asked for this piece. It costs a photo's credit, paid only for a cut-out
 * stored (`metered`). Past the daily limit, or when nothing can be cut out, the side keeps its original photo; a
 * provider that is busy fails the attempt for the queue to try again. */
export const pieceCutout = (bucket: WardrobeBindings['bucket']) =>
  Layer.effect(
    GarmentCutout,
    Effect.gen(function* () {
      const services = yield* Effect.context<Requirements>()
      const cut = Effect.fn('Styld.Capture.pieceCutout')(function* (input: CutInput) {
        const policy = yield* CaptureConfig
        const kept = { imageKey: input.originalKey }
        if (policy.providers === 'off') return kept
        const charge = { accountId: input.accountId, hold: holdOf(input.pieceId, input.of), credits: prices.photo }
        return yield* metered(charge, cutAndStore(bucket, input)).pipe(
          Effect.catchTags({
            LimitReached: () => Effect.succeed(kept),
            NoCutout: () => Effect.succeed(kept),
            // A refusal, or an answer lost after the provider took the work, keeps the photo; busy tries again.
            ProviderFailed: ({ retryable }) => (retryable ? CutoutFailed.make({}) : Effect.succeed(kept)),
            ProviderOutcomeUnknown: () => Effect.succeed(kept),
          }),
          Effect.mapError(() => CutoutFailed.make({})),
        )
      })
      return { cut: (input) => cut(input).pipe(Effect.provide(services)) }
    }),
  )
