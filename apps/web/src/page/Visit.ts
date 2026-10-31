import { Explore, Handle, Mood, PieceId, PublicPiecePage, PublicProfile, SearchResults } from '@styld/protocol'
import { Effect, Match, Option, Predicate, Schema } from 'effect'
import { Command, Dom, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import type { AppRoute } from '../route.ts'
import { StyldClient } from '../StyldClient.ts'
import * as People from './People.ts'

// What anyone may see of a person: their published profile at `/@handle`, and a piece of theirs on its own page.
// Both are read signed out; anything private, unpublished or held back by Styld's check reads as not there.

// MODEL

/** Whose page this is: a person by handle, or one of their pieces. */
export const Target = defineTaggedUnion({
  Person: { handle: Schema.String },
  Piece: { pieceId: Schema.String },
  /** Explore, in one mood or all. */
  Explore: { mood: Schema.Option(Mood) },
})
export type Target = typeof Target.Type

/** The profile's tabs; Pieces shows only when its owner shows the wardrobe. */
export const PersonTab = Schema.Literals(['boards', 'looks', 'pieces'])
export type PersonTab = typeof PersonTab.Type

export const Shown = defineTaggedUnion({
  Loading: {},
  Missing: {},
  Failed: {},
  Person: { profile: PublicProfile },
  Piece: { page: PublicPiecePage },
  Explore: { explore: Explore },
})
export type Shown = typeof Shown.Type

/** Explore's search over people and public boards: none, asked, answered or failed, each for the words searched. */
export const ExploreSearch = defineTaggedUnion({
  Off: {},
  Searching: { query: Schema.String },
  Found: { query: Schema.String, results: SearchResults },
  Failed: { query: Schema.String },
})
export type ExploreSearch = typeof ExploreSearch.Type

export const Model = Schema.Struct({
  target: Target,
  shown: Shown,
  tab: PersonTab,
  people: People.Model,
  /** A session came with the page: only then is there a relation to read. */
  signedIn: Schema.Boolean,
  /** What is typed in Explore's search, as typed. */
  query: Schema.String,
  search: ExploreSearch,
})
export type Model = typeof Model.Type

export const searchFieldId = 'explore-search'
export const searchResultsId = 'explore-results'
/** The longest search the public search reads. */
const searchLength = 80

/** Which public page a route opens; any other route keeps an empty one. */
export const targetFor = (route: AppRoute): Target =>
  Match.value(route).pipe(
    Match.withReturnType<Target>(),
    Match.tag('Person', ({ handle }) => Target.Person({ handle })),
    Match.tag('PublicPiece', ({ pieceId }) => Target.Piece({ pieceId })),
    Match.tag('Explore', () => Target.Explore({ mood: Option.none() })),
    Match.orElse(() => Target.Person({ handle: '' })),
  )

export const init = (target: Target, signedIn: boolean): Model => ({
  target,
  shown: Shown.Loading(),
  tab: 'boards',
  signedIn,
  query: '',
  search: ExploreSearch.Off(),
  people: People.init(
    Target.match(target, {
      Person: ({ handle }) => People.Subject.Person({ handle }),
      Piece: ({ pieceId }) => People.Subject.Piece({ pieceId }),
      // Explore has nobody in particular: an empty handle reads no relation.
      Explore: () => People.Subject.Person({ handle: '' }),
    }),
  ),
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadPerson: { profile: PublicProfile },
  SucceededLoadPublicPiece: { page: PublicPiecePage },
  SucceededLoadExplore: { explore: Explore },
  ChoseMood: { mood: Schema.Option(Mood) },
  FailedLoadVisit: { missing: Schema.Boolean },
  ClickedRetry: {},
  ChoseTab: { tab: PersonTab },
  GotPeopleMessage: { message: People.Message },
  UpdatedSearchQuery: { value: Schema.String },
  SubmittedSearch: {},
  ClickedRetrySearch: {},
  ClickedClearSearch: {},
  SucceededSearchExplore: { query: Schema.String, results: SearchResults },
  FailedSearchExplore: { query: Schema.String },
  CompletedFocusExploreSearch: {},
  CompletedFocusExploreResults: {},
})
export type Message = typeof Message.Type

// COMMAND

/** Not there for others: missing, private, unpublished or held back, or an address that is no handle or id. */
const isMissing = (error: unknown) =>
  Predicate.isTagged(error, 'PublicNotFound') || Predicate.isTagged(error, 'SchemaError')

const LoadPerson = Command.define('LoadPerson', {
  args: { handle: Schema.String },
  messages: [Message.SucceededLoadPerson, Message.FailedLoadVisit],
  execute: ({ handle }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const profile = yield* api.public.profile({
        params: { handle: yield* Schema.decodeUnknownEffect(Handle)(handle.toLowerCase()) },
      })
      return Message.SucceededLoadPerson({ profile })
    }).pipe(
      Effect.catchIf(isMissing, () => Effect.succeed(Message.FailedLoadVisit({ missing: true }))),
      Effect.orElseSucceed(() => Message.FailedLoadVisit({ missing: false })),
    ),
})

