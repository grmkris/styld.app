import * as Crypto from 'effect/Crypto'
import { newOperationId } from '../OperationIds.ts'
import { Explore, Handle, Mood, PieceId, PublicPiecePage, PublicProfile, SearchResults } from '@styld/protocol'
import { Effect, Option, Predicate, Record, Result, Schema } from 'effect'
import { AsyncData, Command, Dom, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { LoadError } from '../ServerData.ts'
import { StyldClient } from '../StyldClient.ts'
import * as People from './People.ts'
import { awaits, PublicSearch, searchPublic, searchWords } from './Search.ts'

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
export const PersonTab = Schema.Literals(['boards', 'looks'])
export type PersonTab = typeof PersonTab.Type

/** What a public page shows once read. */
export const VisitShown = defineTaggedUnion({
  Person: { profile: PublicProfile },
  Piece: { page: PublicPiecePage },
  Explore: { explore: Explore },
})
export type VisitShown = typeof VisitShown.Type

/** The page as last read; a failure keeps what was shown, and one for a page that is not there for others is
 * NotFound. */
export const ShownData = AsyncData.Schema(VisitShown, LoadError)
export type ShownData = typeof ShownData.schema.Type

/** Explore as last read, if it has been. */
export const exploreOf = (shown: ShownData): Option.Option<Explore> =>
  Option.flatMap(AsyncData.getData(shown), (data) =>
    VisitShown.guards.Explore(data) ? Option.some(data.explore) : Option.none(),
  )

/** Someone Explore suggests, followed from here: whether they are followed now, and the change being sent or the one
 * that failed. */
export const Suggestion = Schema.Struct({ following: Schema.Boolean, work: People.Work })
export type Suggestion = typeof Suggestion.Type

/** Explore's Follow for someone nobody has tapped yet: they are not followed, or Explore would not suggest them. */
const untouched: Suggestion = { following: false, work: People.Work.Idle() }

/** Share on a profile or a piece: nothing to say (or the browser's share sheet said it), the link copied where there is
 * no share sheet, or the copy refused. */
export const Sharing = defineTaggedUnion({ Idle: {}, Copied: {}, Failed: {} })
export type Sharing = typeof Sharing.Type

export const Model = Schema.Struct({
  target: Target,
  shown: ShownData.schema,
  tab: PersonTab,
  people: People.Model,
  /** A session came with the page: only then is there a relation to read. */
  signedIn: Schema.Boolean,
  /** What is typed in Explore's search, as typed. */
  query: Schema.String,
  search: PublicSearch,
  /** Explore's Follow buttons, by handle, for those tapped since Explore last loaded. */
  suggestions: Schema.Record(Schema.String, Suggestion),
  sharing: Sharing,
  /** On a piece's page, the board or look it was opened from, where Back returns: a piece is public only through
   * one (owner, 2026-10-31), and its owner's profile does not list pieces. */
  cameFrom: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

/** Where the visitor stands with someone Explore suggests. */
export const suggestionOf = (model: Model, handle: string): Suggestion => model.suggestions[handle] ?? untouched

export const searchFieldId = 'explore-search'
export const searchResultsId = 'explore-results'

/** A page for a visitor; `atFollow` when it opened at `#follow`, where sign-in returns a Follow pressed signed out. */
export const init = (target: Target, signedIn: boolean, atFollow = false): Model => ({
  target,
  shown: AsyncData.Loading(),
  tab: 'boards',
  signedIn,
  query: '',
  search: PublicSearch.Off(),
  suggestions: {},
  sharing: Sharing.Idle(),
  cameFrom: Option.none(),
  people: People.init(
    Target.match(target, {
      Person: ({ handle }) => People.Subject.Person({ handle }),
      Piece: ({ pieceId }) => People.Subject.Piece({ pieceId }),
      // Explore has nobody in particular: an empty handle reads no relation.
      Explore: () => People.Subject.Person({ handle: '' }),
    }),
    atFollow,
  ),
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadPerson: { profile: PublicProfile },
  FailedLoadPerson: { error: LoadError },
  SucceededLoadPublicPiece: { page: PublicPiecePage },
  FailedLoadPublicPiece: { error: LoadError },
  SucceededReadCameFrom: { path: Schema.Option(Schema.String) },
  SucceededLoadExplore: { explore: Explore },
  FailedLoadExplore: {},
  ChoseMood: { mood: Schema.Option(Mood) },
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
  ClickedFollowSuggested: { handle: Schema.String, following: Schema.Boolean },
  SucceededFollowSuggested: { handle: Schema.String, following: Schema.Boolean },
  FailedFollowSuggested: { handle: Schema.String },
  ClickedShare: { url: Schema.String, title: Schema.String },
  SucceededShareLink: { copied: Schema.Boolean },
  FailedShareLink: {},
})
export type Message = typeof Message.Type

// COMMAND

/** Not there for others: missing, private, unpublished or held back, or an address that is no handle or id. */
const isMissing = (error: unknown) => Predicate.isTagged(error, 'NotFound') || Predicate.isTagged(error, 'SchemaError')

const LoadPerson = Command.define('LoadPerson', {
  args: { handle: Schema.String },
  messages: [Message.SucceededLoadPerson, Message.FailedLoadPerson],
  execute: ({ handle }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const profile = yield* api.public.profile({
        params: { handle: yield* Schema.decodeUnknownEffect(Handle)(handle.toLowerCase()) },
      })
      return Message.SucceededLoadPerson({ profile })
    }).pipe(
      Effect.catchIf(isMissing, () => Effect.succeed(Message.FailedLoadPerson({ error: 'NotFound' }))),
      Effect.orElseSucceed(() => Message.FailedLoadPerson({ error: 'Unavailable' })),
    ),
})

const LoadPublicPiece = Command.define('LoadPublicPiece', {
  args: { pieceId: Schema.String },
  messages: [Message.SucceededLoadPublicPiece, Message.FailedLoadPublicPiece],
  execute: ({ pieceId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const page = yield* api.public.piece({ params: { pieceId: yield* Schema.decodeUnknownEffect(PieceId)(pieceId) } })
      return Message.SucceededLoadPublicPiece({ page })
    }).pipe(
      Effect.catchIf(isMissing, () => Effect.succeed(Message.FailedLoadPublicPiece({ error: 'NotFound' }))),
      Effect.orElseSucceed(() => Message.FailedLoadPublicPiece({ error: 'Unavailable' })),
    ),
})

export const LoadExplore = Command.define('LoadExplore', {
  args: { mood: Schema.Option(Mood) },
  messages: [Message.SucceededLoadExplore, Message.FailedLoadExplore],
  execute: ({ mood }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const explore = yield* api.public.explore({ query: Option.isSome(mood) ? { mood: mood.value } : {} })
      return Message.SucceededLoadExplore({ explore })
    }).pipe(Effect.orElseSucceed(() => Message.FailedLoadExplore())),
})

/** People and public boards for the words searched; signed out too, since the public search needs no account.
 */
export const SearchExplore = Command.define('SearchExplore', {
  args: { query: Schema.String },
  messages: [Message.SucceededSearchExplore, Message.FailedSearchExplore],
  execute: ({ query }) =>
    Effect.gen(function* () {
      const results = yield* searchPublic(query)
      return Message.SucceededSearchExplore({ query, results })
    }).pipe(Effect.orElseSucceed(() => Message.FailedSearchExplore({ query }))),
})

/** Focus back to the search field, after clearing it.
 */
export const FocusExploreSearch = Command.define('FocusExploreSearch', {
  messages: [Message.CompletedFocusExploreSearch],
  execute: Dom.focus(`#${searchFieldId}`).pipe(Effect.ignore, Effect.as(Message.CompletedFocusExploreSearch())),
})

/** Focus to what was found: the phone's keyboard closes and a screen reader reads what the results are for.
 */
export const FocusExploreResults = Command.define('FocusExploreResults', {
  messages: [Message.CompletedFocusExploreResults],
  execute: Dom.focus(`#${searchResultsId}`, { makeFocusable: true }).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedFocusExploreResults()),
  ),
})

