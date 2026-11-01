import { Effect, Option } from 'effect'
import { refinedCutOut } from './Matte.ts'
import { CaptureConfig, type CapturePolicy } from './Policy.ts'
import { type Parts, captureKey, readObject, unavailable, writeObject } from './Parts.ts'
import {
  type Box,
  cutOut,
  decodedPng,
  encodePng,
  fitMask,
  opaqueBounds,
  overlapShare,
  crop,
  type Rgba,
} from './Pixels.ts'
import { GarmentSegmenter, GarmentVision, PictureWork, type Route, type WorkingCopies } from './Providers.ts'
import type { Found } from './SamStream.ts'
import type { CaptureRow, DetectionRow } from './Store.ts'
import { newId } from '../kernel/Ids.ts'

/** One garment cut out of a photo, before it is stored. */
export interface CutPiece {
  readonly png: Uint8Array
  readonly bounds: Box
  readonly area: number
  readonly track: string
  readonly confidence: number
}

/** Ignore specks: a garment covers at least this share of the photo. */
const minimumShare = 0.004

/** At most this many pieces from one photo, the largest first: each costs a thumbnail and a suggestion. */
const maximumPieces = 20

/** Background removal for a photo of one garment: the foreground, cropped to what is opaque. */
export const foregroundPiece = (original: Uint8Array) =>
  Effect.gen(function* () {
    const work = yield* PictureWork
    const foreground = yield* decodedPng(yield* work.foreground(original))
    const bounds = opaqueBounds(foreground)
    if (bounds === undefined) return []
    const piece = crop(foreground, bounds)
    const area = (bounds.right - bounds.left) * (bounds.bottom - bounds.top)
    if (area < minimumShare * foreground.width * foreground.height) return []
    return [{ png: encodePng(piece), bounds, area, track: '0', confidence: 1 }]
  })

/** Each SAM mask, in `from` coordinates (SAM's frame, or the picture itself), cut from the picture's real
 * pixels: with its edge refined against the photo, or scaled by nearest pixel. */
export const segmentedPieces = (
  picture: Rgba,
  found: ReadonlyArray<{
    readonly bounds: Box
    readonly raster: Uint8Array
    readonly track: string
    readonly confidence: number
  }>,
  from: { readonly width: number; readonly height: number },
  edges: CapturePolicy['edges'],
) =>
  found.flatMap((mask): ReadonlyArray<CutPiece> => {
    const smallest = minimumShare * picture.width * picture.height
    const { track, confidence } = mask
    if (edges === 'refined') {
      const { piece, bounds, area } = refinedCutOut(picture, mask, from)
      return piece.width === 0 || area < smallest ? [] : [{ png: encodePng(piece), bounds, area, track, confidence }]
    }
    const fitted = fitMask(mask, from, picture)
    const area = fitted.raster.reduce((sum, value) => sum + (value === 0 ? 0 : 1), 0)
    if (area < smallest) return []
    return [{ png: encodePng(cutOut(picture, fitted)), bounds: fitted.bounds, area, track, confidence }]
  })

/** What SAM is asked for besides clothing in a photo of several pieces or of pieces laid out: "clothing" misses
 * shoes, bags and hats (capture brainstorm, 30 October). Each is one more call. */
export const morePrompts = ['shoes', 'bag', 'hat'] as const

/** The masks SAM found for each prompt, in order, less any mostly covered by a mask of an earlier prompt: a shoe
 * found as clothing and again as shoes is one piece. Another prompt's tracks are named after it, to stay apart.
 * @internal Exported for its tests. */
export const distinctMasks = (
  answers: ReadonlyArray<{ readonly prompt: string; readonly found: ReadonlyArray<Found> }>,
) =>
  answers.reduce<ReadonlyArray<Found>>(
    (kept, { prompt, found }) => [
      ...kept,
      ...found
        .filter((mask) => kept.every((other) => overlapShare(mask, other) <= 0.5))
        .map((mask) => (prompt === 'clothing' ? mask : { ...mask, track: `${prompt}-${mask.track}` })),
    ],
    [],
  )

/** SAM for every garment in a photo's working copy, and for each of `more` after it, the largest first. Clothing is
 * the photo's answer; another prompt is a best effort, whose failure leaves its pieces out rather than paying for
 * clothing again. */