const LoadPublicPiece = Command.define('LoadPublicPiece', {
  args: { pieceId: Schema.String },
  messages: [Message.SucceededLoadPublicPiece, Message.FailedLoadVisit],
  execute: ({ pieceId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const page = yield* api.public.piece({ params: { pieceId: yield* Schema.decodeUnknownEffect(PieceId)(pieceId) } })
      return Message.SucceededLoadPublicPiece({ page })
    }).pipe(
      Effect.catchIf(isMissing, () => Effect.succeed(Message.FailedLoadVisit({ missing: true }))),
      Effect.orElseSucceed(() => Message.FailedLoadVisit({ missing: false })),
    ),
})

/** @internal Exported for its tests. */
export const LoadExplore = Command.define('LoadExplore', {
  args: { mood: Schema.Option(Mood) },
  messages: [Message.SucceededLoadExplore, Message.FailedLoadVisit],
  execute: ({ mood }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const explore = yield* api.public.explore({ query: Option.isSome(mood) ? { mood: mood.value } : {} })
      return Message.SucceededLoadExplore({ explore })
    }).pipe(Effect.orElseSucceed(() => Message.FailedLoadVisit({ missing: false }))),
})

/** People and public boards for the words searched; signed out too, since the public search needs no account.
 * @internal Exported for its tests. */
export const SearchExplore = Command.define('SearchExplore', {
  args: { query: Schema.String },
  messages: [Message.SucceededSearchExplore, Message.FailedSearchExplore],
  execute: ({ query }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const results = yield* api.public.search({ query: { q: query } })
      return Message.SucceededSearchExplore({ query, results })
    }).pipe(Effect.orElseSucceed(() => Message.FailedSearchExplore({ query }))),
})

/** Focus back to the search field, after clearing it.
 * @internal Exported for its tests. */
export const FocusExploreSearch = Command.define('FocusExploreSearch', {
  messages: [Message.CompletedFocusExploreSearch],
  execute: Dom.focus(`#${searchFieldId}`).pipe(Effect.ignore, Effect.as(Message.CompletedFocusExploreSearch())),
})

/** Focus to what was found: the phone's keyboard closes and a screen reader reads what the results are for.
 * @internal Exported for its tests. */
export const FocusExploreResults = Command.define('FocusExploreResults', {
  messages: [Message.CompletedFocusExploreResults],
  execute: Dom.focus(`#${searchResultsId}`, { makeFocusable: true }).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedFocusExploreResults()),
  ),
})

const loadTarget = (target: Target): Command.Command<Message, never, StyldClient> =>
  Target.match(target, {
    Person: ({ handle }) => LoadPerson({ handle }),
    Piece: ({ pieceId }) => LoadPublicPiece({ pieceId }),
    Explore: ({ mood }) => LoadExplore({ mood }),
  })

/** The Commands that open the page; where the visitor stands with the person is read once the profile is in. */
export const load = (model: Model): ReadonlyArray<Command.Command<Message, never, StyldClient>> => [
  loadTarget(model.target),
]

/** Signed in, on someone else's profile: where the visitor stands with them is read. Signed out there is nothing to
 * read, and on one's own profile nobody to follow. */
