import { Schema } from 'effect'
import { FoundBoard } from './Explore.ts'

// Challenges on Home (Eva's sketch, owner 4 November 2026): her three, each the house board made for it once the house
// boards are seeded (30 days, one red thing; Practical magic, October; One coat, six days). A challenge with no such
// board, or one discovery may not show, stays "coming soon".

export const ChallengeKey = Schema.Literals(['red', 'witch', 'onePiece'])
export type ChallengeKey = typeof ChallengeKey.Type

/** The challenges that have a board to open, in Eva's order. */
export const Challenges = Schema.Struct({
  challenges: Schema.Array(Schema.Struct({ challenge: ChallengeKey, found: FoundBoard })),
})
export type Challenges = typeof Challenges.Type
