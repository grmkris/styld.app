import { type PieceType, slotOf } from '@styld/protocol'
import { type Box, crop, type Rgba } from '@styld/imaging'
import { Option } from 'effect'
import { refinedCutOut } from './Matte.ts'
import { type Mask, overlapShare } from './Pixels.ts'
import { capturePolicy } from './Policy.ts'
import type { Route } from './Providers.ts'
import type { Found } from './SamStream.ts'

// The garment pipeline's rules, each decided once for every intent: who cuts a picture out, what SAM is asked for,
// which masks are kept, which pieces are a pair, and what a description makes of a piece. Pure, so each is tested on
// recorded answers (`CaptureProviders.test.ts`, `SamPrompts.test.ts`, `Garments.test.ts`).

/** What a picture is looked at for: a photo for the review tray, a piece's own photo, an outfit photo for My Gallery,
 * the person in an outfit photo, or a video's stills. */
export type Intent = 'tray' | 'piece' | 'gallery' | 'person' | 'video'

/** One garment cut from a picture's real pixels, with where it sits in the picture and how many opaque pixels it has. */
export interface Cut {
  readonly picture: Rgba
  readonly bounds: Box
  readonly area: number
  readonly track: string
  readonly confidence: number
}

const { garments: bars } = capturePolicy

/** Whether a photo shows any part of a person. */
export const showsPerson = (route: Route) => route.person >= capturePolicy.person

/** Whether a photo for the tray is about one piece held up or shown: a camera shot, or a person in the picture, whose
 * worn clothes are offered unticked. Pieces laid out are all the subject, even with a hand at the edge or from the
 * camera. */
export const holding = (camera: boolean, route: Route) => route.scene !== 'flat' && (camera || showsPerson(route))

/** Who cuts a photo out. For the tray: nobody when the decision model is sure it shows no garment; background removal
 * for one garment it is sure of, with nobody in the picture, such as a piece laid flat; SAM otherwise (background
 * removal keeps everything in the foreground, so a person holding or wearing the garment would come out with it: 11
 * of 26 such photos in the spike). For a piece's own photo the person named the piece, so with nobody in it the whole
 * foreground is the piece, a pair of shoes or gloves included, which the route counts as two (v1 product shots, 1
 * November: every pair went to SAM and came back empty). */
export const cutterFor = (intent: 'tray' | 'piece', route: Route): 'none' | 'cloudflare' | 'sam' => {
  if (intent === 'piece') return showsPerson(route) ? 'sam' : 'cloudflare'
  const sure = route.confidence >= capturePolicy.routeConfidence
  if (route.garments === 'none' && sure) return 'none'
  return route.garments === 'one' && sure && !showsPerson(route) ? 'cloudflare' : 'sam'
}

/** What SAM is asked for besides clothing: "clothing" misses shoes, bags and hats (capture brainstorm, 30 October).
 * Each is one more call. */
export const morePrompts = ['shoes', 'bag', 'hat'] as const
type MorePrompt = (typeof morePrompts)[number]

/** The prompt that finds a piece of this kind, when clothing would miss it. */
export const kindPrompt = (type: PieceType): Option.Option<MorePrompt> => {
  if (slotOf(type) === 'shoes') return Option.some('shoes')
  if (type === 'bags') return Option.some('bag')
  return type === 'hats' ? Option.some('hat') : Option.none()
}

/** What SAM is asked for, by intent, the first prompt being the picture's answer and the rest a best effort: the
 * person alone; for a piece of a named kind, its kind's prompt too; for a tray photo of several pieces or of pieces
 * laid out, and every outfit photo, shoes, bags and hats too. A video is tracked for clothing only: Meta bills every
 * frame again for each prompt. */
export const promptsFor = (
  intent:
    | { readonly for: 'tray'; readonly route: Route }
    | { readonly for: 'piece'; readonly type: PieceType }
    | Intent,
): readonly [string, ...Array<string>] => {
  if (intent === 'person') return ['person']
  if (intent === 'gallery') return ['clothing', ...morePrompts]
  if (typeof intent === 'string') return ['clothing']
  if (intent.for === 'piece') return ['clothing', ...Option.toArray(kindPrompt(intent.type))]
  const several = intent.route.garments === 'several' || intent.route.scene === 'flat'
  return several ? ['clothing', ...morePrompts] : ['clothing']
}

/** The masks SAM found for each prompt, in order, less any mostly covered by a mask of an earlier prompt: a shoe found
 * as clothing and again as shoes is one piece. A later prompt's tracks are named after it, to stay apart. */
export const distinctMasks = (
  answers: ReadonlyArray<{ readonly prompt: string; readonly found: ReadonlyArray<Found> }>,
) => {
  const [first] = answers
  return answers.reduce<ReadonlyArray<Found>>(
    (kept, { prompt, found }) => [
      ...kept,
      ...found
        .filter((mask) => kept.every((other) => overlapShare(mask, other) <= bars.overlap))
        .map((mask) => (prompt === first?.prompt ? mask : { ...mask, track: `${prompt}-${mask.track}` })),
    ],
    [],
  )
}

/** Each mask, in `from` coordinates (SAM's frame, or the picture itself), cut from the picture's real pixels with its
 * edge refined against the photo, less specks; the largest first. */
