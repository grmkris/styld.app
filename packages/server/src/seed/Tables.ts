import {
  type BoardBuild,
  type OutfitBrief,
  outfitKeyOf,
  type PieceId,
  type PieceType,
  type PlacedThing,
  type Season,
  type SeedLabel,
} from '@styld/protocol'
import { Match } from 'effect'
import { distinct } from '../outfits/Outfits.ts'
import { proposed, type Wearable } from '../outfits/Rules.ts'
import { capsuleBoard, outfitBoard } from './Layouts.ts'

// How a house board's table is laid out from its garments (owner, 4 November 2026), pure: a packing list or a collage
// in rows at true sizes, a look or several outfits each a dense stack (`Layouts.ts`), under the board's headline.
// Outfits are chosen from the board's own pieces by Fast's rules, from a seed, so the same entry always gives the same
// outfits.

/** A piece of the board: what the layouts need. */
export interface Garment {
  readonly id: PieceId
  readonly type: PieceType
}

/** The table of a board that is not a one-piece board (whose table its template lays out). */
export const tableOf = (
  build: Exclude<BoardBuild, 'onePiece'>,
  garments: ReadonlyArray<Garment>,
  outfits: ReadonlyArray<ReadonlyArray<Garment>>,
  labels: ReadonlyArray<Pick<SeedLabel, 'text' | 'style'>>,
): ReadonlyArray<PlacedThing> =>
  Match.value(build).pipe(
    Match.when('pack', () => capsuleBoard(garments, labels)),
    Match.when('pieceCollage', () => capsuleBoard(garments, labels)),
    Match.when('look', () => outfitBoard([garments], labels)),
    Match.when('outfits', () => outfitBoard(outfits, labels)),
    Match.when('challenge', () => outfitBoard(outfits, labels)),
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
