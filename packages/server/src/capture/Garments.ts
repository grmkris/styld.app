import { type PieceType, slotOf, type Unavailable } from '@styld/protocol'
import { encodePng, modelPicture, opaqueBounds, type Rgba } from '@styld/imaging'
import { Array, Context, Effect, Layer, Option, Record } from 'effect'
import type { ProviderError } from '../providers/Errors.ts'
import { bestSightings, type SampledStill } from './FrameRanking.ts'
import {
  type Cut,
  cutsOf,
  cutterFor,
  distinctMasks,
  foregroundCut,
  heldOf,
  holding,
  kindPrompt,
  pieceOfKind,
  promptsFor,
  verdictOf,
  withPairsJoined,
} from './GarmentRules.ts'
import { decodedPng } from './Pixels.ts'
import { capturePolicy } from './Policy.ts'
import {
  GarmentSegmenter,
  GarmentVision,
  PictureWork,
  type Route,
  type StoredVideo,
  type Suggestion,
  type WorkingCopies,
} from './Providers.ts'

// The one garment pipeline (cleanup C4a): every intent's route, cutter, SAM prompts, mask selection, pair joining,
// caps and descriptions are decided here, by the rules in `GarmentRules.ts`. Its callers only store what it found:
// capture as detections in the tray, My Gallery as an outfit photo's garments, the wardrobe as a piece's cut-out. The
// native suite provides a fake of this service (`test/fakes/Garments.ts`).

/** The size of the copy the decision model judges a cut-out from (and compares, and checks a turn's frames at). */
export const judgedAt = 512

/** One garment found in a picture: its cut-out, how SAM tracked it, what the decision model suggests it is, and
 * whether it is offered ticked (a whole garment of a known kind, and the one held up when a photo is about one). */
export interface Garment {
  readonly picture: Rgba
  readonly png: Uint8Array
  readonly track: string
  readonly confidence: number
  readonly suggestion: Suggestion
  readonly preselect: boolean
}

/** What a photo showed: its garments, how it was routed and who cut it. */
export interface Finding {
  readonly garments: ReadonlyArray<Garment>
  readonly route: Option.Option<Route>
  readonly provider: string
}

/** A video handed to SAM, with the stills the browser sampled from it at the frames SAM sees them in, and how to read
 * a still. A garment of a video is cut from the still that shows it best. */
export interface VideoToTrack {
  readonly fileId: string
  readonly stills: ReadonlyArray<{ readonly key: string; readonly frame: number } & SampledStill>
  /** The frame size to place masks in when SAM does not say. */
  readonly frameSize: { readonly width: number; readonly height: number }
  readonly read: (key: string) => Effect.Effect<Option.Option<Uint8Array>, Unavailable>
}

/** The garment pipeline. */
export class Garments extends Context.Service<
  Garments,
  {
    /** The garments in a photo for the review tray (from the camera or not) or for My Gallery. */
    readonly find: (
      photo: Uint8Array,
      intent: { readonly for: 'tray'; readonly camera: boolean } | { readonly for: 'gallery' },
    ) => Effect.Effect<Finding, ProviderError>
    /** The one cut-out a piece's own photo shows (a pair of shoes as one), or the person in an outfit photo. */
    readonly cut: (
      photo: Uint8Array,
      intent: { readonly for: 'piece'; readonly type: PieceType } | { readonly for: 'person' },
    ) => Effect.Effect<Option.Option<Uint8Array>, ProviderError>
    /** Hand a stored video to SAM; its file id, which `track` reads. Handing it over again is safe. */
    readonly handOver: (video: StoredVideo) => Effect.Effect<string, ProviderError>
    /** The garments of a handed-over video, each cut from its best still; the file at SAM is forgotten after. */
    readonly track: (
      video: VideoToTrack,
    ) => Effect.Effect<ReadonlyArray<Garment & { readonly still: string }>, ProviderError | Unavailable>
  }
>()('@styld/server/capture/Garments') {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const providers: Providers = {
        vision: yield* GarmentVision,
        work: yield* PictureWork,
        segmenter: yield* GarmentSegmenter,
      }
      return Garments.of({
        find: Effect.fn('Styld.Garments.find')(function* (photo, intent) {
          yield* Effect.annotateCurrentSpan('styld.garments.intent', intent.for)
          return intent.for === 'tray'
            ? yield* forTray(providers, photo, intent.camera)
            : yield* forGallery(providers, photo)
        }),
        cut: Effect.fn('Styld.Garments.cut')(function* (photo, intent) {
          yield* Effect.annotateCurrentSpan('styld.garments.intent', intent.for)
          return intent.for === 'piece'
            ? yield* pieceIn(providers, photo, intent.type)
            : yield* personIn(providers, photo)
        }),
        handOver: Effect.fn('Styld.Garments.handOver')(function* (video) {
          return yield* providers.segmenter.upload(video)
        }),
        track: Effect.fn('Styld.Garments.track')(function* (video) {
          return yield* inVideo(providers, video)
        }),
      })
    }),
  )
}