export const cutsOf = (
  picture: Rgba,
  found: ReadonlyArray<Mask & { readonly track: string; readonly confidence: number }>,
  from: { readonly width: number; readonly height: number },
): ReadonlyArray<Cut> => {
  const smallest = bars.minimumShare * picture.width * picture.height
  return found
    .flatMap(({ track, confidence, ...mask }): ReadonlyArray<Cut> => {
      const { piece, bounds, area } = refinedCutOut(picture, mask, from)
      return piece.width === 0 || area < smallest ? [] : [{ picture: piece, bounds, area, track, confidence }]
    })
    .toSorted((a, b) => b.area - a.area)
}

/** A whole foreground as one cut, cropped to what is opaque; none when it is a speck. */
export const foregroundCut = (foreground: Rgba, bounds: Box | undefined): Option.Option<Cut> => {
  if (bounds === undefined) return Option.none()
  const area = (bounds.right - bounds.left) * (bounds.bottom - bounds.top)
  if (area < bars.minimumShare * foreground.width * foreground.height) return Option.none()
  return Option.some({ picture: crop(foreground, bounds), bounds, area, track: '0', confidence: 1 })
}

/** What happens to a cut-out, by how likely the decision model thinks it is one whole garment. */
export const verdictOf = (whole: number): 'drop' | 'offer' | 'preselect' =>
  whole < bars.whole.drop ? 'drop' : whole < bars.whole.preselect ? 'offer' : 'preselect'

/** The piece a photo is about when one is held up or shown: the largest, nearest the middle. */
export const heldOf = <A extends Pick<Cut, 'bounds' | 'area'>>(
  pieces: ReadonlyArray<A>,
  size: { readonly width: number; readonly height: number },
): A | undefined => {
  const { width, height } = size
  const centre = (box: Box) =>
    Math.hypot((box.left + box.right) / 2 - width / 2, (box.top + box.bottom) / 2 - height / 2)
  const score = (piece: A) => piece.area / (width * height) - centre(piece.bounds) / Math.hypot(width, height)
  return pieces.reduce<A | undefined>(
    (best, piece) => (best === undefined || score(piece) > score(best) ? piece : best),
    undefined,
  )
}

/** Of a piece's cuts, largest first, the largest found by its kind's own prompt (tracked under its name); else the
 * largest. */
export const pieceOfKind = <A extends Pick<Cut, 'track'>>(
  pieces: ReadonlyArray<A>,
  kind: Option.Option<string>,
): Option.Option<A> =>
  Option.orElse(
    Option.flatMap(kind, (prompt) => Option.fromNullishOr(pieces.find(({ track }) => track.startsWith(`${prompt}-`)))),
    () => Option.fromNullishOr(pieces[0]),
  )

/** The pieces grouped into pairs: two of one pair kind (`kindOf`), the smaller at least `pairArea` of the larger,
 * each paired with the unpaired one nearest its size; every other piece on its own. Groups keep the order of their
 * first piece, so the largest still comes first. */
export const pairsOf = <A extends Pick<Cut, 'area'>>(
  pieces: ReadonlyArray<A>,
  kindOf: (piece: A) => Option.Option<string>,
): ReadonlyArray<readonly [A] | readonly [A, A]> => {
  const taken = new Set<number>()
  const groups: Array<readonly [A] | readonly [A, A]> = []
  pieces.forEach((piece, index) => {
    if (taken.has(index)) return
    taken.add(index)
    const kind = kindOf(piece)
    const partner = Option.isNone(kind)
      ? undefined
      : pieces
          .map((other, at) => ({ other, at }))
          .filter(
            ({ other, at }) =>
              !taken.has(at) &&
              Option.contains(kindOf(other), kind.value) &&
              Math.min(piece.area, other.area) >= bars.pairArea * Math.max(piece.area, other.area),
          )
          .toSorted((a, b) => Math.abs(a.other.area - piece.area) - Math.abs(b.other.area - piece.area))[0]
    if (partner === undefined) return groups.push([piece])
    taken.add(partner.at)
    return groups.push([piece, partner.other])
  })
  return groups
}

/** Two cuts of one picture as one: both garments in one cut-out, over the box that holds both. */
export const joined = <A extends Cut>(one: A, other: A): A => {
  const bounds = {
    left: Math.min(one.bounds.left, other.bounds.left),
    top: Math.min(one.bounds.top, other.bounds.top),
    right: Math.max(one.bounds.right, other.bounds.right),
    bottom: Math.max(one.bounds.bottom, other.bounds.bottom),
  }
  const width = bounds.right - bounds.left
  const height = bounds.bottom - bounds.top
  const data = new Uint8Array(width * height * 4)
  for (const cut of [one, other])
    for (let row = 0; row < cut.picture.height; row++)
      for (let column = 0; column < cut.picture.width; column++) {
        const from = (row * cut.picture.width + column) * 4
        const to = ((cut.bounds.top - bounds.top + row) * width + cut.bounds.left - bounds.left + column) * 4
        if ((cut.picture.data[from + 3] ?? 0) > (data[to + 3] ?? 0))
          data.set(cut.picture.data.subarray(from, from + 4), to)
      }
  return {
    ...one,
    picture: { width, height, data },
    bounds,
    area: one.area + other.area,
    track: `${one.track}+${other.track}`,
    confidence: Math.max(one.confidence, other.confidence),
  }
}

/** The pieces with each pair joined into one. */
export const withPairsJoined = <A extends Cut>(pieces: ReadonlyArray<A>, kindOf: (piece: A) => Option.Option<string>) =>
  pairsOf(pieces, kindOf).map((group) => (group.length === 1 ? group[0] : joined(group[0], group[1])))
