import { textLength } from './Text.ts'
import { Schema } from 'effect'
import { Mood } from './Mood.ts'
import { Author, PublicBoardSummary } from './Public.ts'

// Explore and search across people and boards (Boards, profiles and social, M5). Only what passed Styld's check
// shows here: an unsure check keeps something on its own links but out of discovery, and so do reports on a profile.

/** A public board as discovery shows it: whose it is and its moods. */
export const FoundBoard = Schema.Struct({ board: PublicBoardSummary, by: Author, moods: Schema.Array(Mood) })
export type FoundBoard = typeof FoundBoard.Type

export const ExploreQuery = Schema.Struct({ mood: Schema.optionalKey(Mood) })
export type ExploreQuery = typeof ExploreQuery.Type

/** Someone Explore suggests following: their byline, and the city and bio their profile shows. */
export const SuggestedPerson = Schema.Struct({
  ...Author.fields,
  city: Schema.NullOr(Schema.String),
  bio: Schema.NullOr(Schema.String),
})
export type SuggestedPerson = typeof SuggestedPerson.Type

/** Explore: Edits from Styld first, then boards Styld featured, the newest public boards, and people to follow:
 * featured people first, never the reader nor anyone they already follow. */
export const Explore = Schema.Struct({
  edits: Schema.Array(FoundBoard),
  featured: Schema.Array(FoundBoard),
  people: Schema.Array(SuggestedPerson),
  newest: Schema.Array(FoundBoard),
})
export type Explore = typeof Explore.Type

export const SearchQuery = Schema.Struct({ q: Schema.String.check(Schema.isMaxLength(textLength.search)) })
export type SearchQuery = typeof SearchQuery.Type

/** People by name and handle, and boards by name and mood. The person's own wardrobe is searched on the device. */
export const SearchResults = Schema.Struct({ people: Schema.Array(Author), boards: Schema.Array(FoundBoard) })
export type SearchResults = typeof SearchResults.Type
