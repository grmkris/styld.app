import { Effect, Option } from 'effect'
import { CaptureConfig, type CapturePolicy } from './Policy.ts'
import { type Parts, captureKey, readObject, unavailable, writeObject } from './Parts.ts'
import { type Box, cutOut, decodedPng, encodePng, opaqueBounds, crop, type Rgba } from './Pixels.ts'
import { GarmentSegmenter, GarmentVision, PictureWork, type Route, type WorkingCopies } from './Providers.ts'
import type { CaptureRow, DetectionRow } from './Store.ts'

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

/** SAM for every garment in a photo: each mask cut from the real pixels of the working copy. */
export const segmentedPieces = (
  picture: Rgba,
  found: ReadonlyArray<{
    readonly bounds: Box
    readonly raster: Uint8Array
    readonly track: string
    readonly confidence: number
  }>,
) =>
  found.flatMap((mask): ReadonlyArray<CutPiece> => {
    const area = mask.raster.reduce((sum, value) => sum + (value === 0 ? 0 : 1), 0)
    if (area < minimumShare * picture.width * picture.height) return []
    const piece = cutOut(picture, mask)
    return [{ png: encodePng(piece), bounds: mask.bounds, area, track: mask.track, confidence: mask.confidence }]
  })

/** SAM for every garment in a photo's working copy, the largest first. */
export const samPieces = (copies: WorkingCopies) =>
  Effect.gen(function* () {
    const segmenter = yield* GarmentSegmenter
    const found = yield* segmenter.still({ bytes: copies.jpeg, contentType: 'image/jpeg' }, 'clothing')
    return segmentedPieces(yield* decodedPng(copies.png), found)
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

/** Store each cut-out and ask the decision model about it, as detections waiting in the tray. */
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
        const id = yield* parts.randomId('dt')
        const key = captureKey(capture.accountId, capture.id, `${id}.png`)
        yield* writeObject(parts, key, piece.png, 'image/png')
        const small = yield* (yield* PictureWork).thumbnail(piece.png, 512)
        const suggestion = yield* (yield* GarmentVision).suggest({ bytes: small, contentType: 'image/webp' })
        return {
          id,
          captureId: capture.id,
          accountId: capture.accountId,
          status: 'review',
          cutoutKey: key,
          sourceKey,
          backCutoutKey: null,
          track: piece.track,
          confidence: piece.confidence,
          preselected: preselect(piece) && suggestion.category !== undefined,
          suggestedCategory: suggestion.category ?? null,
          suggestedSubcategory: suggestion.subcategory ?? null,
          suggestedColours: suggestion.colours,
          pieceId: null,
          createdAt: capture.createdAt,
        } satisfies DetectionRow
      }),
    { concurrency: 4 },
  )

/** A detection that keeps the original photo: providers off, or nothing could be cut out. */
export const originalOnly = (parts: Parts, capture: CaptureRow, sourceKey: string) =>
  Effect.map(parts.randomId('dt'), (id): DetectionRow => ({
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
    suggestedCategory: null,
    suggestedSubcategory: null,
    suggestedColours: [],
    pieceId: null,
    createdAt: capture.createdAt,
  }))

/** Who cuts a photo out: nobody when the decision model is sure it shows no garment; background removal
 * for one garment it is sure of; SAM otherwise. A camera shot always goes to SAM, because the person
 * holding the garment is in it, and background removal keeps everything in the foreground.
 * @internal Exported for its tests. */
export const cutterFor = (
  source: CaptureRow['source'],
  route: Route,
  policy: Pick<CapturePolicy, 'single' | 'routeConfidence'>,
): 'none' | 'cloudflare' | 'sam' => {
  const sure = route.confidence >= policy.routeConfidence
  if (route.garments === 'none' && sure) return 'none'
  return source !== 'camera' && route.garments === 'one' && sure && policy.single === 'cloudflare'
    ? 'cloudflare'
    : 'sam'
}

/** The pieces of a photo the decision model did not call empty: background removal (falling back to SAM
 * when it finds nothing), or SAM. */
const cutPieces = (original: Uint8Array, copies: WorkingCopies, cutter: 'cloudflare' | 'sam') =>
  Effect.gen(function* () {
    if (cutter === 'sam') return { pieces: yield* samPieces(copies), provider: 'sam' }
    const foreground = yield* foregroundPiece(original)
    return foreground.length > 0
      ? { pieces: foreground, provider: 'cloudflare' }
      : { pieces: yield* samPieces(copies), provider: 'sam' }
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
  const cutter = cutterFor(capture.source, route, policy)
  if (cutter === 'none') return { found: [], route, provider: 'clef' }
  const { pieces, provider } = yield* cutPieces(original.value, copies, cutter)
  const held = capture.source === 'camera' ? heldPiece(pieces, copies.width, copies.height) : undefined
  const found = yield* detectionsOf(parts, capture, capture.originalKey, pieces, (piece) =>
    held === undefined ? true : piece === held,
  )
  return { found, route, provider }
})
