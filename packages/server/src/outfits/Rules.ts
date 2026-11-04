import {
  type Colour,
  type Occasion,
  type OutfitBrief,
  type Pattern,
  type PieceId,
  type PieceType,
  outfitKeyOf,
  type Season,
  type Slot,
  groupOf,
  slotOf,
} from '@styld/protocol'
import { Array, Option, Order } from 'effect'

// The outfit rules (owner, 2026-10-31): the one validator of every proposal, whichever way made it, and Fast's
// generator. One piece in each place (a knit or a hoodie may go over a shirt or a tee), a whole outfit when the wardrobe has one (a top and a bottom, a one-piece, or
// for sport and lounging a set), shoes whenever there are any, every fixed piece kept, at most one statement piece
// besides them, and nothing for another season or occasion while something suitable is there. Pure.

/** One of the person's ready pieces, as the rules read it. */
export interface Wearable {
  readonly id: PieceId
  readonly type: PieceType
  readonly colours: ReadonlyArray<Colour>
  /** The seasons it is worn in, none for all year; made for rain (T-12). */
  readonly seasons: ReadonlyArray<Season>
  readonly rainproof: boolean
  readonly occasions: ReadonlyArray<Occasion>
  readonly pattern: Pattern | null
  readonly name: string | null
  /** Whether it shows a clean drawing rather than its photo. */
  readonly drawn: boolean
}

/** What every proposal for one request is made from and kept to. */
export interface Brief {
  /** The person's ready pieces, the fixed ones among them. */
  readonly wardrobe: ReadonlyArray<Wearable>
  /** The anchor first, then the locked pieces: every proposal wears them. */
  readonly fixed: ReadonlyArray<Wearable>
  readonly brief: OutfitBrief
  /** Keys of the combinations already shown. */
  readonly seen: ReadonlySet<string>
  /** A complete outfit (T-10): one to three accessories of different kinds besides everything else, whenever the
   * wardrobe has accessories that suit. */
  readonly complete?: boolean
  /** What Styld knows about the person, for Thinking only (owner, 4 November 2026): what they wear most, and the notes
   * they asked Styld to remember. Fast never reads it. */
  readonly taste?: { readonly likes: ReadonlyArray<string>; readonly remember: ReadonlyArray<string> }
}

/** The order an outfit is worn and listed in. */
const wearingOrder: ReadonlyArray<Slot> = ['set', 'onePiece', 'top', 'bottom', 'layer', 'shoes', 'accessory']

/** The most pieces one place holds in an outfit; a complete outfit's accessories, `mostCompleteAccessories`. */
const mostIn: Readonly<Record<Slot, number>> = {
  set: 2,
  onePiece: 1,
  top: 2,
  bottom: 1,
  layer: 1,
  shoes: 1,
  accessory: 2,
}

/** A complete outfit wears up to three accessories (T-10, Eva's review: "at least one, preferably two"). */
const mostCompleteAccessories = 3

/** How many accessories a complete outfit's draw wears, out of 6: one once, two three times, three twice. */
const completeAccessories: ReadonlyArray<number> = [1, 2, 2, 2, 3, 3]

/** Socks finish an outfit but do not style it: a complete outfit's accessories are the others. */
const isStyling = (piece: Wearable) => slotOf(piece.type) === 'accessory' && piece.type !== 'socks'

/** What an outfit is built on: separates, a one-piece, or a set for sport or lounging. */
type Shape = 'separates' | 'onePiece' | 'set'

const shapeSlots: Readonly<Record<Shape, ReadonlyArray<Slot>>> = {
  separates: ['top', 'bottom'],
  onePiece: ['onePiece'],
  set: ['set'],
}

/** Colours that carry an outfit on their own; blue is quiet, as denim and an Oxford shirt go with everything. */
const loud: ReadonlySet<Colour> = new Set(['red', 'pink', 'yellow', 'orange', 'purple', 'green'])

/** Tops worn over another: a knit or a hoodie over a shirt, a tee or a bodysuit. */
const midLayers: ReadonlySet<PieceType> = new Set(['knitwear', 'hoodies'])
const isMidLayer = (piece: Wearable) => midLayers.has(piece.type)

/** Two tops only as a knit or a hoodie over something lighter. */
const layersWell = (pieces: ReadonlyArray<Wearable>) => {
  const tops = pieces.filter((piece) => slotOf(piece.type) === 'top')
  return tops.length < 2 || tops.filter(isMidLayer).length === 1
}

