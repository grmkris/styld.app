import { mostProposals, mostSeen } from './Limits.ts'
import { entityId } from './Ids.ts'
import { Schema } from 'effect'

// What names a run of the outfit engine and the outfits it proposed (owner, 2026-10-31): plain schemas, kept apart from
// the engine's HTTP group (`Outfit.ts`) so a board, a worn day or an assistant view can name a proposal without the
// HTTP API and session modules coming with it.

export const OutfitMode = Schema.Literals(['fast', 'thinking'])
export type OutfitMode = typeof OutfitMode.Type

/** A combination's key: its piece ids, sorted and joined. Two proposals of the same pieces share one key. */
export const OutfitKey = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240))
export type OutfitKey = typeof OutfitKey.Type

/** The key of a combination of pieces. */
export const outfitKeyOf = (pieceIds: ReadonlyArray<string>): OutfitKey => pieceIds.toSorted().join('.')

/** Names one run of making and shuffling, so what the person kept is counted against the way that made it. */
export const OutfitSession = entityId('os').pipe(Schema.brand('OutfitSession'))
export type OutfitSession = typeof OutfitSession.Type

/** The proposal a kept outfit came from: its run, the way that made it, where in the run it was shown (from 0), and
 * whether the person changed it before keeping it. Counted, never stored. */
export const ProposalRef = Schema.Struct({
  session: OutfitSession,
  mode: OutfitMode,
  position: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: mostSeen + mostProposals })),
  edited: Schema.Boolean,
})
export type ProposalRef = typeof ProposalRef.Type
