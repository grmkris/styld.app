import { Look } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// MODEL

export const Saved = defineTaggedUnion({
  Loading: {},
  Loaded: { looks: Schema.Array(Look) },
  Failed: {},
})
export type Saved = typeof Saved.Type

export const Model = Schema.Struct({ saved: Saved })
export type Model = typeof Model.Type

export const init = (): Model => ({ saved: Saved.Loading() })

// MESSAGE

export const Message = defineMessageUnion({
  SucceededListLooks: { looks: Schema.Array(Look) },
  FailedListLooks: {},
  ClickedRetry: {},
})
export type Message = typeof Message.Type

// COMMAND

/** @internal Exported for its tests. */
export const ListLooks = Command.define('ListLooks', {
  messages: [Message.SucceededListLooks, Message.FailedListLooks],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { looks } = yield* api.look.listLooks()
    return Message.SucceededListLooks({ looks })
  }).pipe(Effect.orElseSucceed(() => Message.FailedListLooks())),
})

/** The Commands that open the page. */
export const load = () => [ListLooks()]

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededListLooks: ({ looks }) => ({ model: modifyFields(model, { saved: () => Saved.Loaded({ looks }) }) }),
    FailedListLooks: () => ({ model: modifyFields(model, { saved: () => Saved.Failed() }) }),
    ClickedRetry: () => ({ model: modifyFields(model, { saved: () => Saved.Loading() }), commands: [ListLooks()] }),
  })