/** Follows or stops following someone Explore suggests, answering for them by handle.
 */
export const FollowSuggested = Command.define('FollowSuggested', {
  args: { handle: Schema.String, following: Schema.Boolean },
  messages: [Message.SucceededFollowSuggested, Message.FailedFollowSuggested],
  execute: ({ handle, following }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const relation = yield* api.social.setFollowing({
        params: { handle: yield* Schema.decodeUnknownEffect(Handle)(handle) },
        payload: { operationId: yield* newOperationId, following },
      })
      return Message.SucceededFollowSuggested({ handle, following: relation.following })
    }).pipe(Effect.orElseSucceed(() => Message.FailedFollowSuggested({ handle }))),
})

/** Closing the share sheet without sharing is the person's choice, not a failure. */
const shareRefusal = (error: unknown): 'dismissed' | 'refused' =>
  error instanceof DOMException && error.name === 'AbortError' ? 'dismissed' : 'refused'

/** The browser's share sheet where it has one for the link, else the link copied to the clipboard; a share sheet that
 * fails for any reason but being closed copies instead.
 */
export const ShareLink = Command.define('ShareLink', {
  args: { url: Schema.String, title: Schema.String },
  messages: [Message.SucceededShareLink, Message.FailedShareLink],
  execute: ({ url, title }) => {
    const copy = Effect.tryPromise(() => navigator.clipboard.writeText(url)).pipe(
      Effect.as(Message.SucceededShareLink({ copied: true })),
    )
    const share = Effect.tryPromise({ try: () => navigator.share({ url, title }), catch: shareRefusal }).pipe(
      Effect.as(Message.SucceededShareLink({ copied: false })),
      Effect.catch((refusal) =>
        refusal === 'dismissed' ? Effect.succeed(Message.SucceededShareLink({ copied: false })) : copy,
      ),
    )
    const canShare = () => 'share' in navigator && 'canShare' in navigator && navigator.canShare({ url, title })
    return Effect.suspend(() => (canShare() ? share : copy)).pipe(Effect.orElseSucceed(() => Message.FailedShareLink()))
  },
})

