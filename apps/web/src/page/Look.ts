import { drawOperationId } from '../OperationIds.ts'
import { Look as LookContract, LookId, PublicLookPage } from '@styld/protocol'
import { Effect, Option, Result, Schema } from 'effect'
import type * as SecureRandom from 'effect/crypto/SecureRandom'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { Deletion } from '../Confirm.ts'
import { LoadError } from '../ServerData.ts'
import { StyldClient } from '../StyldClient.ts'
import * as People from './People.ts'
import * as SaveToBoard from './SaveToBoard.ts'

// MODEL

/** The look as the page shows it: the person's own, or someone else's shared look (or the person's own read signed
 * out), shown as others see it. */
export const LookShown = defineTaggedUnion({
  Own: { look: LookContract },
  Visiting: { page: PublicLookPage },
})
export type LookShown = typeof LookShown.Type

export const LookData = AsyncData.Schema(LookShown, LoadError)
export type LookData = typeof LookData.schema.Type

export { Deletion }

/** Sharing the look on the profile, or no longer; only a published profile shares. */
export const Sharing = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: { needsProfile: Schema.Boolean } })
export type Sharing = typeof Sharing.Type

export const Model = Schema.Struct({
  lookId: Schema.String,
  look: LookData.schema,
  deletion: Deletion,
  sharing: Sharing,
  saveToBoard: SaveToBoard.Model,
  /** Saving and reporting it, when it is someone else's. */
  people: People.Model,
})
export type Model = typeof Model.Type

export const init = (lookId: string): Model => ({
  lookId,
  look: AsyncData.Loading(),
  deletion: Deletion.Idle(),
  sharing: Sharing.Idle(),
  saveToBoard: SaveToBoard.init({ kind: 'look', id: lookId }),
  people: People.init(People.Subject.Look({ lookId })),
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededGetLook: { look: LookContract },
  FailedGetLook: { error: LoadError },
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
  GotPeopleMessage: { message: People.Message },
})
export type Message = typeof Message.Type

/** Gone once deleted; Save to board's sheet asks the app for the person's boards. */
export const OutMessage = defineMessageUnion({ DeletedLook: {}, RequestedBoards: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** A look as others see it, once it is shared and Styld's check lets them. */
const visitLook = (lookId: string) =>
  Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const page = yield* api.public.look({ params: { lookId: yield* Schema.decodeUnknownEffect(LookId)(lookId) } })
    return Message.SucceededVisitLook({ page })
  }).pipe(
    Effect.catchTag('NotFound', () => Effect.succeed(Message.FailedGetLook({ error: 'NotFound' }))),
    Effect.orElseSucceed(() => Message.FailedGetLook({ error: 'Unavailable' })),
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
        SchemaError: () => Effect.succeed(Message.FailedGetLook({ error: 'NotFound' })),
        Unavailable: () => Effect.succeed(Message.FailedGetLook({ error: 'Unavailable' })),
      }),
      // Not this account's look, or nobody signed in: it may be shared.
      Effect.catch(() => visitLook(lookId)),
    ),
})

export const ShareLook = Command.define('ShareLook', {
  args: { lookId: Schema.String, shared: Schema.Boolean },
  messages: [Message.SucceededShareLook, Message.FailedShareLook],
  execute: ({ lookId, shared }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const look = yield* api.look.shareLook({
        params: { lookId: yield* Schema.decodeUnknownEffect(LookId)(lookId) },
        payload: { operationId: yield* drawOperationId(), shared },
      })
      return Message.SucceededShareLook({ look })
    }).pipe(
      Effect.catchTag('ProfileNotPublished', () => Effect.succeed(Message.FailedShareLook({ needsProfile: true }))),
      Effect.orElseSucceed(() => Message.FailedShareLook({ needsProfile: false })),
    ),
})

export const DeleteLook = Command.define('DeleteLook', {
  args: { lookId: Schema.String },
  messages: [Message.SucceededDeleteLook, Message.FailedDeleteLook],
  execute: ({ lookId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      yield* api.look.deleteLook({
        params: { lookId: yield* Schema.decodeUnknownEffect(LookId)(lookId) },
        payload: { operationId: yield* drawOperationId() },
      })
      return Message.SucceededDeleteLook()
    }).pipe(Effect.orElseSucceed(() => Message.FailedDeleteLook())),
})

/** The Commands that open the page. */
export const load = (model: Model) => [GetLook({ lookId: model.lookId })]

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | SecureRandom.SecureRandom>

const foldPeople = Update.foldChild({
  update: People.update,
  ...People.heldBy<Model, Message>((message) => Message.GotPeopleMessage({ message })),
})

const foldSaveToBoard = SaveToBoard.fold<Model, Message, OutMessage>(
  (message) => Message.GotSaveToBoardMessage({ message }),
  () => OutMessage.RequestedBoards(),
)

const showing = (model: Model, shown: LookShown): Model =>
  modifyFields(model, { look: () => LookData.Success({ data: shown }) })

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededGetLook: ({ look }) => ({ model: showing(model, LookShown.Own({ look })) }),
    SucceededVisitLook: ({ page }) => ({ model: showing(model, LookShown.Visiting({ page })) }),
    // A failure keeps a look already shown; a first read that fails says why.
    FailedGetLook: ({ error }) => ({
      model: modifyFields(model, { look: (look) => AsyncData.settle(look, Result.fail(error)) }),
    }),
    ClickedRetry: () =>
      Option.match(AsyncData.revalidateOrLoad(model.look), {
        onNone: () => ({ model }),
        onSome: (look) => ({
          model: modifyFields(model, { look: () => look }),
          commands: [GetLook({ lookId: model.lookId })],
        }),
      }),
    ToggledShared: ({ shared }) =>
      Sharing.guards.Sending(model.sharing)
        ? { model }
        : {
            model: modifyFields(model, { sharing: () => Sharing.Sending() }),
            commands: [ShareLook({ lookId: model.lookId, shared })],
          },
    SucceededShareLook: ({ look }) => ({
      model: modifyFields(showing(model, LookShown.Own({ look })), { sharing: () => Sharing.Idle() }),
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
    GotPeopleMessage: (got) => foldPeople(model, got.message),
  })
