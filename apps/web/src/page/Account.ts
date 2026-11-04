import * as SecureRandom from 'effect/crypto/SecureRandom'
import { drawOperationId } from '../OperationIds.ts'
import { Profile } from '@styld/protocol'
import { Effect, Option, Result, Schema } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { Deletion } from '../Confirm.ts'
import { StyldClient } from '../StyldClient.ts'
import { ProfileData, readProfile } from './ProfileRead.ts'
import * as ShowMe from './ShowMe.ts'
import * as Taste from './Taste.ts'

// MODEL

/** Deleting the account: a confirmation in the page, then the request. */
export { Deletion }

/** Copying the assistants' server address. */
export const Copy = defineTaggedUnion({ Idle: {}, Copied: {}, Failed: {} })

export const Model = Schema.Struct({
  deletion: Deletion,
  copy: Copy,
  profile: ProfileData.schema,
  /** What What's new starts with, as Home's card asked. */
  showMe: ShowMe.Model,
  /** What Styld knows about the person: occasions, notes and what it learned. */
  taste: Taste.Model,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  deletion: Deletion.Idle(),
  copy: Copy.Idle(),
  profile: AsyncData.Loading(),
  showMe: ShowMe.init(),
  taste: Taste.init(),
})

// MESSAGE

export const Message = defineMessageUnion({
  ClickedSignOut: {},
  ClickedDeleteAccount: {},
  ClickedKeepAccount: {},
  ClickedConfirmDelete: {},
  SucceededDeleteAccount: {},
  FailedDeleteAccount: {},
  ClickedCopyServerUrl: { url: Schema.String },
  SucceededCopyServerUrl: {},
  FailedCopyServerUrl: {},
  SucceededReadProfile: { profile: Profile },
  FailedReadProfile: {},
  ClickedRetryProfile: {},
  GotShowMeMessage: { message: ShowMe.Message },
  GotTasteMessage: { message: Taste.Message },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({ RequestedSignOut: {}, DeletedAccount: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

export const DeleteAccount = Command.define('DeleteAccount', {
  messages: [Message.SucceededDeleteAccount, Message.FailedDeleteAccount],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    yield* api.account.deleteMe({ payload: { operationId: yield* drawOperationId() } })
    return Message.SucceededDeleteAccount()
  }).pipe(Effect.orElseSucceed(() => Message.FailedDeleteAccount())),
})

export const CopyServerUrl = Command.define('CopyServerUrl', {
  args: { url: Schema.String },
  messages: [Message.SucceededCopyServerUrl, Message.FailedCopyServerUrl],
  execute: ({ url }) =>
    Effect.tryPromise(() => navigator.clipboard.writeText(url)).pipe(
      Effect.as(Message.SucceededCopyServerUrl()),
      Effect.orElseSucceed(() => Message.FailedCopyServerUrl()),
    ),
})

export const ReadProfile = Command.define('ReadProfile', {
  messages: [Message.SucceededReadProfile, Message.FailedReadProfile],
  execute: readProfile(
    (profile) => Message.SucceededReadProfile({ profile }),
    () => Message.FailedReadProfile(),
  ),
})

const showMeFold = ShowMe.heldBy<Model, Message>((message) => Message.GotShowMeMessage({ message }))
const tasteFold = Taste.heldBy<Model, Message>((message) => Message.GotTasteMessage({ message }))

/** Opening the page: the profile, Show me and what Styld knows as they are now; what is already shown stays while it
 * is read again. */
export const enter = (model: Model): Update.Return<Model, Message, StyldClient> =>
  Update.combine<Model, Message, StyldClient>(model, [
    (current) => ({ model: current, commands: [ReadProfile()] }),
    Update.foldChildStep({ update: ShowMe.enter, ...showMeFold }),
    Update.foldChildStep({ update: Taste.enter, ...tasteFold }),
  ])

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | SecureRandom.SecureRandom>

/** What's new is read when Home opens, so a new Show me needs nothing more here. */
const foldShowMe = Update.foldChild({
  update: ShowMe.update,
  ...showMeFold,
  foldOutMessage: ShowMe.OutMessage.match<
    Update.StepWithOutMessage<Model, Message, OutMessage, StyldClient | SecureRandom.SecureRandom>
  >({ ChangedShowMe: () => (stepModel) => ({ model: stepModel }) }),
})

const foldTaste = Update.foldChild({ update: Taste.update, ...tasteFold })

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedSignOut: () => ({ model, outMessage: OutMessage.RequestedSignOut() }),
    ClickedDeleteAccount: () => ({ model: modifyFields(model, { deletion: () => Deletion.Confirming() }) }),
    ClickedKeepAccount: () => ({ model: modifyFields(model, { deletion: () => Deletion.Idle() }) }),
    ClickedConfirmDelete: () =>
      Deletion.guards.Confirming(model.deletion) || Deletion.guards.Failed(model.deletion)
        ? { model: modifyFields(model, { deletion: () => Deletion.Deleting() }), commands: [DeleteAccount()] }
        : { model },
    SucceededDeleteAccount: () => ({ model: init(), outMessage: OutMessage.DeletedAccount() }),
    FailedDeleteAccount: () => ({ model: modifyFields(model, { deletion: () => Deletion.Failed() }) }),
    ClickedCopyServerUrl: ({ url }) => ({ model, commands: [CopyServerUrl({ url })] }),
    SucceededCopyServerUrl: () => ({ model: modifyFields(model, { copy: () => Copy.Copied() }) }),
    FailedCopyServerUrl: () => ({ model: modifyFields(model, { copy: () => Copy.Failed() }) }),
    SucceededReadProfile: ({ profile }) => ({
      model: modifyFields(model, { profile: () => ProfileData.Success({ data: profile }) }),
    }),
    // A failed read keeps the profile already shown.
    FailedReadProfile: () => ({
      model: modifyFields(model, {
        profile: (profile) => AsyncData.settle(profile, Result.fail('Unavailable' as const)),
      }),
    }),
    ClickedRetryProfile: () =>
      Option.match(AsyncData.revalidateOrLoad(model.profile), {
        onNone: () => ({ model }),
        onSome: (profile) => ({ model: modifyFields(model, { profile: () => profile }), commands: [ReadProfile()] }),
      }),
    GotShowMeMessage: (got) => foldShowMe(model, got.message),
    GotTasteMessage: (got) => foldTaste(model, got.message),
  })
