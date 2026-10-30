import { loadCatalog } from '@styld/i18n'
import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

// MODEL

/** Ask: search your own wardrobe, the stylist's hand-off to the assistants, and the + sheet. The pieces are the
 * wardrobe's, which the app keeps once for every page. */
/** Which languages the search reads a piece's words in: the page's, or both once the other has loaded. */
export const SearchLanguages = defineTaggedUnion({ PageOnly: {}, Both: {} })

export const Model = Schema.Struct({
  query: Schema.String,
  languages: SearchLanguages,
  /** The + sheet under its button: what you can add from here. */
  isAdding: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (): Model => ({ query: '', languages: SearchLanguages.PageOnly(), isAdding: false })

// MESSAGE

export const Message = defineMessageUnion({
  UpdatedQuery: { value: Schema.String },
  ClickedSuggestion: { query: Schema.String },
  ClickedClear: {},
  ClickedAdd: {},
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

// UPDATE

/** Opening Ask: the search learns the other language once. */
export const enter = (model: Model): Update.Return<Model, Message> =>
  SearchLanguages.guards.Both(model.languages) ? { model } : { model, commands: [LoadSearchLanguages()] }

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

/** Leaving Ask closes the + sheet. */
export const leave = (model: Model): Update.Return<Model, Message> => ({
  model: modifyFields(model, { isAdding: () => false }),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    UpdatedQuery: ({ value }) => ({ model: modifyFields(model, { query: () => value }) }),
    ClickedSuggestion: ({ query }) => ({ model: modifyFields(model, { query: () => query }) }),
    ClickedClear: () => ({ model: modifyFields(model, { query: () => '' }) }),
    ClickedAdd: () => ({ model: modifyFields(model, { isAdding: (isAdding) => !isAdding }) }),
    ClickedRetry: () => ({ model, outMessage: OutMessage.RequestedPieces() }),
    SucceededLoadSearchLanguages: () => ({ model: modifyFields(model, { languages: () => SearchLanguages.Both() }) }),
    // The page's own language still searches.
    FailedLoadSearchLanguages: () => ({ model }),
  })