const withRelation = (model: Model, profile: PublicProfile): UpdateReturn => {
  if (!model.signedIn || profile.yours) return { model }
  const read = People.readRelation(model.people)
  return {
    model: modifyFields(model, { people: () => read.model }),
    commands: Command.mapMessages(read.commands ?? [], (message) => Message.GotPeopleMessage({ message })),
  }
}

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

/** Opening Explore as a tab: what it showed stays while it is asked for again; a first visit asks. */
export const enterExplore = (model: Model): UpdateReturn => {
  const mood = Target.guards.Explore(model.target) ? model.target.mood : Option.none()
  return Shown.guards.Explore(model.shown)
    ? { model, commands: [LoadExplore({ mood })] }
    : {
        model: modifyFields(model, { target: () => Target.Explore({ mood }), shown: () => Shown.Loading() }),
        commands: [LoadExplore({ mood })],
      }
}

const foldPeople = People.foldInto<Model, Message>((message) => Message.GotPeopleMessage({ message }))

/** Reading the page again after it failed; the landing asks for it from its own Try again. */
export const retry = (model: Model): UpdateReturn => ({
  model: modifyFields(model, { shown: () => Shown.Loading() }),
  commands: [loadTarget(model.target)],
})

/** The words in the field are searched; a blank field brings Explore's sections back. */
const wordsOf = (model: Model) => model.query.trim().slice(0, searchLength)

const searched = (model: Model): UpdateReturn => {
  const query = wordsOf(model)
  return query.length === 0
    ? { model: modifyFields(model, { search: () => ExploreSearch.Off() }) }
    : {
        model: modifyFields(model, { search: () => ExploreSearch.Searching({ query }) }),
        commands: [SearchExplore({ query })],
      }
}

/** Whether an answer is for the search still waiting; one for words searched before is dropped. */
const awaits = (model: Model, query: string) =>
  ExploreSearch.guards.Searching(model.search) && model.search.query === query

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadPerson: ({ profile }) =>
      withRelation(modifyFields(model, { shown: () => Shown.Person({ profile }) }), profile),
    SucceededLoadPublicPiece: ({ page }) => ({ model: modifyFields(model, { shown: () => Shown.Piece({ page }) }) }),
    SucceededLoadExplore: ({ explore }) => ({
      model: modifyFields(model, { shown: () => Shown.Explore({ explore }) }),
    }),
    ChoseMood: ({ mood }) => ({
      model: modifyFields(model, { target: () => Target.Explore({ mood }) }),
      commands: [LoadExplore({ mood })],
    }),
    FailedLoadVisit: ({ missing }) => ({
      model: modifyFields(model, { shown: () => (missing ? Shown.Missing() : Shown.Failed()) }),
    }),
    ClickedRetry: () => retry(model),
    ChoseTab: ({ tab }) => ({ model: modifyFields(model, { tab: () => tab }) }),
    GotPeopleMessage: (got) => foldPeople(model, got.message),
    UpdatedSearchQuery: ({ value }) => ({
      model: modifyFields(model, {
        query: () => value,
        search: (search) => (value.trim().length === 0 ? ExploreSearch.Off() : search),
      }),
    }),
    SubmittedSearch: () => searched(model),
    ClickedRetrySearch: () => searched(model),
    ClickedClearSearch: () => ({
      model: modifyFields(model, { query: () => '', search: () => ExploreSearch.Off() }),
      commands: [FocusExploreSearch()],
    }),
    SucceededSearchExplore: ({ query, results }) => {
      if (!awaits(model, query)) return { model }
      const found = modifyFields(model, { search: () => ExploreSearch.Found({ query, results }) })
      // Focus moves to the results only while the field still holds the words they are for.
      return wordsOf(model) === query ? { model: found, commands: [FocusExploreResults()] } : { model: found }
    },
    FailedSearchExplore: ({ query }) =>
      awaits(model, query)
        ? { model: modifyFields(model, { search: () => ExploreSearch.Failed({ query }) }) }
        : { model },
    CompletedFocusExploreSearch: () => ({ model }),
    CompletedFocusExploreResults: () => ({ model }),
  })