interface Providers {
  readonly vision: GarmentVision['Service']
  readonly work: PictureWork['Service']
  readonly segmenter: GarmentSegmenter['Service']
}

/** SAM on a working copy for each prompt: the first is the picture's answer; a later one is a best effort, whose
 * failure leaves its pieces out rather than paying for the first again. The cuts, largest first. */
const samCuts = Effect.fnUntraced(function* (
  providers: Providers,
  copies: WorkingCopies,
  [first, ...more]: readonly [string, ...Array<string>],
) {
  const sent = { bytes: copies.jpeg, contentType: 'image/jpeg' } as const
  const [found, others] = yield* Effect.all(
    [
      providers.segmenter.still(sent, first),
      Effect.forEach(
        more,
        (prompt) =>
          providers.segmenter.still(sent, prompt).pipe(
            Effect.map((masks) => ({ prompt, found: masks })),
            Effect.orElseSucceed(() => ({ prompt, found: [] })),
          ),
        { concurrency: 'unbounded' },
      ),
    ],
    { concurrency: 'unbounded' },
  )
  const picture = yield* decodedPng(copies.png)
  return cutsOf(picture, distinctMasks([{ prompt: first, found }, ...others]), picture)
})

/** Background removal: the whole foreground as one cut, none when nothing is in front. */
const foregroundOf = Effect.fnUntraced(function* (providers: Providers, original: Uint8Array) {
  const foreground = yield* decodedPng(yield* providers.work.foreground(original))
  return foregroundCut(foreground, opaqueBounds(foreground))
})

/** A cut described by the decision model, from the copy it judges; a scrap is none. */
const described = Effect.fnUntraced(function* (providers: Providers, cut: Cut) {
  const suggestion = yield* providers.vision.suggest(modelPicture(cut.picture, judgedAt))
  return verdictOf(suggestion.whole) === 'drop' ? Option.none() : Option.some({ ...cut, suggestion })
})

type Described = Cut & { readonly suggestion: Suggestion }

/** Two shoes of one kind and colour are one pair. */
const pairKind = ({ suggestion }: Described) =>
  Option.filter(Option.fromNullishOr(suggestion.type), (type) => slotOf(type) === 'shoes').pipe(
    Option.map((type) => `${type}/${suggestion.colours[0] ?? ''}`),
  )

/** Each cut described, scraps dropped, a pair joined into one piece (whole as its surer half). */
const describedPieces = Effect.fnUntraced(function* (providers: Providers, cuts: ReadonlyArray<Cut>, most: number) {
  const found = yield* Effect.forEach(cuts.slice(0, most), (cut) => described(providers, cut), { concurrency: 4 })
  const pieces = found.flatMap(Option.toArray)
  return withPairsJoined(pieces, pairKind).map((piece) => {
    const halves = pieces.filter(({ track }) => piece.track.split('+').includes(track))
    const whole = Math.max(...halves.map(({ suggestion }) => suggestion.whole))
    return { ...piece, suggestion: { ...piece.suggestion, whole } }
  })
})

const garmentOf = (piece: Described, held: boolean): Garment => ({
  picture: piece.picture,
  png: encodePng(piece.picture),
  track: piece.track,
  confidence: piece.confidence,
  suggestion: piece.suggestion,
  preselect: held && piece.suggestion.type !== undefined && verdictOf(piece.suggestion.whole) === 'preselect',
})

/** A tray photo: routed, cut by background removal (SAM when it finds nothing) or SAM, described, and when the photo
 * is about one piece held up, only that one offered ticked. */
const forTray = Effect.fnUntraced(function* (providers: Providers, original: Uint8Array, camera: boolean) {
  const copies = yield* providers.work.workingCopies(original)
  const route = yield* providers.vision.route({ bytes: copies.small, contentType: 'image/jpeg' })
  const cutter = cutterFor('tray', route)
  if (cutter === 'none') return { garments: [], route: Option.some(route), provider: 'clef' } satisfies Finding
  const foreground = cutter === 'cloudflare' ? yield* foregroundOf(providers, original) : Option.none<Cut>()
  const cuts = Option.isSome(foreground)
    ? [foreground.value]
    : yield* samCuts(providers, copies, promptsFor({ for: 'tray', route }))
  const pieces = yield* describedPieces(providers, cuts, capturePolicy.garments.pieces.tray)
  const held = holding(camera, route) ? heldOf(pieces, copies) : undefined
  return {
    garments: pieces.map((piece) => garmentOf(piece, held === undefined || piece === held)),
    route: Option.some(route),
    provider: Option.isSome(foreground) ? 'cloudflare' : 'sam',
  } satisfies Finding
})

