import { SessionHttp } from '@styld/auth/config'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { RequestRefused } from './Account.ts'
import { Occasion, Season, Slot } from './Garment.ts'
import { PieceId, PieceNotFound } from './Wardrobe.ts'

// The outfit engine (owner, 2026-10-31): outfits made of the person's own pieces, around an anchor when there is one.
// Two ways of making them are an experiment the owner decides between from data: Fast (rules propose, Clef ranks by
// looking at the pieces) and Thinking (a text model proposes, rules check, Clef ranks). The engine keeps nothing: a
// request names what is fixed and what was already shown, and gets a ranked batch back. What became of a proposal
// travels with the write that keeps it (Wear this, Keep), so keep rates compare per way.

export const OutfitMode = Schema.Literals(['fast', 'thinking'])
export type OutfitMode = typeof OutfitMode.Type

const Words = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(140))

/** What the outfit is for, when known: the weather, the occasion, and the person's own words ("a dinner out"), which
 * are never logged. */
export const OutfitBrief = Schema.Struct({
  season: Schema.optionalKey(Season),
  occasion: Schema.optionalKey(Occasion),
  words: Schema.optionalKey(Words),
})
export type OutfitBrief = typeof OutfitBrief.Type

/** The most proposals one request returns, pieces it locks, and combinations it says were shown. */
export const mostProposals = 6
export const mostLocked = 5
export const mostSeen = 60

/** A combination's key: its piece ids, sorted and joined. Two proposals of the same pieces share one key. */
export const OutfitKey = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240))
export type OutfitKey = typeof OutfitKey.Type

/** The key of a combination of pieces. */
export const outfitKeyOf = (pieceIds: ReadonlyArray<string>): OutfitKey => pieceIds.toSorted().join('.')

/** Names one run of making and shuffling, so what the person kept is counted against the way that made it. */
export const OutfitSession = Schema.String.check(Schema.isPattern(/^os_[A-Za-z0-9_-]{22}$/)).pipe(
  Schema.brand('OutfitSession'),
)
export type OutfitSession = typeof OutfitSession.Type

/** Ask for outfits: `POST /api/outfits`. Free, at the account's pace; Thinking at most a set number of times a day.
 * The first request of a run names no session and gets one; refills name it. */
export const MakeOutfit = Schema.Struct({
  mode: OutfitMode,
  brief: OutfitBrief,
  session: Schema.optionalKey(OutfitSession),
  anchorPieceId: Schema.optionalKey(PieceId),
  /** Pieces every proposal keeps, besides the anchor. */
  lockedPieceIds: Schema.Array(PieceId).check(Schema.isMaxLength(mostLocked)),
  /** Combinations already shown: none of them comes back. */
  seen: Schema.Array(OutfitKey).check(Schema.isMaxLength(mostSeen)),
  count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: mostProposals })),
})
export type MakeOutfit = typeof MakeOutfit.Type

/** One proposed outfit: its pieces in wearing order, its key, and how well Clef thought they go together, 0 to 1
 * (null when Clef could not look). */
export const OutfitProposal = Schema.Struct({
  key: OutfitKey,
  pieceIds: Schema.Array(PieceId).check(Schema.isMinLength(1)),
  score: Schema.NullOr(Schema.Number),
})
export type OutfitProposal = typeof OutfitProposal.Type

/** A ranked batch, best first; the places the wardrobe has nothing for (an outfit without shoes says so); and whether
 * the rules have no new combination left to propose. */
export const OutfitProposals = Schema.Struct({
  session: OutfitSession,
  mode: OutfitMode,
  proposals: Schema.Array(OutfitProposal),
  missing: Schema.Array(Slot),
  exhausted: Schema.Boolean,
})
export type OutfitProposals = typeof OutfitProposals.Type

/** The proposal a kept outfit came from: its run, the way that made it, where in the run it was shown (from 0), and
 * whether the person changed it before keeping it. Counted, never stored. */
export const ProposalRef = Schema.Struct({
  session: OutfitSession,
  mode: OutfitMode,
  position: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: mostSeen + mostProposals })),
  edited: Schema.Boolean,
})
export type ProposalRef = typeof ProposalRef.Type

/** Too many outfits asked for in a minute. */
export class OutfitSlowDown extends Schema.TaggedError<OutfitSlowDown>()(
  'OutfitSlowDown',
  {},
  { httpApiStatus: 429 },
) {}

/** Today's Thinking is spent: Fast still answers. */
export class ThinkingSpent extends Schema.TaggedError<ThinkingSpent>()('ThinkingSpent', {}, { httpApiStatus: 429 }) {}

/** No outfit could be made just now: the wardrobe could not be read, or Thinking's model did not answer usefully (Fast
 * may). */
export class OutfitUnavailable extends Schema.TaggedError<OutfitUnavailable>()(
  'OutfitUnavailable',
  {},
  { httpApiStatus: 503 },
) {}

export class OutfitApi extends HttpApiGroup.make('outfits')
  .add(
    HttpApiEndpoint.post('makeOutfit', '/outfits', {
      payload: MakeOutfit,
      success: OutfitProposals,
      error: [PieceNotFound, OutfitSlowDown, ThinkingSpent, OutfitUnavailable, RequestRefused],
    }),
  )
  .middleware(SessionHttp.RequireSession)
  .prefix('/api') {}
