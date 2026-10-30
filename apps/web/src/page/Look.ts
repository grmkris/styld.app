import { Look as LookContract, LookId, PublicLookPage } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import type * as Crypto from 'effect/Crypto'
import { Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'
import * as SaveToBoard from './SaveToBoard.ts'

// MODEL

export const Shown = defineTaggedUnion({
  Loading: {},
  Loaded: { look: LookContract },
  /** Someone else's shared look, or the person's own read signed out: shown as others see it. */
  Visiting: { page: PublicLookPage },
  NotFound: {},
  Failed: {},
})
export type Shown = typeof Shown.Type

export const Deletion = defineTaggedUnion({ Idle: {}, Confirming: {}, Deleting: {}, Failed: {} })
export type Deletion = typeof Deletion.Type

/** Sharing the look on the profile, or no longer; only a published profile shares. */
export const Sharing = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: { needsProfile: Schema.Boolean } })
export type Sharing = typeof Sharing.Type

export const Model = Schema.Struct({
  lookId: Schema.String,
  shown: Shown,
  deletion: Deletion,
  sharing: Sharing,
  saveToBoard: SaveToBoard.Model,
})
export type Model = typeof Model.Type

export const init = (lookId: string): Model => ({
  lookId,
  shown: Shown.Loading(),
  deletion: Deletion.Idle(),
  sharing: Sharing.Idle(),
  saveToBoard: SaveToBoard.init({ kind: 'look', id: lookId }),
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededGetLook: { look: LookContract },
  FailedGetLook: { notFound: Schema.Boolean },
  SucceededVisitLook: { page: PublicLookPage },
  ClickedRetry: {},
  ToggledShared: { shared: Schema.Boolean },
  SucceededShareLook: { look: LookContract },
  FailedShareLook: { needsProfile: Schema.Boolean },
  ClickedDelete: {},
  ClickedCancelDelete: {},
  ClickedConfirmDelete: {},
  SucceededDeleteLook: {},
  FailedDeleteLook: {},
  GotSaveToBoardMessage: { message: SaveToBoard.Message },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({ DeletedLook: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** A look as others see it, once it is shared and Styld's check lets them. */
const visitLook = (lookId: string) =>
  Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const page = yield* api.public.look({ params: { lookId: yield* Schema.decodeUnknownEffect(LookId)(lookId) } })
    return Message.SucceededVisitLook({ page })
  }).pipe(
    Effect.catchTag('PublicNotFound', () => Effect.succeed(Message.FailedGetLook({ notFound: true }))),
    Effect.orElseSucceed(() => Message.FailedGetLook({ notFound: false })),
  )

const GetLook = Command.define('GetLook', {
  args: { lookId: Schema.String },
  messages: [Message.SucceededGetLook, Message.FailedGetLook, Message.SucceededVisitLook],
  execute: ({ lookId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const id = yield* Schema.decodeUnknownEffect(LookId)(lookId)
      return Message.SucceededGetLook({ look: yield* api.look.getLook({ params: { lookId: id } }) })
    }).pipe(
      Effect.catchTags({
        SchemaError: () => Effect.succeed(Message.FailedGetLook({ notFound: true })),
        WardrobeUnavailable: () => Effect.succeed(Message.FailedGetLook({ notFound: false })),
      }),
      // Not this account's look, or nobody signed in: it may be shared.
      Effect.catch(() => visitLook(lookId)),
    ),
})

/** @internal Exported for its tests. */
export const ShareLook = Command.define('ShareLook', {
  args: { lookId: Schema.String, shared: Schema.Boolean },
  messages: [Message.SucceededShareLook, Message.FailedShareLook],
  execute: ({ lookId, shared }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const look = yield* api.look.shareLook({
        params: { lookId: yield* Schema.decodeUnknownEffect(LookId)(lookId) },
        payload: { shared },
      })
      return Message.SucceededShareLook({ look })
    }).pipe(
      Effect.catchTag('ProfileNotPublished', () => Effect.succeed(Message.FailedShareLook({ needsProfile: true }))),
      Effect.orElseSucceed(() => Message.FailedShareLook({ needsProfile: false })),
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

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | Crypto.Crypto>

const foldSaveToBoard = SaveToBoard.foldInto<Model, Message>((message) => Message.GotSaveToBoardMessage({ message }))

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededGetLook: ({ look }) => ({ model: modifyFields(model, { shown: () => Shown.Loaded({ look }) }) }),
    SucceededVisitLook: ({ page }) => ({ model: modifyFields(model, { shown: () => Shown.Visiting({ page }) }) }),
    FailedGetLook: ({ notFound }) => ({
      model: modifyFields(model, { shown: () => (notFound ? Shown.NotFound() : Shown.Failed()) }),
    }),
    ClickedRetry: () => ({
      model: modifyFields(model, { shown: () => Shown.Loading() }),
      commands: [GetLook({ lookId: model.lookId })],
    }),
    ToggledShared: ({ shared }) =>
      Sharing.guards.Sending(model.sharing)
        ? { model }
        : {
            model: modifyFields(model, { sharing: () => Sharing.Sending() }),
            commands: [ShareLook({ lookId: model.lookId, shared })],
          },
    SucceededShareLook: ({ look }) => ({
      model: modifyFields(model, { shown: () => Shown.Loaded({ look }), sharing: () => Sharing.Idle() }),
    }),
    FailedShareLook: ({ needsProfile }) => ({
      model: modifyFields(model, { sharing: () => Sharing.Failed({ needsProfile }) }),
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
    GotSaveToBoardMessage: (got) => foldSaveToBoard(model, got.message),
  })