/** A piece that carries an outfit: a loud colour or a bold pattern. */
const isStatement = (piece: Wearable) =>
  piece.colours.some((colour) => loud.has(colour)) || piece.pattern === 'printed' || piece.pattern === 'checked'

/** Where a piece is worn: by its place, a knit or a hoodie just after what it goes over. */
const slotRank = (piece: Wearable) => wearingOrder.indexOf(slotOf(piece.type)) + (isMidLayer(piece) ? 0.5 : 0)

/** The pieces in the order they are worn. */
const inWearingOrder = (pieces: ReadonlyArray<Wearable>): ReadonlyArray<Wearable> =>
  Array.sort(pieces, Order.mapInput(Order.Number, slotRank))

const isActivity = (brief: OutfitBrief) => brief.occasion === 'sport' || brief.occasion === 'lounge'

/** Shoes made for sport (running shoes, hiking and snow boots): an outfit wears them only for sport (T-12). */
const isSportShoe = (piece: Wearable) => groupOf(piece.type) === 'sport' && slotOf(piece.type) === 'shoes'

/** Whether a piece suits the brief: worn in the season asked for, worn for its occasion when it says, and sport shoes
 * only for sport. */
const suits = (piece: Wearable, brief: OutfitBrief) => {
  // A piece with no season is worn all year (T-12).
  const seasonFits = brief.season === undefined || piece.seasons.length === 0 || piece.seasons.includes(brief.season)
  const occasionFits =
    brief.occasion === undefined || piece.occasions.length === 0 || piece.occasions.includes(brief.occasion)
  return seasonFits && occasionFits && (!isSportShoe(piece) || brief.occasion === 'sport')
}

/** Places an outfit can do without: they are left empty rather than filled with something unsuitable. */
const optionalSlots: ReadonlySet<Slot> = new Set(['layer', 'accessory'])

/** The shoes an outfit chooses from when none suit the brief: every pair not made for sport, and sport shoes only when
 * they are all there is, so an outfit is never left barefoot while the wardrobe holds shoes (Eva, 4 November 2026:
 * "every outfit needs shoes"). */
const fallbackShoes = (shoes: ReadonlyArray<Wearable>) => {
  const everyday = shoes.filter((piece) => !isSportShoe(piece))
  return everyday.length > 0 ? everyday : shoes
}

/** Each place's choices: the pieces there that suit the brief; where an outfit needs the place and none suits, every
 * piece there, shoes not made for sport first. */
const poolsOf = (request: Brief): ReadonlyMap<Slot, ReadonlyArray<Wearable>> =>
  new Map(
    wearingOrder.map((slot) => {
      const there = request.wardrobe.filter((piece) => slotOf(piece.type) === slot)
      const suiting = there.filter((piece) => suits(piece, request.brief))
      if (suiting.length > 0 || optionalSlots.has(slot)) return [slot, suiting] as const
      return [slot, slot === 'shoes' ? fallbackShoes(there) : there] as const
    }),
  )

const has = (pools: ReadonlyMap<Slot, ReadonlyArray<Wearable>>, slot: Slot) => (pools.get(slot)?.length ?? 0) > 0

/** The shapes an outfit may take: the one a fixed piece sets, else every one the wardrobe can make. A set only for
 * sport or lounging, unless the anchor is one. */
const shapesFor = (request: Brief, pools: ReadonlyMap<Slot, ReadonlyArray<Wearable>>): ReadonlyArray<Shape> => {
  const fixedSlots = new Set(request.fixed.map((piece) => slotOf(piece.type)))
  if (fixedSlots.has('set')) return ['set']
  if (fixedSlots.has('onePiece')) return ['onePiece']
  if (fixedSlots.has('top') || fixedSlots.has('bottom')) return ['separates']
  return Array.filter(['separates', 'onePiece', 'set'] as const, (shape) =>
    shape === 'set'
      ? isActivity(request.brief) && has(pools, 'set')
      : shapeSlots[shape].every((slot) => has(pools, slot)),
  )
}

/** The places a whole outfit needs that the wardrobe has nothing for: shown, never invented. */
export const missingOf = (request: Brief): ReadonlyArray<Slot> => {
  const pools = poolsOf(request)
  const shapes = shapesFor(request, pools)
  // A fixed piece sets the shape whatever the wardrobe holds: a top with no bottom to go with it lacks the bottom.
  const [first] = shapes
  const fillable = shapes.some((shape) => shapeSlots[shape].every((slot) => has(pools, slot)))
  const base: ReadonlyArray<Slot> = fillable
    ? []
    : Array.filter(first === undefined ? (['top', 'bottom'] as const) : shapeSlots[first], (slot) => !has(pools, slot))
  return has(pools, 'shoes') ? base : [...base, 'shoes']
}

