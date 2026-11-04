import {
  type Colour,
  type GarmentGroup,
  type PieceId,
  type PieceType,
  type Slot,
  type WardrobeAnalysis,
  type WardrobeArea,
  WardrobeArea as Areas,
  groupOf,
  slotOf,
} from '@styld/protocol'
import { balancedFrom, fewest, largestShare, mostWornShown } from './Policy.ts'

// "Analyze my wardrobe" (Eva's review, T-14): the server counts, so the numbers the person reads are exact; the model
// only comments on them.

/** Where each outfit slot counts; sets (sport, swimming, lounging) are worn on their own and weigh against nothing, and
 * so does everything made for sport (`everydayArea`). */
const areaOf: { readonly [S in Slot]: WardrobeArea | undefined } = {
  top: 'tops',
  bottom: 'bottoms',
  onePiece: 'dresses',
  layer: 'layers',
  shoes: 'shoes',
  accessory: 'accessories',
  set: undefined,
}

/** Where a piece counts: by its slot, unless it is made for sport (a sports bra is not one of the everyday tops). */
const everydayArea = (type: PieceType) => (groupOf(type) === 'sport' ? undefined : areaOf[slotOf(type)])

/** Counts of a list's values, commonest first; ties keep the order they were first met in. */
const counted = <A>(values: Iterable<A>) => {
  const counts = new Map<A, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].toSorted((a, b) => b[1] - a[1])
}

/** The analysis of `pieces`, with the days each was worn in the last `days` days (`worn`: one entry per piece per day
 * worn). */
export const analysisOf = (
  pieces: ReadonlyArray<{ readonly id: PieceId; readonly type: PieceType; readonly colours: ReadonlyArray<Colour> }>,
  worn: { readonly days: number; readonly pieceIds: ReadonlyArray<string> },
): WardrobeAnalysis => {
  const own = new Map<string, PieceId>(pieces.map(({ id }) => [id, id]))
  const wornDays = counted(worn.pieceIds.filter((id) => own.has(id)))
  const areas = counted(pieces.flatMap(({ type }) => everydayArea(type) ?? []))
  const everyday = areas.reduce((sum, [, count]) => sum + count, 0)
  const inArea = (area: WardrobeArea) => areas.find(([each]) => each === area)?.[1] ?? 0
  return {
    pieces: pieces.length,
    groups: counted<GarmentGroup>(pieces.map(({ type }) => groupOf(type))).map(([group, count]) => ({ group, count })),
    types: counted(pieces.map(({ type }) => type)).map(([type, count]) => ({ type, count })),
    colours: counted(pieces.flatMap(({ colours }) => colours)).map(([colour, count]) => ({ colour, count })),
    worn: {
      days: worn.days,
      pieces: wornDays.length,
      never: pieces.length - wornDays.length,
      most: wornDays.slice(0, mostWornShown).flatMap(([id, days]) => {
        const pieceId = own.get(id)
        return pieceId === undefined ? [] : [{ pieceId, days }]
      }),
    },
    surpluses:
      pieces.length < balancedFrom ? [] : Areas.literals.filter((area) => inArea(area) > largestShare[area] * everyday),
    gaps: Areas.literals.filter((area) => inArea(area) < fewest[area]),
  }
}
