import { Profile } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// MODEL

/** Deleting the account: a confirmation in the page, then the request. */
export const Deletion = defineTaggedUnion({ Idle: {}, Confirming: {}, Deleting: {}, Failed: {} })

/** Copying the assistants' server address. */
export const Copy = defineTaggedUnion({ Idle: {}, Copied: {}, Failed: {} })

/** The public profile, read when the page opens, so the page says where it stands. */
export const ProfileState = defineTaggedUnion({ Loading: {}, Loaded: { profile: Profile }, Failed: {} })

export const Model = Schema.Struct({ deletion: Deletion, copy: Copy, profile: ProfileState })
export type Model = typeof Model.Type

export const init = (): Model => ({ deletion: Deletion.Idle(), copy: Copy.Idle(), profile: ProfileState.Loading() })

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
  SucceededLoadProfile: { profile: Profile },
  FailedLoadProfile: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({ RequestedSignOut: {}, DeletedAccount: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** @internal Exported for its tests. */
export const DeleteAccount = Command.define('DeleteAccount', {
  messages: [Message.SucceededDeleteAccount, Message.FailedDeleteAccount],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    yield* api.account.deleteMe()
    return Message.SucceededDeleteAccount()
  }).pipe(Effect.orElseSucceed(() => Message.FailedDeleteAccount())),
})

/** @internal Exported for its tests. */
export const CopyServerUrl = Command.define('CopyServerUrl', {
  args: { url: Schema.String },
  messages: [Message.SucceededCopyServerUrl, Message.FailedCopyServerUrl],
  execute: ({ url }) =>
    Effect.tryPromise(() => navigator.clipboard.writeText(url)).pipe(
      Effect.as(Message.SucceededCopyServerUrl()),
      Effect.orElseSucceed(() => Message.FailedCopyServerUrl()),
    ),
})

/** @internal Exported for its tests. */
export const LoadProfile = Command.define('LoadProfile', {
  messages: [Message.SucceededLoadProfile, Message.FailedLoadProfile],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return Message.SucceededLoadProfile({ profile: yield* api.profile.getProfile() })
  }).pipe(Effect.orElseSucceed(() => Message.FailedLoadProfile())),
})

/** Opening the page: the profile as it is now; one already shown stays while it is read again. */
export const enter = (model: Model): Update.Return<Model, Message, StyldClient> => ({
  model,
  commands: [LoadProfile()],
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient>

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
    SucceededLoadProfile: ({ profile }) => ({
      model: modifyFields(model, { profile: () => ProfileState.Loaded({ profile }) }),
    }),
    FailedLoadProfile: () =>
      ProfileState.guards.Loaded(model.profile)
        ? { model }
        : { model: modifyFields(model, { profile: () => ProfileState.Failed() }) },
  })
