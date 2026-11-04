import { SearchResults, textLength } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { StyldClient } from '../StyldClient.ts'

// The one public search, over people and public boards, which Ask and Explore both offer: the words searched, cut to
// the protocol's length, the request, and where a search stands for the words typed.

/** A search: none, waiting for typing to settle, asked, answered or failed, each for the words searched. */
export const PublicSearch = defineTaggedUnion({
  Off: {},
  Waiting: { query: Schema.String },
  Searching: { query: Schema.String },
  Found: { query: Schema.String, results: SearchResults },
  Failed: { query: Schema.String },
})
export type PublicSearch = typeof PublicSearch.Type

/** The words a search sends: what was typed, trimmed and cut to the length the public search reads. */
export const searchWords = (typed: string) => typed.trim().slice(0, textLength.search)

/** People and public boards for the words; signed out too, since the public search needs no account. */
export const searchPublic = (query: string) =>
  Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return yield* api.public.search({ query: { q: searchWords(query) } })
  })

/** Whether an answer is for the search still waiting; one for words searched before is dropped. */
export const awaits = (search: PublicSearch, query: string) =>
  PublicSearch.guards.Searching(search) && search.query === query
