import { Option, Schema } from 'effect'
import { Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import type { StyldClient } from '../StyldClient.ts'
import * as Wardrobe from './Wardrobe.ts'

// MODEL

/** Ask: search your own wardrobe, the stylist's hand-off to the assistants, and the + sheet. The pieces come
 * from the wardrobe page's own model, which also refreshes them while new ones are processed. */
export const Model = Schema.Struct({
  wardrobe: Wardrobe.Model,
  query: Schema.String,
  /** The + sheet under its button: what you can add from here. */
  isAdding: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (): Model => ({ wardrobe: Wardrobe.init(), query: '', isAdding: false })

// MESSAGE

export const Message = defineMessageUnion({
  GotWardrobeMessage: { message: Wardrobe.Message },
  UpdatedQuery: { value: Schema.String },
  ClickedSuggestion: { query: Schema.String },
  ClickedClear: {},
  ClickedAdd: {},
  ClickedRetry: {},
})
export type Message = typeof Message.Type

export const load = () => Command.mapMessages(Wardrobe.load(), (message) => Message.GotWardrobeMessage({ message }))

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

const foldWardrobe = Update.foldChild({
  update: Wardrobe.update,
  read: (model: Model) => Option.some(model.wardrobe),
  write: (model: Model, wardrobe: Wardrobe.Model) => modifyFields(model, { wardrobe: () => wardrobe }),
  toParentMessage: (message: Wardrobe.Message) => Message.GotWardrobeMessage({ message }),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    GotWardrobeMessage: (got) => foldWardrobe(model, got.message),
    UpdatedQuery: ({ value }) => ({ model: modifyFields(model, { query: () => value }) }),
    ClickedSuggestion: ({ query }) => ({ model: modifyFields(model, { query: () => query }) }),
    ClickedClear: () => ({ model: modifyFields(model, { query: () => '' }) }),
    ClickedAdd: () => ({ model: modifyFields(model, { isAdding: (isAdding) => !isAdding }) }),
    ClickedRetry: () => ({ model: modifyFields(model, { wardrobe: () => Wardrobe.init() }), commands: load() }),
  })
