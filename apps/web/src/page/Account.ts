import * as Crypto from 'effect/Crypto'
import { newOperationId } from '../OperationIds.ts'
import { Profile } from '@styld/protocol'
import { Effect, Option, Result, Schema } from 'effect'
import { AsyncData, Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { Deletion } from '../Confirm.ts'
import { StyldClient } from '../StyldClient.ts'
import { ProfileData, readProfile } from './ProfileRead.ts'

// MODEL

/** Deleting the account: a confirmation in the page, then the request. */
export { Deletion }

/** Copying the assistants' server address. */
export const Copy = defineTaggedUnion({ Idle: {}, Copied: {}, Failed: {} })

export const Model = Schema.Struct({ deletion: Deletion, copy: Copy, profile: ProfileData.schema })
export type Model = typeof Model.Type

export const init = (): Model => ({ deletion: Deletion.Idle(), copy: Copy.Idle(), profile: AsyncData.Loading() })

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
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({ RequestedSignOut: {}, DeletedAccount: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

export const DeleteAccount = Command.define('DeleteAccount', {
  messages: [Message.SucceededDeleteAccount, Message.FailedDeleteAccount],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    yield* api.account.deleteMe({ payload: { operationId: yield* newOperationId } })
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

/** Opening the page: the profile as it is now; one already shown stays while it is read again. */
export const enter = (model: Model): Update.Return<Model, Message, StyldClient> => ({
  model,
  commands: [ReadProfile()],
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | Crypto.Crypto>

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
  })
