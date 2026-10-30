import { Schema } from 'effect'
import type { Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

// MODEL

/** Ask: search your own wardrobe, the stylist's hand-off to the assistants, and the + sheet. The pieces are the
 * wardrobe's, which the app keeps once for every page. */
export const Model = Schema.Struct({
  query: Schema.String,
  /** The + sheet under its button: what you can add from here. */
  isAdding: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (): Model => ({ query: '', isAdding: false })

// MESSAGE

export const Message = defineMessageUnion({
  UpdatedQuery: { value: Schema.String },
  ClickedSuggestion: { query: Schema.String },
  ClickedClear: {},
  ClickedAdd: {},
  ClickedRetry: {},
})
export type Message = typeof Message.Type

/** The pieces didn't load: the app asks for them again. */
export const OutMessage = defineMessageUnion({ RequestedPieces: {} })
export type OutMessage = typeof OutMessage.Type

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    UpdatedQuery: ({ value }) => ({ model: modifyFields(model, { query: () => value }) }),
    ClickedSuggestion: ({ query }) => ({ model: modifyFields(model, { query: () => query }) }),
    ClickedClear: () => ({ model: modifyFields(model, { query: () => '' }) }),
    ClickedAdd: () => ({ model: modifyFields(model, { isAdding: (isAdding) => !isAdding }) }),
    ClickedRetry: () => ({ model, outMessage: OutMessage.RequestedPieces() }),
  })
