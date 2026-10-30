import { Schema } from 'effect'
import { Author, PublicBoardSummary } from './Public.ts'

// Explore and search across people and boards (Boards, profiles and social, M5). Only what passed Styld's check
// shows here: an unsure check keeps something on its own links but out of discovery, and so do reports on a profile.

/** The design's six moods, for a board and Explore's chips. */
export const Mood = Schema.Literals(['knitwear', 'rain', 'office', 'weekend', 'evening', 'sport'])
export type Mood = typeof Mood.Type

/** At most three moods on a board. */
export const maximumMoods = 3

export const SetMoods = Schema.Struct({ moods: Schema.Array(Mood).check(Schema.isMaxLength(maximumMoods)) })
export type SetMoods = typeof SetMoods.Type

/** A public board as discovery shows it: whose it is and its moods. */
export const FoundBoard = Schema.Struct({ board: PublicBoardSummary, by: Author, moods: Schema.Array(Mood) })
export type FoundBoard = typeof FoundBoard.Type

export const ExploreQuery = Schema.Struct({ mood: Schema.optionalKey(Mood) })
export type ExploreQuery = typeof ExploreQuery.Type

/** Explore: Edits from Styld first, then boards and people Styld featured, then the newest public boards. */
export const Explore = Schema.Struct({
  edits: Schema.Array(FoundBoard),
  featured: Schema.Array(FoundBoard),
  people: Schema.Array(Author),
  newest: Schema.Array(FoundBoard),
})
export type Explore = typeof Explore.Type

export const SearchQuery = Schema.Struct({ q: Schema.String.check(Schema.isMaxLength(80)) })
export type SearchQuery = typeof SearchQuery.Type

/** People by name and handle, and boards by name and mood. The person's own wardrobe is searched on the device. */
export const SearchResults = Schema.Struct({ people: Schema.Array(Author), boards: Schema.Array(FoundBoard) })
export type SearchResults = typeof SearchResults.Type