export const samPieces = (copies: WorkingCopies, more: ReadonlyArray<string> = []) =>
  Effect.gen(function* () {
    const segmenter = yield* GarmentSegmenter
    const sent = { bytes: copies.jpeg, contentType: 'image/jpeg' } as const
    const [clothing, others] = yield* Effect.all(
      [
        segmenter.still(sent, 'clothing'),
        Effect.forEach(
          more,
          (prompt) =>
            segmenter.still(sent, prompt).pipe(
              Effect.map((found) => ({ prompt, found })),
              Effect.orElseSucceed(() => ({ prompt, found: [] })),
            ),
          { concurrency: 'unbounded' },
        ),
      ],
      { concurrency: 'unbounded' },
    )
    const found = distinctMasks([{ prompt: 'clothing', found: clothing }, ...others])
    const picture = yield* decodedPng(copies.png)
    return segmentedPieces(picture, found, picture, (yield* CaptureConfig).edges)
      .toSorted((a, b) => b.area - a.area)
      .slice(0, maximumPieces)
  })

/** The piece a camera shot is about: the largest, nearest the middle. Clothes the person wears also show. */
const heldPiece = (pieces: ReadonlyArray<CutPiece>, width: number, height: number) => {
  const centre = (box: Box) =>
    Math.hypot((box.left + box.right) / 2 - width / 2, (box.top + box.bottom) / 2 - height / 2)
  const score = (piece: CutPiece) => piece.area / (width * height) - centre(piece.bounds) / Math.hypot(width, height)
  return pieces.reduce<CutPiece | undefined>(
    (best, piece) => (best === undefined || score(piece) > score(best) ? piece : best),
    undefined,
  )
}

/** What happens to a cut-out, by how likely the decision model thinks it is one whole garment. On 119 cut-outs
 * from real videos (2026-10-30: a rail filmed close up, a try-on video, garments held up, a drawn rail), 15 of the
 * 16 usable pieces scored at least 0.5 and the 16th 0.497; 93 of the 103 others scored under 0.2.
 * @internal Exported for its tests. */
export const verdictOf = (whole: number): 'drop' | 'offer' | 'preselect' =>
  whole < 0.2 ? 'drop' : whole < 0.5 ? 'offer' : 'preselect'

/** Ask the decision model about each cut-out and store the ones worth showing, as detections waiting in the
 * tray: a whole garment preselected, part of one offered unticked, a scrap dropped. */
export const detectionsOf = (
  parts: Parts,
  capture: CaptureRow,
  sourceKey: string,
  pieces: ReadonlyArray<CutPiece>,
  preselect: (piece: CutPiece) => boolean,
) =>
  Effect.forEach(
    pieces,
    (piece) =>
      Effect.gen(function* () {
        const small = yield* (yield* PictureWork).thumbnail(piece.png, 512)
        const suggestion = yield* (yield* GarmentVision).suggest({ bytes: small, contentType: 'image/webp' })
        const verdict = verdictOf(suggestion.whole)
        if (verdict === 'drop') return []
        const id = yield* newId('dt')
        const key = captureKey(capture.accountId, capture.id, `${id}.png`)
        yield* writeObject(parts, key, piece.png, 'image/png')
        const detection = {
          id,
          captureId: capture.id,
          accountId: capture.accountId,
          status: 'review',
          cutoutKey: key,
          sourceKey,
          backCutoutKey: null,
          track: piece.track,
          confidence: piece.confidence,
          preselected: preselect(piece) && suggestion.type !== undefined && verdict === 'preselect',
          suggestedType: suggestion.type ?? null,
          suggestedColours: suggestion.colours,
          suggestedSeason: suggestion.season ?? null,
          suggestedOccasions: suggestion.occasions,
          suggestedPattern: suggestion.pattern ?? null,
          pieceId: null,
          whole: suggestion.whole,
          groupOf: null,
          duplicateOf: null,
          // A whole garment is compared with the import's other sightings and the wardrobe; a part of one is not.
          matching: verdict === 'preselect' && suggestion.type !== undefined ? 'waiting' : null,
          matchClaimedAt: null,
          createdAt: capture.createdAt,
        } satisfies DetectionRow
        return [detection]
      }),
    { concurrency: 4 },
  ).pipe(Effect.map((found) => found.flat()))