const counts = (pieces: ReadonlyArray<Wearable>) => {
  const bySlot = new Map<Slot, number>()
  for (const piece of pieces) bySlot.set(slotOf(piece.type), (bySlot.get(slotOf(piece.type)) ?? 0) + 1)
  return (slot: Slot) => bySlot.get(slot) ?? 0
}

/** Whether the pieces stand on one of the allowed shapes, or, when the wardrobe can make none, wear every base piece
 * there is. */
const standsOn = (
  count: (slot: Slot) => number,
  shapes: ReadonlyArray<Shape>,
  pools: ReadonlyMap<Slot, ReadonlyArray<Wearable>>,
) => {
  const base = ['set', 'onePiece', 'top', 'bottom'] as const
  if (shapes.length === 0)
    return (
      count('set') === 0 &&
      count('onePiece') === 0 &&
      Array.every(['top', 'bottom'] as const, (slot) => (has(pools, slot) ? count(slot) === 1 : count(slot) === 0))
    )
  return shapes.some((shape) =>
    base.every((slot) => (shapeSlots[shape].includes(slot) ? count(slot) >= 1 : count(slot) === 0)),
  )
}

/** A proposal kept to the rules: the request's own pieces in wearing order, or none when it breaks one. */
/** A complete outfit's accessories: at least one when the wardrobe has one that suits, at most three, each of its own
 * kind, and socks only when fixed. Anything goes for an outfit that is not asked to be complete. */
const accessorised = (
  request: Brief,
  pools: ReadonlyMap<Slot, ReadonlyArray<Wearable>>,
  pieces: ReadonlyArray<Wearable>,
  fixedIds: ReadonlySet<string>,
) => {
  const worn = pieces.filter((piece) => slotOf(piece.type) === 'accessory')
  if (request.complete !== true) return worn.length <= mostIn.accessory
  return (
    worn.length <= mostCompleteAccessories &&
    new Set(worn.map(({ type }) => type)).size === worn.length &&
    worn.every((piece) => isStyling(piece) || fixedIds.has(piece.id)) &&
    (worn.length > 0 || !(pools.get('accessory') ?? []).some(isStyling))
  )
}

export const validated = (request: Brief, pieceIds: ReadonlyArray<string>): Option.Option<ReadonlyArray<Wearable>> => {
  const byId = new Map<string, Wearable>(request.wardrobe.map((piece) => [piece.id, piece]))
  const unique = [...new Set(pieceIds)]
  const pieces = unique.flatMap((id) => Option.toArray(Option.fromNullishOr(byId.get(id))))
  if (pieces.length !== pieceIds.length) return Option.none()
  const fixedIds = new Set<string>(request.fixed.map(({ id }) => id))
  if (request.fixed.some(({ id }) => !unique.includes(id))) return Option.none()
  const pools = poolsOf(request)
  const count = counts(pieces)
  const free = pieces.filter(({ id }) => !fixedIds.has(id))
  const fixedStatements = request.fixed.filter(isStatement).length
  const fits =
    wearingOrder.every((slot) => slot === 'accessory' || count(slot) <= mostIn[slot]) &&
    accessorised(request, pools, pieces, fixedIds) &&
    layersWell(pieces) &&
    standsOn(count, shapesFor(request, pools), pools) &&
    (count('shoes') === 1 || !has(pools, 'shoes')) &&
    free.every((piece) => pools.get(slotOf(piece.type))?.includes(piece) === true) &&
    fixedStatements + free.filter(isStatement).length <= Math.max(1, fixedStatements)
  return fits ? Option.some(inWearingOrder(pieces)) : Option.none()
}

/** A repeatable hash: the same text, the same number. */
const hash = (text: string) =>
  Array.makeBy(text.length, (index) => text.charCodeAt(index)).reduce(
    (value, code) => Math.imul(value ^ code, 16_777_619) >>> 0,
    2_166_136_261,
  )

const shuffled = (pieces: ReadonlyArray<Wearable>, seed: string) =>
  Array.sort(
    pieces,
    Order.mapInput(Order.Number, (piece: Wearable) => hash(`${seed}:${piece.id}`)),
  )

/** A place's choices in the seed's order; when asked, its clean drawings first once it has two, so the table shows
 * drawings more often than photos without leaving any photo out for good. */
