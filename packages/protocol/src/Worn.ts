import { maximumWornPieces } from './Limits.ts'
import { Schema } from 'effect'
import { Day } from './Day.ts'
import { ProposalRef } from './Outfit.ts'
import { PieceId } from './Wardrobe.ts'

/** What the person wore on a day: the pieces still in the wardrobe. */
export const WornDay = Schema.Struct({ day: Day, pieceIds: Schema.Array(PieceId) })
export type WornDay = typeof WornDay.Type

export const WornDays = Schema.Struct({ days: Schema.Array(WornDay) })

/** "Wear this": the day's outfit, replacing any recorded before, and the proposal it came from when the engine made
 * it. */
export const WearPieces = Schema.Struct({
  pieceIds: Schema.Array(PieceId).check(Schema.isMinLength(1), Schema.isMaxLength(maximumWornPieces)),
  proposal: Schema.optionalKey(ProposalRef),
})
export type WearPieces = typeof WearPieces.Type

/** A span of days to read, both ends included, at most 62 days apart. */
export const WornRange = Schema.Struct({ from: Day, to: Day })

export { Day } from './Day.ts'