/** The pages of this site a public piece is opened from: a public board or a look, Home's feed and Boards' Saved. */
const boardOrLook = /^\/(?:(?:boards\/bd_|looks\/lk_)[\w-]{22}|boards)?$/

/** The board or look page a piece was opened from, from where the page was loaded: a same-origin referrer naming
 * one, nothing for a shared link or any other page.
 */
export const cameFromOf = (referrer: string, origin: string): Option.Option<string> =>
  Option.flatMap(Option.liftThrowable(() => new URL(referrer))(), (url) =>
    url.origin === origin && boardOrLook.test(url.pathname) ? Option.some(url.pathname) : Option.none(),
  )

/** Where a piece's page was opened from, read in the browser once it runs. */
const ReadCameFrom = Command.define('ReadCameFrom', {
  messages: [Message.SucceededReadCameFrom],
  execute: Effect.sync(() =>
    Message.SucceededReadCameFrom({ path: cameFromOf(document.referrer, window.location.origin) }),
  ),
})

const loadTarget = (target: Target): Command.Command<Message, never, StyldClient | Crypto.Crypto> =>
  Target.match(target, {
    Person: ({ handle }) => LoadPerson({ handle }),
    Piece: ({ pieceId }) => LoadPublicPiece({ pieceId }),
    Explore: ({ mood }) => LoadExplore({ mood }),
  })