/** An outfit photo: every garment the person wears counts, so there is no route and no held piece. */
const forGallery = Effect.fnUntraced(function* (providers: Providers, original: Uint8Array) {
  const copies = yield* providers.work.workingCopies(original)
  const cuts = yield* samCuts(providers, copies, promptsFor('gallery'))
  const pieces = yield* describedPieces(providers, cuts, capturePolicy.garments.pieces.gallery)
  return {
    garments: pieces.map((piece) => garmentOf(piece, true)),
    route: Option.none(),
    provider: 'sam',
  } satisfies Finding
})

/** A piece's own photo: background removal when nobody is in it, falling back to SAM, which is asked for the piece's
 * kind too and takes the largest of it (a pair of shoes as one). */
const pieceIn = Effect.fnUntraced(function* (providers: Providers, original: Uint8Array, type: PieceType) {
  const copies = yield* providers.work.workingCopies(original)
  const route = yield* providers.vision.route({ bytes: copies.small, contentType: 'image/jpeg' })
  if (cutterFor('piece', route) === 'cloudflare') {
    const foreground = yield* foregroundOf(providers, original)
    if (Option.isSome(foreground)) return Option.some(encodePng(foreground.value.picture))
  }
  const kind = kindPrompt(type)
  const cuts = yield* samCuts(providers, copies, promptsFor({ for: 'piece', type }))
  const pairs = withPairsJoined(cuts, ({ track }) =>
    Option.filter(kind, (prompt) => prompt === 'shoes' && track.startsWith(`${prompt}-`)),
  )
  return Option.map(pieceOfKind(pairs, kind), ({ picture }) => encodePng(picture))
})

/** The person in an outfit photo: the largest SAM finds. */
const personIn = Effect.fnUntraced(function* (providers: Providers, original: Uint8Array) {
  const copies = yield* providers.work.workingCopies(original)
  const [person] = yield* samCuts(providers, copies, promptsFor('person'))
  return Option.map(Option.fromNullishOr(person), ({ picture }) => encodePng(picture))
})

/** A video's garments: SAM tracks clothing through it, each track's best sighting is cut from its still (each still's
 * working copies made once), described, and a pair seen in one still joined. */
const inVideo = Effect.fnUntraced(function* (providers: Providers, video: VideoToTrack) {
  const [prompt] = promptsFor('video')
  const frames = new Set(video.stills.map(({ frame }) => frame))
  const tracked = yield* providers.segmenter
    .track(video.fileId, prompt, frames)
    .pipe(Effect.ensuring(providers.segmenter.forget(video.fileId)))
  const frameSize = tracked.frameSize ?? video.frameSize
  const stills = new Map(video.stills.map((still) => [still.frame, { ...still, ...frameSize }]))
  const sightings = tracked.found.map((found) => ({
    track: found.track,
    frame: found.frame,
    bounds: found.bounds,
    area: found.raster.reduce((total, value) => total + (value === 0 ? 0 : 1), 0),
    confidence: found.confidence,
  }))
  const masks = new Map(tracked.found.map((found) => [`${found.track}@${found.frame}`, found]))
  const best = bestSightings(sightings, stills)
    .toSorted((a, b) => b.sighting.area - a.sighting.area)
    .slice(0, capturePolicy.garments.pieces.video)
  const byStill = Record.toEntries(Array.groupBy(best, ({ still }) => still.key))
  const found = yield* Effect.forEach(
    byStill,
    ([key, inStill]) =>
      Effect.gen(function* () {
        const bytes = yield* video.read(key)
        if (Option.isNone(bytes)) return []
        const picture = yield* decodedPng((yield* providers.work.workingCopies(bytes.value)).png)
        const cuts = cutsOf(
          picture,
          inStill.flatMap(({ sighting }) =>
            Option.toArray(
              Option.map(Option.fromNullishOr(masks.get(`${sighting.track}@${sighting.frame}`)), (mask) => ({
                ...mask,
                track: sighting.track,
                confidence: sighting.confidence,
              })),
            ),
          ),
          frameSize,
        )
        const pieces = yield* describedPieces(providers, cuts, cuts.length)
        return pieces.map((piece) => ({ ...garmentOf(piece, true), still: key }))
      }),
    { concurrency: 2 },
  )
  return found.flat()
})