const ordered = (pieces: ReadonlyArray<Wearable>, seed: string, drawingsFirst: boolean) => {
  const order = shuffled(pieces, seed)
  const drawings = order.filter(({ drawn }) => drawn)
  return drawingsFirst && drawings.length >= 2 ? [...drawings, ...order.filter(({ drawn }) => !drawn)] : order
}

/** How often an optional place is worn, out of 6, by the season asked for. */
const layerChance: Readonly<Record<Season | 'any', number>> = { winter: 6, autumn: 4, spring: 2, any: 2, summer: 1 }

/** How often a knit or a hoodie goes over a lighter top, out of 6, by the season asked for. */
const overChance: Readonly<Record<Season | 'any', number>> = { winter: 3, autumn: 2, spring: 1, any: 1, summer: 0 }

/** One draw: a shape, then a piece for each place it needs, the fixed pieces where they sit, and the optional places
 * by chance; clean drawings first when asked. */
const draw = (
  request: Brief,
  pools: ReadonlyMap<Slot, ReadonlyArray<Wearable>>,
  shapes: ReadonlyArray<Shape>,
  seed: string,
  drawingsFirst: boolean,
) => {
  const shape = shapes[hash(`${seed}:shape`) % shapes.length] ?? 'separates'
  const fixedIn = (slot: Slot) => request.fixed.filter((piece) => slotOf(piece.type) === slot)
  const chance = (slot: Slot, outOf6: number) => hash(`${seed}:${slot}:wear`) % 6 < outOf6
  const optional: ReadonlyArray<readonly [Slot, boolean]> = [
    ['layer', chance('layer', layerChance[request.brief.season ?? 'any'])],
    ['shoes', true],
    ['accessory', chance('accessory', 3)],
  ]
  const wanted = [...shapeSlots[shape].map((slot) => [slot, true] as const), ...optional]
  const season = request.brief.season ?? 'any'
  // Now and then, a knit or a hoodie over a lighter top.
  const over = (tops: ReadonlyArray<Wearable>) => {
    const [first] = tops
    if (first === undefined || isMidLayer(first) || !chance('top', overChance[season])) return tops
    const knits = (pools.get('top') ?? []).filter(isMidLayer)
    return [...tops, ...Array.take(ordered(knits, `${seed}:over`, drawingsFirst), 1)]
  }
  // A complete outfit's accessories: one to three of different kinds, the fixed ones among them.
  const accessories = () => {
    const fixed = fixedIn('accessory')
    const howMany = completeAccessories[hash(`${seed}:accessories`) % completeAccessories.length] ?? 2
    const styling = ordered((pools.get('accessory') ?? []).filter(isStyling), `${seed}:accessory`, drawingsFirst)
    return styling.reduce<ReadonlyArray<Wearable>>(
      (picked, piece) =>
        picked.length >= howMany || picked.some(({ type }) => type === piece.type) ? picked : [...picked, piece],
      fixed,
    )
  }
  return wanted.flatMap(([slot, wear]) => {
    if (slot === 'accessory' && request.complete === true) return accessories()
    const fixed = fixedIn(slot)
    if (fixed.length > 0 || !wear) return fixed
    const drawn = Array.take(ordered(pools.get(slot) ?? [], `${seed}:${slot}`, drawingsFirst), 1)
    return slot === 'top' ? over(drawn) : drawn
  })
}

/** Fast's candidates: up to `count` new combinations that keep to the rules, drawn in the seed's repeatable order, and
 * whether the draws ran out before finding that many. */
export const proposed = (request: Brief, seed: string, count: number) => {
  const pools = poolsOf(request)
  const shapes = shapesFor(request, pools)
  const found = new Map<string, ReadonlyArray<Wearable>>()
  const attempts = count * 30
  for (let attempt = 0; attempt < attempts && found.size < count; attempt += 1) {
    // Every other draw prefers clean drawings.
    const drawn = draw(
      request,
      pools,
      shapes.length > 0 ? shapes : ['separates'],
      `${seed}:${String(attempt)}`,
      attempt % 2 === 0,
    )
    const ids = drawn.map(({ id }) => id)
    const key = outfitKeyOf(ids)
    if (ids.length === 0 || request.seen.has(key) || found.has(key)) continue
    const outfit = validated(request, ids)
    if (Option.isSome(outfit)) found.set(key, outfit.value)
  }
  return { outfits: [...found.values()], exhausted: found.size < count }
}
