import { Look } from '@styld/protocol'
import { Effect, Option, Result, Schema } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// MODEL

/** The saved looks as last read, kept on screen while they are asked for again. */
export const SavedData = AsyncData.Schema(Schema.Array(Look), Schema.Literal('Unavailable'))
export type SavedData = typeof SavedData.schema.Type

export const Model = Schema.Struct({ saved: SavedData.schema })
export type Model = typeof Model.Type

export const init = (): Model => ({ saved: AsyncData.Idle() })

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

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

/** Opening the page: the looks already here stay while they are asked for again; a first visit asks. */
export const revisit = Update.refresh<Model, Message, ReadonlyArray<Look>, 'Unavailable', StyldClient>({
  read: (model: Model) => Option.some(model.saved),
  revalidate: AsyncData.revalidateOrLoad,
  write: (model: Model, saved: SavedData) => modifyFields(model, { saved: () => saved }),
  load: ListLooks(),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededListLooks: ({ looks }) => ({
      model: modifyFields(model, { saved: () => SavedData.Success({ data: looks }) }),
    }),
    FailedListLooks: () => ({
      model: modifyFields(model, { saved: (saved) => AsyncData.settle(saved, Result.fail('Unavailable' as const)) }),
    }),
    ClickedRetry: () => revisit(model),
  })
