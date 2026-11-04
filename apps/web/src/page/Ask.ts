import { Dialog } from '@foldkit/ui'
import { loadCatalog } from '@styld/i18n'
import { Duration, Effect, Option, Schema, String } from 'effect'
import { Command, Dom, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { replaceUrl } from 'foldkit/navigation'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { sheetFolds } from './Sheet.ts'
import { awaits, PublicSearch, searchPublic, searchWords } from './Search.ts'
import { SearchResults } from '@styld/protocol'
import { askRouter } from '../route.ts'
import { StyldClient } from '../StyldClient.ts'

// MODEL

/** Which languages the search reads a piece's words in: the page's, both once the other has loaded, or the page's
 * alone because the other did not load (the page says so and offers to try again). */
export const SearchLanguages = defineTaggedUnion({ PageOnly: {}, Both: {}, OtherUnavailable: {} })

/** Ask: search your own wardrobe, the stylist's hand-off to the assistants, and the + sheet. The pieces are the
 * wardrobe's, which the app keeps once for every page. What is typed lives only in the address (`/ask?q=…`, Foldkit's
 * query-sync): the view reads it from the route and update gets it as context. */
export const Model = Schema.Struct({
  /** Counts the searches asked for, so an older pause or answer is dropped. */
  revision: Schema.Number,
  languages: SearchLanguages,
  /** The + sheet: what you can add from here. */
  addSheet: Dialog.Model,
  /** People and public boards searched for the words typed (PublicSearch, shared with Explore). */
  search: PublicSearch,
})
export type Model = typeof Model.Type

export const searchFieldId = 'ask-search'
export const resultsId = 'ask-results'

export const init = (): Model => ({
  revision: 0,
  languages: SearchLanguages.PageOnly(),
  addSheet: Dialog.init({ id: 'ask-add-sheet', isAnimated: true }),
  search: PublicSearch.Off(),
})

// MESSAGE

export const Message = defineMessageUnion({
  UpdatedQuery: { value: Schema.String },
  ElapsedSearchPause: { query: Schema.String, revision: Schema.Number },
  CompletedReplaceQuery: {},
  ClickedSuggestion: { query: Schema.String },
  ClickedClear: {},
  SubmittedSearch: {},
  CompletedFocus: {},
  ClickedAdd: {},
  ClickedNewBoard: {},
  GotAddSheetMessage: { message: Dialog.Message },
  ClickedRetry: {},
  SucceededLoadSearchLanguages: {},
  FailedLoadSearchLanguages: {},
  ClickedRetrySearchLanguages: {},
  SucceededSearchPublic: { query: Schema.String, revision: Schema.Number, results: SearchResults },
  FailedSearchPublic: { query: Schema.String, revision: Schema.Number },
})
export type Message = typeof Message.Type

/** The pieces didn't load: the app asks for them again. */
export const OutMessage = defineMessageUnion({
  RequestedPieces: {},
  /** Start a board from the + sheet: Boards makes it under the default name and opens it. */
  RequestedNewBoard: {},
})
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** English and Slovenian both, so "shoes" finds shoes on a Slovenian page and "čevlji" on an English one; the
 * page's own language is already here.
 */
export const LoadSearchLanguages = Command.define('LoadSearchLanguages', {
  messages: [Message.SucceededLoadSearchLanguages, Message.FailedLoadSearchLanguages],
  execute: Effect.tryPromise(() => Promise.all([loadCatalog('en'), loadCatalog('sl')])).pipe(
    Effect.as(Message.SucceededLoadSearchLanguages()),
    Effect.orElseSucceed(() => Message.FailedLoadSearchLanguages()),
  ),
})

/** Typing settles before people and boards are searched on the server; the wardrobe is searched here at once. */
export const WaitBeforeSearching = Command.define('WaitBeforeSearching', {
  args: { query: Schema.String, revision: Schema.Number },
  messages: [Message.ElapsedSearchPause],
  execute: ({ query, revision }) =>
    Effect.sleep(Duration.millis(300)).pipe(Effect.as(Message.ElapsedSearchPause({ query, revision }))),
})

/** What is typed, as typed, in the address (`/ask?q=…`), replacing the current entry rather than adding one: the field
 * reads it back from the route, so it is never trimmed here. A browser refusing a burst of replaces is ignored. */
export const ReplaceQuery = Command.define('ReplaceQuery', {
  args: { q: Schema.String },
  messages: [Message.CompletedReplaceQuery],
  execute: ({ q }) =>
    replaceUrl(askRouter({ q: Option.liftPredicate(q, String.isNonEmpty) })).pipe(
      Effect.catchDefect(() => Effect.void),
      Effect.as(Message.CompletedReplaceQuery()),
    ),
})

/** Focus to the search field, after clearing it.
 */
export const FocusSearch = Command.define('FocusSearch', {
  messages: [Message.CompletedFocus],
  execute: Dom.focus(`#${searchFieldId}`).pipe(Effect.ignore, Effect.as(Message.CompletedFocus())),
})

/** People and public boards for the query, searched on the server; the wardrobe is searched here.
 */
export const SearchPublic = Command.define('SearchPublic', {
  args: { query: Schema.String, revision: Schema.Number },
  messages: [Message.SucceededSearchPublic, Message.FailedSearchPublic],
  execute: ({ query, revision }) =>
    Effect.gen(function* () {
      const results = yield* searchPublic(query)
      return Message.SucceededSearchPublic({ query, revision, results })
    }).pipe(Effect.orElseSucceed(() => Message.FailedSearchPublic({ query, revision }))),
})

/** Words long enough to look for people and boards with. */
const searchable = (words: string) => words.length >= 2

/** Whether the search stands for the words typed: their search, or none for words too short to search. */
const isCurrent = (search: PublicSearch, words: string) =>
  searchable(words) ? !PublicSearch.guards.Off(search) && search.query === words : PublicSearch.guards.Off(search)

/** Focus to what was found, after Enter: the keyboard closes and a screen reader reads the count.
 */
export const FocusResults = Command.define('FocusResults', {
  messages: [Message.CompletedFocus],
  execute: Dom.focus(`#${resultsId}`, { makeFocusable: true }).pipe(Effect.ignore, Effect.as(Message.CompletedFocus())),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient>

const addSheet = sheetFolds<Model, Message>({
  read: (model) => model.addSheet,
  write: (model, nextAddSheet) => modifyFields(model, { addSheet: () => nextAddSheet }),
  toParentMessage: (message) => Message.GotAddSheetMessage({ message }),
})
const foldAddSheet = addSheet.update
const openAddSheet = addSheet.open
const closeAddSheet = addSheet.close

/** What Ask is given with each Message: the words in the address, as typed. */
export type Context = Readonly<{ query: string }>

/** A new search for these words now: asked for when they are long enough, and none otherwise. */
const searchNow = (model: Model, words: string): Update.Return<Model, Message, StyldClient> => {
  const revision = model.revision + 1
  return searchable(words)
    ? {
        model: modifyFields(model, {
          revision: () => revision,
          search: () => PublicSearch.Searching({ query: words }),
        }),
        commands: [SearchPublic({ query: words, revision })],
      }
    : { model: modifyFields(model, { revision: () => revision, search: () => PublicSearch.Off() }) }
}

/** Opening Ask at an address: the other language is loaded for the wardrobe search, and the words searched unless
 * their search is already here. */
export const enter =
  (maybeQuery: Option.Option<string>) =>
  (model: Model): Update.Return<Model, Message, StyldClient> => {
    const words = searchWords(Option.getOrElse(maybeQuery, () => ''))
    const searched = isCurrent(model.search, words) ? { model } : searchNow(model, words)
    return {
      model: searched.model,
      commands: [
        ...(SearchLanguages.guards.Both(model.languages) ? [] : [LoadSearchLanguages()]),
        ...(searched.commands ?? []),
      ],
    }
  }

/** Invalidate timers and responses when leaving the tab. */
export const leave = (model: Model) =>
  closeAddSheet(modifyFields(model, { revision: (revision) => revision + 1, search: () => PublicSearch.Off() }))

/** The address moved within Ask: our own replace changes nothing, since its search already stands for the words;
 * Back or Forward to other words searches them. */
export const informQuery = (maybeQuery: Option.Option<string>) => (model: Model) => {
  const words = searchWords(Option.getOrElse(maybeQuery, () => ''))
  return isCurrent(model.search, words) ? { model } : searchNow(model, words)
}

/** Typed: the address takes the words at once, and once they settle people and boards are searched for them. */
const typed = (model: Model, value: string): UpdateReturn => {
  const words = searchWords(value)
  const replace = ReplaceQuery({ q: value })
  if (isCurrent(model.search, words)) return { model, commands: [replace] }
  const revision = model.revision + 1
  return searchable(words)
    ? {
        model: modifyFields(model, { revision: () => revision, search: () => PublicSearch.Waiting({ query: words }) }),
        commands: [replace, WaitBeforeSearching({ query: words, revision })],
      }
    : {
        model: modifyFields(model, { revision: () => revision, search: () => PublicSearch.Off() }),
        commands: [replace],
      }
}

/** Enter: what is waiting for its pause is searched at once, and focus goes to what was found. */
const submitted = (model: Model, context: Context): UpdateReturn => {
  const words = searchWords(context.query)
  const searched = PublicSearch.guards.Waiting(model.search) ? searchNow(model, words) : { model }
  return { model: searched.model, commands: [...(searched.commands ?? []), FocusResults()] }
}

export const update = (model: Model, message: Message, context: Context): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    UpdatedQuery: ({ value }) => typed(model, value),
    // Only the newest pause searches: an older one finds the search moved on.
    ElapsedSearchPause: ({ query, revision }) =>
      revision === model.revision && PublicSearch.guards.Waiting(model.search) && model.search.query === query
        ? {
            model: modifyFields(model, { search: () => PublicSearch.Searching({ query }) }),
            commands: [SearchPublic({ query, revision })],
          }
        : { model },
    CompletedReplaceQuery: () => ({ model }),
    ClickedSuggestion: ({ query }) => {
      const searched = searchNow(model, searchWords(query))
      return { model: searched.model, commands: [ReplaceQuery({ q: query }), ...(searched.commands ?? [])] }
    },
    ClickedClear: () => ({
      model: modifyFields(model, { revision: (revision) => revision + 1, search: () => PublicSearch.Off() }),
      commands: [ReplaceQuery({ q: '' }), FocusSearch()],
    }),
    SubmittedSearch: () => submitted(model, context),
    CompletedFocus: () => ({ model }),
    ClickedAdd: () => openAddSheet(model),
    // Boards opens with its new-board sheet, where the template is chosen (F-26).
    ClickedNewBoard: () => Update.withOutMessage(closeAddSheet(model), OutMessage.RequestedNewBoard()),
    GotAddSheetMessage: (got) => foldAddSheet(model, got.message),
    ClickedRetry: () => ({ model, outMessage: OutMessage.RequestedPieces() }),
    SucceededLoadSearchLanguages: () => ({ model: modifyFields(model, { languages: () => SearchLanguages.Both() }) }),
    // The page's own language still searches, and the results say the other is missing.
    FailedLoadSearchLanguages: () => ({
      model: modifyFields(model, { languages: () => SearchLanguages.OtherUnavailable() }),
    }),
    ClickedRetrySearchLanguages: () => ({
      model: modifyFields(model, { languages: () => SearchLanguages.PageOnly() }),
      commands: [LoadSearchLanguages()],
    }),
    // An answer for a query since changed is dropped.
    SucceededSearchPublic: ({ query, revision, results }) =>
      revision === model.revision && awaits(model.search, query)
        ? { model: modifyFields(model, { search: () => PublicSearch.Found({ query, results }) }) }
        : { model },
    FailedSearchPublic: ({ query, revision }) =>
      revision === model.revision && awaits(model.search, query)
        ? { model: modifyFields(model, { search: () => PublicSearch.Failed({ query }) }) }
        : { model },
  })