/** A detection that keeps the original photo: providers off, or nothing could be cut out. */
export const originalOnly = (parts: Parts, capture: CaptureRow, sourceKey: string) =>
  Effect.map(newId('dt'), (id): DetectionRow => ({
    id,
    captureId: capture.id,
    accountId: capture.accountId,
    status: 'review',
    cutoutKey: null,
    sourceKey,
    backCutoutKey: null,
    track: null,
    confidence: null,
    preselected: true,
    suggestedType: null,
    suggestedColours: [],
    suggestedSeason: null,
    suggestedOccasions: [],
    suggestedPattern: null,
    pieceId: null,
    whole: null,
    groupOf: null,
    duplicateOf: null,
    matching: null,
    matchClaimedAt: null,
    createdAt: capture.createdAt,
  }))

/** Whether a photo shows any part of a person. */
export const showsPerson = (route: Route) => route.person >= 0.5

/** Whether a photo is about one piece held up or shown: a camera shot, or a person in the picture, whose worn clothes
 * are offered unticked. Pieces laid out are all the subject, even with a hand at the edge or from the camera.
 * @internal Exported for its tests. */
export const holding = (capture: Pick<CaptureRow, 'source'>, route: Route) =>
  route.scene !== 'flat' && (capture.source === 'camera' || showsPerson(route))

/** Who cuts a photo out: nobody when the decision model is sure it shows no garment; background removal
 * for one garment it is sure of, with nobody in the picture, such as a piece laid flat; SAM otherwise.
 * Background removal keeps everything in the foreground, so a person holding or wearing the garment would
 * come out with it (11 of 26 such photos in the spike).
 * @internal Exported for its tests. */
export const cutterFor = (
  route: Route,
  policy: Pick<CapturePolicy, 'single' | 'routeConfidence'>,
): 'none' | 'cloudflare' | 'sam' => {
  const sure = route.confidence >= policy.routeConfidence
  if (route.garments === 'none' && sure) return 'none'
  return route.garments === 'one' && sure && !showsPerson(route) && policy.single === 'cloudflare'
    ? 'cloudflare'
    : 'sam'
}

/** The pieces of a photo the decision model did not call empty: background removal (falling back to SAM
 * when it finds nothing), or SAM, asked for shoes, bags and hats too when several pieces or a laid-out scene show. */
const cutPieces = (original: Uint8Array, copies: WorkingCopies, cutter: 'cloudflare' | 'sam', route: Route) =>
  Effect.gen(function* () {
    const more = route.garments === 'several' || route.scene === 'flat' ? morePrompts : []
    if (cutter === 'sam') return { pieces: yield* samPieces(copies, more), provider: 'sam' }
    const foreground = yield* foregroundPiece(original)
    return foreground.length > 0
      ? { pieces: foreground, provider: 'cloudflare' }
      : { pieces: yield* samPieces(copies, more), provider: 'sam' }
  })

/** Cut a photo into the pieces it shows. Returns the detections and how the photo was routed. */
export const processPhoto = Effect.fn('Styld.Capture.processPhoto')(function* (parts: Parts, capture: CaptureRow) {
  const policy = yield* CaptureConfig
  if (policy.providers === 'off')
    return { found: [yield* originalOnly(parts, capture, capture.originalKey)], route: null, provider: 'off' }
  const original = yield* readObject(parts, capture.originalKey)
  if (Option.isNone(original)) return yield* unavailable()
  const copies = yield* (yield* PictureWork).workingCopies(original.value)
  const route = yield* (yield* GarmentVision).route({ bytes: copies.small, contentType: 'image/jpeg' })
  const cutter = cutterFor(route, policy)
  if (cutter === 'none') return { found: [], route, provider: 'clef' }
  const { pieces, provider } = yield* cutPieces(original.value, copies, cutter, route)
  const held = holding(capture, route) ? heldPiece(pieces, copies.width, copies.height) : undefined
  const found = yield* detectionsOf(parts, capture, capture.originalKey, pieces, (piece) =>
    held === undefined ? true : piece === held,
  )
  return { found, route, provider }
})
