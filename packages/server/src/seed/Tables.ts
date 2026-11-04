import {
  type BoardBuild,
  type BoardItem,
  BoardItemId,
  boardWidth,
  labelRows,
  type OutfitBrief,
  outfitKeyOf,
  outfitsInGrid,
  PieceItem,
  type PieceId,
  type PieceType,
  type PlacedThing,
  type Season,
  type SeedLabel,
  slotOf,
  type Slot,
  TableLabel,
  TablePiece,
  TextItem,
  tidied,
  widestLabel,
} from '@styld/protocol'
import { Match, Schema } from 'effect'
import { distinct } from '../outfits/Outfits.ts'
import { proposed, type Wearable } from '../outfits/Rules.ts'

// How a house board's table is laid out from its garments (owner, 4 November 2026), pure, by the layouts the app
// already has: a packing list or a collage on the tidy grid in wearing order, the catalogue's texts across the top; a
// look, or several outfits, each a flat-lay of its own as the template board's clusters are. Outfits are chosen from
// the board's own pieces by Fast's rules, from a seed, so the same entry always gives the same outfits.

/** A piece of the board: what the layouts need. */
export interface Garment {
  readonly id: PieceId
  readonly type: PieceType
}

const wearing: ReadonlyArray<Slot> = ['onePiece', 'set', 'top', 'layer', 'bottom', 'shoes', 'accessory']

/** The garments in wearing order, the catalogue's order kept within a place. */
const inWearingOrder = <G extends Garment>(garments: ReadonlyArray<G>): ReadonlyArray<G> =>
  garments.toSorted((a, b) => wearing.indexOf(slotOf(a.type)) - wearing.indexOf(slotOf(b.type)))

/** The catalogue's texts across the top of the table, each a line, never wider than the sheet allows. */
const labelThings = (labels: ReadonlyArray<Pick<SeedLabel, 'text' | 'style'>>): ReadonlyArray<PlacedThing> => {
  const rows = labelRows(labels.length)
  return labels.map(({ text, style }, index) => ({
    thing: TableLabel.make({ text, style }),
    x: boardWidth / 2,
    y: rows.y(index),
    size: widestLabel,
    turn: 0,
  }))
}

/** An item id for the tidy grid's bookkeeping only: the board's own ids are given when the table is saved. */
const draftId = (index: number) => Schema.decodeSync(BoardItemId)(`bi_seed${String(index).padStart(18, '0')}`)

/** A table item as a thing placed exactly where it lies. */
const placedThing = (item: BoardItem): ReadonlyArray<PlacedThing> =>
  Match.value(item).pipe(
    Match.tagsExhaustive({
      PieceItem: ({ pieceId, x, y, size, turn }) => [{ thing: TablePiece.make({ pieceId }), x, y, size, turn }],
      TextItem: ({ text, style, x, y, size, turn }) => [{ thing: TableLabel.make({ text, style }), x, y, size, turn }],
      ImageItem: () => [],
    }),
  )

/** A packing list or a collage: the pieces on the tidy grid in wearing order, the texts across the top. */
const tidyTable = (garments: ReadonlyArray<Garment>, labels: ReadonlyArray<Pick<SeedLabel, 'text' | 'style'>>) => {
  const pieces = inWearingOrder(garments).map((garment, index) =>
    PieceItem.make({
      id: draftId(index),
      pieceId: garment.id,
      x: 0,
      y: 0,
      size: 300,
      turn: 0,
      z: index + 1,
      flipped: false,
    }),
  )
  const texts = labels.map(({ text, style }, index) =>
    TextItem.make({
      id: draftId(pieces.length + index),
      text,
      style,
      x: 0,
      y: 0,
      size: widestLabel,
      turn: 0,
      z: pieces.length + index + 1,
      flipped: false,
    }),
  )
  return tidied([...pieces, ...texts]).flatMap(placedThing)
}

/** Outfits as flat-lays below the texts. */
const outfitTable = (
  outfits: ReadonlyArray<ReadonlyArray<Garment>>,
  labels: ReadonlyArray<Pick<SeedLabel, 'text' | 'style'>>,
): ReadonlyArray<PlacedThing> => [
  ...outfitsInGrid(
    outfits.map((outfit) => inWearingOrder(outfit)),
    labelRows(labels.length).top,
  )
    .toSorted((a, b) => a.z - b.z)
    .map(({ pieceId, x, y, size, turn }) => ({ thing: TablePiece.make({ pieceId }), x, y, size, turn })),
  ...labelThings(labels),
]

/** The table of a board that is not a one-piece board (whose table its template lays out). */
export const tableOf = (
  build: Exclude<BoardBuild, 'onePiece'>,
  garments: ReadonlyArray<Garment>,
  outfits: ReadonlyArray<ReadonlyArray<Garment>>,
  labels: ReadonlyArray<Pick<SeedLabel, 'text' | 'style'>>,
): ReadonlyArray<PlacedThing> =>
  Match.value(build).pipe(
    Match.when('pack', () => tidyTable(garments, labels)),
    Match.when('pieceCollage', () => tidyTable(garments, labels)),
    Match.when('look', () => outfitTable([garments], labels)),
    Match.when('outfits', () => outfitTable(outfits, labels)),
    Match.when('challenge', () => outfitTable(outfits, labels)),
    Match.exhaustive,
  )

/** `count` complete outfits of the board's own pieces by Fast's rules (`outfits/Rules.ts`), the same every time for the
 * same `seed`: for the board's season when it has enough, else for any; each repeating as few pieces as it can, the
 * anchor aside. Fewer than `count` when the pieces make no more. */
export const outfitsOf = (
  pieces: ReadonlyArray<Wearable>,
  count: number,
  seed: string,
  options: { readonly anchor?: Wearable; readonly season?: Season },
): ReadonlyArray<ReadonlyArray<PieceId>> => {
  const fixed = options.anchor === undefined ? [] : [options.anchor]
  const ask = (brief: OutfitBrief) =>
    proposed({ wardrobe: pieces, fixed, brief, seen: new Set(), complete: true }, seed, count * 4).outfits
  const seasonal = options.season === undefined ? [] : ask({ season: options.season })
  const found = seasonal.length >= count ? seasonal : ask({})
  const proposals = found.map((outfit) => {
    const pieceIds = outfit.map(({ id }) => id)
    return { key: outfitKeyOf(pieceIds), pieceIds, score: null }
  })
  return distinct(proposals, count, new Set(fixed.map(({ id }) => id))).map(({ pieceIds }) => pieceIds)
}
