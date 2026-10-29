import { Look as LookContract, LookId } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// MODEL

export const Shown = defineTaggedUnion({
  Loading: {},
  Loaded: { look: LookContract },
  NotFound: {},
  Failed: {},
})
export type Shown = typeof Shown.Type

export const Deletion = defineTaggedUnion({ Idle: {}, Confirming: {}, Deleting: {}, Failed: {} })
export type Deletion = typeof Deletion.Type

export const Model = Schema.Struct({ lookId: Schema.String, shown: Shown, deletion: Deletion })
export type Model = typeof Model.Type

export const init = (lookId: string): Model => ({ lookId, shown: Shown.Loading(), deletion: Deletion.Idle() })

// MESSAGE

export const Message = defineMessageUnion({
  SucceededGetLook: { look: LookContract },
  FailedGetLook: { notFound: Schema.Boolean },
  ClickedRetry: {},
  ClickedDelete: {},
  ClickedCancelDelete: {},
  ClickedConfirmDelete: {},
  SucceededDeleteLook: {},
  FailedDeleteLook: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({ DeletedLook: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

const GetLook = Command.define('GetLook', {
  args: { lookId: Schema.String },
  messages: [Message.SucceededGetLook, Message.FailedGetLook],
  execute: ({ lookId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const id = yield* Schema.decodeUnknownEffect(LookId)(lookId)
      return Message.SucceededGetLook({ look: yield* api.look.getLook({ params: { lookId: id } }) })
    }).pipe(
      Effect.catchTags({
        LookNotFound: () => Effect.succeed(Message.FailedGetLook({ notFound: true })),
        SchemaError: () => Effect.succeed(Message.FailedGetLook({ notFound: true })),
      }),
      Effect.orElseSucceed(() => Message.FailedGetLook({ notFound: false })),
    ),
})

/** @internal Exported for its tests. */
export const DeleteLook = Command.define('DeleteLook', {
  args: { lookId: Schema.String },
  messages: [Message.SucceededDeleteLook, Message.FailedDeleteLook],
  execute: ({ lookId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      yield* api.look.deleteLook({ params: { lookId: yield* Schema.decodeUnknownEffect(LookId)(lookId) } })
      return Message.SucceededDeleteLook()
    }).pipe(Effect.orElseSucceed(() => Message.FailedDeleteLook())),
})

/** The Commands that open the page. */
export const load = (model: Model) => [GetLook({ lookId: model.lookId })]

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededGetLook: ({ look }) => ({ model: modifyFields(model, { shown: () => Shown.Loaded({ look }) }) }),
    FailedGetLook: ({ notFound }) => ({
      model: modifyFields(model, { shown: () => (notFound ? Shown.NotFound() : Shown.Failed()) }),
    }),
    ClickedRetry: () => ({
      model: modifyFields(model, { shown: () => Shown.Loading() }),
      commands: [GetLook({ lookId: model.lookId })],
    }),
    ClickedDelete: () => ({ model: modifyFields(model, { deletion: () => Deletion.Confirming() }) }),
    ClickedCancelDelete: () =>
      Deletion.guards.Deleting(model.deletion)
        ? { model }
        : { model: modifyFields(model, { deletion: () => Deletion.Idle() }) },
    ClickedConfirmDelete: () =>
      Deletion.guards.Deleting(model.deletion)
        ? { model }
        : {
            model: modifyFields(model, { deletion: () => Deletion.Deleting() }),
            commands: [DeleteLook({ lookId: model.lookId })],
          },
    SucceededDeleteLook: () => ({ model, outMessage: OutMessage.DeletedLook() }),
    FailedDeleteLook: () => ({ model: modifyFields(model, { deletion: () => Deletion.Failed() }) }),
  })
