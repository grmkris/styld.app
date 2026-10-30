import { Dialog } from '@foldkit/ui'
import { loadCatalog } from '@styld/i18n'
import { Duration, Effect, Option, Schema, String } from 'effect'
import { Command, Dom, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { replaceUrl } from 'foldkit/navigation'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { askRouter } from '../route.ts'

// MODEL

/** Which languages the search reads a piece's words in: the page's, or both once the other has loaded. */
export const SearchLanguages = defineTaggedUnion({ PageOnly: {}, Both: {} })

/** Ask: search your own wardrobe, the stylist's hand-off to the assistants, and the + sheet. The pieces are the
 * wardrobe's, which the app keeps once for every page. */
export const Model = Schema.Struct({
  /** What is typed in the search, as typed; the address carries it too, so coming back to Ask brings it back. */
  query: Schema.String,
  languages: SearchLanguages,
  /** The + sheet: what you can add from here. */
  addSheet: Dialog.Model,
})
export type Model = typeof Model.Type

export const searchFieldId = 'ask-search'
export const resultsId = 'ask-results'

export const init = (): Model => ({
  query: '',
  languages: SearchLanguages.PageOnly(),
  addSheet: Dialog.init({ id: 'ask-add-sheet' }),
})

// MESSAGE

export const Message = defineMessageUnion({
  UpdatedQuery: { value: Schema.String },
  ElapsedQueryPause: { query: Schema.String },
  CompletedWriteQuery: {},
  ClickedSuggestion: { query: Schema.String },
  ClickedClear: {},
  SubmittedSearch: {},
  CompletedFocus: {},
  ClickedAdd: {},
  GotAddSheetMessage: { message: Dialog.Message },
  ClickedRetry: {},
  SucceededLoadSearchLanguages: {},
  FailedLoadSearchLanguages: {},
})
export type Message = typeof Message.Type

/** The pieces didn't load: the app asks for them again. */
export const OutMessage = defineMessageUnion({ RequestedPieces: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** English and Slovenian both, so "shoes" finds shoes on a Slovenian page and "čevlji" on an English one; the
 * page's own language is already here.
 * @internal Exported for its tests. */
export const LoadSearchLanguages = Command.define('LoadSearchLanguages', {
  messages: [Message.SucceededLoadSearchLanguages, Message.FailedLoadSearchLanguages],
  execute: Effect.tryPromise(() => Promise.all([loadCatalog('en'), loadCatalog('sl')])).pipe(
    Effect.as(Message.SucceededLoadSearchLanguages()),
    Effect.orElseSucceed(() => Message.FailedLoadSearchLanguages()),
  ),
})

/** Typing settles before the address follows, so the browser's history isn't written on every key. */
const WaitBeforeWritingQuery = Command.define('WaitBeforeWritingQuery', {
  args: { query: Schema.String },
  messages: [Message.ElapsedQueryPause],
  execute: ({ query }) => Effect.sleep(Duration.millis(300)).pipe(Effect.as(Message.ElapsedQueryPause({ query }))),
})

/** The search in the address (`/ask?q=…`), replacing the current entry rather than adding one.
 * @internal Exported for its tests. */
export const WriteQuery = Command.define('WriteQuery', {
  args: { query: Schema.String },
  messages: [Message.CompletedWriteQuery],
  execute: ({ query }) =>
    replaceUrl(askRouter({ q: Option.liftPredicate(query.trim(), String.isNonEmpty) })).pipe(
      Effect.catchDefect(() => Effect.void),
      Effect.as(Message.CompletedWriteQuery()),
    ),
})

/** Focus to the search field, after clearing it.
 * @internal Exported for its tests. */
export const FocusSearch = Command.define('FocusSearch', {
  messages: [Message.CompletedFocus],
  execute: Dom.focus(`#${searchFieldId}`).pipe(Effect.ignore, Effect.as(Message.CompletedFocus())),
})

/** Focus to what was found, after Enter: the keyboard closes and a screen reader reads the count.
 * @internal Exported for its tests. */
export const FocusResults = Command.define('FocusResults', {
  messages: [Message.CompletedFocus],
  execute: Dom.focus(`#${resultsId}`, { makeFocusable: true }).pipe(Effect.ignore, Effect.as(Message.CompletedFocus())),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const sheetFold = {
  read: (model: Model) => Option.some(model.addSheet),
  write: (model: Model, addSheet: Dialog.Model) => modifyFields(model, { addSheet: () => addSheet }),
  toParentMessage: (message: Dialog.Message) => Message.GotAddSheetMessage({ message }),
  foldOutMessage: Dialog.OutMessage.match<Update.Step<Model, Message>>({
    Opened: () => (model) => ({ model }),
    Closed: () => (model) => ({ model }),
  }),
}
const foldAddSheet = Update.foldChild({ update: Dialog.update, ...sheetFold })
const openAddSheet = Update.foldChildStep({ update: Dialog.open, ...sheetFold })
const closeAddSheet = Update.foldChildStep({ update: Dialog.close, ...sheetFold })

/** Opening Ask: a search in the address is brought back, and the search learns the other language once. */
export const enter =
  (maybeQuery: Option.Option<string>) =>
  (model: Model): Update.Return<Model, Message> => {
    const query = Option.getOrElse(maybeQuery, () => model.query)
    const next = query === model.query ? model : modifyFields(model, { query: () => query })
    return SearchLanguages.guards.Both(model.languages)
      ? { model: next }
      : { model: next, commands: [LoadSearchLanguages()] }
  }

/** Leaving Ask closes the + sheet. */
export const leave = closeAddSheet

const searched = (model: Model, query: string): UpdateReturn => ({
  model: modifyFields(model, { query: () => query }),
  commands: [WriteQuery({ query })],
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    UpdatedQuery: ({ value }) => ({
      model: modifyFields(model, { query: () => value }),
      commands: [WaitBeforeWritingQuery({ query: value })],
    }),
    // Only the newest query is written: an older pause finds the query moved on.
    ElapsedQueryPause: ({ query }) =>
      query === model.query ? { model, commands: [WriteQuery({ query })] } : { model },
    CompletedWriteQuery: () => ({ model }),
    ClickedSuggestion: ({ query }) => searched(model, query),
    ClickedClear: () => ({
      model: modifyFields(model, { query: () => '' }),
      commands: [WriteQuery({ query: '' }), FocusSearch()],
    }),
    SubmittedSearch: () => ({ model, commands: [WriteQuery({ query: model.query }), FocusResults()] }),
    CompletedFocus: () => ({ model }),
    ClickedAdd: () => openAddSheet(model),
    GotAddSheetMessage: (got) => foldAddSheet(model, got.message),
    ClickedRetry: () => ({ model, outMessage: OutMessage.RequestedPieces() }),
    SucceededLoadSearchLanguages: () => ({ model: modifyFields(model, { languages: () => SearchLanguages.Both() }) }),
    // The page's own language still searches.
    FailedLoadSearchLanguages: () => ({ model }),
  })