/** The Commands that open the page; where the visitor stands with the person is read once the profile is in. */
export const load = (model: Model): ReadonlyArray<Command.Command<Message, never, StyldClient | Crypto.Crypto>> => [
  loadTarget(model.target),
  ...(Target.guards.Piece(model.target) ? [ReadCameFrom()] : []),
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

type UpdateReturn = Update.Return<Model, Message, StyldClient | Crypto.Crypto>

/** The tab a profile opens on: Looks when only looks are public, so a visitor never lands on an empty Boards while
 * the person's looks wait behind the next tab. */
const openingTab = (profile: PublicProfile): PersonTab =>
  profile.boards.length === 0 && profile.looks.length > 0 ? 'looks' : 'boards'

/** The page read again: what it showed stays while it is (a failure keeps it too), a page with nothing yet loads, and
 * a read already on its way is not repeated. */
const readAgain = (model: Model): UpdateReturn =>
  Option.match(AsyncData.revalidateOrLoad(model.shown), {
    onNone: () => ({ model }),
    onSome: (shown) => ({ model: modifyFields(model, { shown: () => shown }), commands: [loadTarget(model.target)] }),
  })

/** Opening Explore as a tab: what it showed stays while it is asked for again; a first visit asks. */
export const enterExplore = (model: Model): UpdateReturn => {
  const mood = Target.guards.Explore(model.target) ? model.target.mood : Option.none()
  return Option.isSome(exploreOf(model.shown))
    ? readAgain(model)
    : {
        model: modifyFields(model, { target: () => Target.Explore({ mood }), shown: () => AsyncData.Loading() }),
        commands: [LoadExplore({ mood })],
      }
}

const foldPeople = People.foldInto<Model, Message>((message) => Message.GotPeopleMessage({ message }))

/** Reading the page again after it failed; the landing asks for it from its own Try again. */
export const retry = readAgain

/** A read that did not come: the page keeps what it showed and says why. */
const failed = (model: Model, error: LoadError): UpdateReturn => ({
  model: modifyFields(model, { shown: (shown) => AsyncData.settle(shown, Result.fail(error)) }),
})

/** The words in the field are searched; a blank field brings Explore's sections back. */
const wordsOf = (model: Model) => searchWords(model.query)

const searched = (model: Model): UpdateReturn => {
  const query = wordsOf(model)
  return query.length === 0
    ? { model: modifyFields(model, { search: () => PublicSearch.Off() }) }
    : {
        model: modifyFields(model, { search: () => PublicSearch.Searching({ query }) }),
        commands: [SearchExplore({ query })],
      }
}

const withSuggestion = (model: Model, handle: string, suggestion: Suggestion): Model =>
  modifyFields(model, { suggestions: (suggestions) => Record.set(suggestions, handle, suggestion) })

/** Follow and Following on Explore's people; a tap while one is being sent waits for its answer. */
const followed = (model: Model, handle: string, following: boolean): UpdateReturn => {
  const suggestion = suggestionOf(model, handle)
  return People.Work.guards.Sending(suggestion.work)
    ? { model }
    : {
        model: withSuggestion(model, handle, { following: suggestion.following, work: People.Work.Sending() }),
        commands: [FollowSuggested({ handle, following })],
      }
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadPerson: ({ profile }) =>
      withRelation(
        modifyFields(model, {
          shown: () => ShownData.Success({ data: VisitShown.Person({ profile }) }),
          tab: () => openingTab(profile),
        }),
        profile,
      ),
    SucceededLoadPublicPiece: ({ page }) => ({
      model: modifyFields(model, { shown: () => ShownData.Success({ data: VisitShown.Piece({ page }) }) }),
    }),
    SucceededReadCameFrom: ({ path }) => ({ model: modifyFields(model, { cameFrom: () => path }) }),
    // Fresh people come without anyone already followed, so what was tapped before starts over.
    SucceededLoadExplore: ({ explore }) => ({
      model: modifyFields(model, {
        shown: () => ShownData.Success({ data: VisitShown.Explore({ explore }) }),
        suggestions: () => ({}),
      }),
    }),
    ChoseMood: ({ mood }) => ({
      model: modifyFields(model, { target: () => Target.Explore({ mood }) }),
      commands: [LoadExplore({ mood })],
    }),
    FailedLoadPerson: ({ error }) => failed(model, error),
    FailedLoadPublicPiece: ({ error }) => failed(model, error),
    FailedLoadExplore: () => failed(model, 'Unavailable'),
    ClickedRetry: () => retry(model),
    ChoseTab: ({ tab }) => ({ model: modifyFields(model, { tab: () => tab }) }),
    GotPeopleMessage: (got) => foldPeople(model, got.message),
    UpdatedSearchQuery: ({ value }) => ({
      model: modifyFields(model, {
        query: () => value,
        search: (search) => (value.trim().length === 0 ? PublicSearch.Off() : search),
      }),
    }),
    SubmittedSearch: () => searched(model),
    ClickedRetrySearch: () => searched(model),
    ClickedClearSearch: () => ({
      model: modifyFields(model, { query: () => '', search: () => PublicSearch.Off() }),
      commands: [FocusExploreSearch()],
    }),
    SucceededSearchExplore: ({ query, results }) => {
      if (!awaits(model.search, query)) return { model }
      const found = modifyFields(model, { search: () => PublicSearch.Found({ query, results }) })
      // Focus moves to the results only while the field still holds the words they are for.
      return wordsOf(model) === query ? { model: found, commands: [FocusExploreResults()] } : { model: found }
    },
    FailedSearchExplore: ({ query }) =>
      awaits(model.search, query)
        ? { model: modifyFields(model, { search: () => PublicSearch.Failed({ query }) }) }
        : { model },
    CompletedFocusExploreSearch: () => ({ model }),
    CompletedFocusExploreResults: () => ({ model }),
    ClickedFollowSuggested: ({ handle, following }) => followed(model, handle, following),
    SucceededFollowSuggested: ({ handle, following }) => ({
      model: withSuggestion(model, handle, { following, work: People.Work.Idle() }),
    }),
    FailedFollowSuggested: ({ handle }) => ({
      model: withSuggestion(model, handle, {
        following: suggestionOf(model, handle).following,
        work: People.Work.Failed(),
      }),
    }),
    ClickedShare: ({ url, title }) => ({
      model: modifyFields(model, { sharing: () => Sharing.Idle() }),
      commands: [ShareLink({ url, title })],
    }),
    SucceededShareLink: ({ copied }) => ({
      model: modifyFields(model, { sharing: () => (copied ? Sharing.Copied() : Sharing.Idle()) }),
    }),
    FailedShareLink: () => ({ model: modifyFields(model, { sharing: () => Sharing.Failed() }) }),
  })
