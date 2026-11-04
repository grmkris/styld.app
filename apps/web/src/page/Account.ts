import * as SecureRandom from 'effect/crypto/SecureRandom'
import { drawOperationId } from '../OperationIds.ts'
import { CreditBalance, Plan, Profile } from '@styld/protocol'
import { Effect, Option, Result, Schema } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { load } from 'foldkit/navigation'
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

/** Today's credits as last read; a failed read keeps the ones shown. */
export const CreditsData = AsyncData.Schema(CreditBalance, Schema.Literal('Unavailable'))
export type CreditsData = typeof CreditsData.schema.Type

/** Opening a plan's checkout or the customer portal: the request, then the browser leaves for Dodo's page. */
export const Checkout = defineTaggedUnion({
  Idle: {},
  Opening: { plan: Plan },
  OpeningPortal: {},
  Failed: {},
  PortalFailed: {},
})

/** Back from Dodo's checkout (`/account?premium=1`), the plan comes from Dodo's webhook a moment later: the credits are
 * read again a few times until it shows. */
export const Arrival = defineTaggedUnion({ Plain: {}, Paid: { readsLeft: Schema.Int } })

/** How many times the credits are read again after a payment, three seconds apart. */
export const paidReads = 8

export const Model = Schema.Struct({
  credits: CreditsData.schema,
  checkout: Checkout,
  arrival: Arrival,
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
  credits: AsyncData.Loading(),
  checkout: Checkout.Idle(),
  arrival: Arrival.Plain(),
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
  SucceededReadCredits: { credits: CreditBalance },
  FailedReadCredits: {},
  ClickedRetryCredits: {},
  ClickedChoosePlan: { plan: Plan },
  FailedOpenCheckout: {},
  ClickedManageSubscription: {},
  FailedOpenPortal: {},
  LeftForCheckout: {},
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

const readCredits = Effect.gen(function* () {
  const api = yield* (yield* StyldClient).api
  return Message.SucceededReadCredits({ credits: yield* api.billing.credits() })
}).pipe(Effect.orElseSucceed(() => Message.FailedReadCredits()))

export const ReadCredits = Command.define('ReadCredits', {
  messages: [Message.SucceededReadCredits, Message.FailedReadCredits],
  execute: readCredits,
})

/** The credits again, a moment later: a payment's week arrives with Dodo's webhook, not with the person's return. */
export const ReadCreditsSoon = Command.define('ReadCreditsSoon', {
  messages: [Message.SucceededReadCredits, Message.FailedReadCredits],
  execute: Effect.andThen(Effect.sleep('3 seconds'), readCredits),
})

/** Dodo's hosted checkout for a plan: a top-level navigation, which the page's CSP allows (a form post to Dodo it
 * would not). */
export const OpenCheckout = Command.define('OpenCheckout', {
  args: { plan: Plan },
  messages: [Message.LeftForCheckout, Message.FailedOpenCheckout],
  execute: ({ plan }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const { url } = yield* api.billing.checkout({ payload: { operationId: yield* drawOperationId(), plan } })
      yield* load(url)
      return Message.LeftForCheckout()
    }).pipe(Effect.orElseSucceed(() => Message.FailedOpenCheckout())),
})

/** Dodo's customer portal, where a subscription is cancelled and receipts are read. */
export const OpenPortal = Command.define('OpenPortal', {
  messages: [Message.LeftForCheckout, Message.FailedOpenPortal],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { url } = yield* api.billing.portal({ payload: { operationId: yield* drawOperationId() } })
    yield* load(url)
    return Message.LeftForCheckout()
  }).pipe(Effect.orElseSucceed(() => Message.FailedOpenPortal())),
})

const showMeFold = ShowMe.heldBy<Model, Message>((message) => Message.GotShowMeMessage({ message }))
const tasteFold = Taste.heldBy<Model, Message>((message) => Message.GotTasteMessage({ message }))

/** Opening the page: the profile, the credits, Show me and what Styld knows as they are now; what is already shown stays while it is
 * read again. `paid`: back from Dodo's checkout. */
export const enter =
  (paid: boolean) =>
  (model: Model): Update.Return<Model, Message, StyldClient> =>
    Update.combine<Model, Message, StyldClient>(model, [
      (current) => ({
        model: modifyFields(current, {
          arrival: () => (paid ? Arrival.Paid({ readsLeft: paidReads }) : Arrival.Plain()),
        }),
        commands: [ReadProfile(), ReadCredits()],
      }),
      Update.foldChildStep({ update: ShowMe.enter, ...showMeFold }),
      Update.foldChildStep({ update: Taste.enter, ...tasteFold }),
    ])

/** Read credits: after a payment, read again until the plan shows or the reads run out. */
const readCreditsAgain = (model: Model, credits: CreditBalance): UpdateReturn =>
  Arrival.match(model.arrival, {
    Plain: () => ({ model }),
    Paid: ({ readsLeft }) =>
      credits.membership === null && readsLeft > 0
        ? {
            model: modifyFields(model, { arrival: () => Arrival.Paid({ readsLeft: readsLeft - 1 }) }),
            commands: [ReadCreditsSoon()],
          }
        : { model },
  })

// UPDATE

/** Whether Dodo's checkout or portal is already being opened: one at a time. */
const opening = (model: Model) =>
  Checkout.guards.Opening(model.checkout) || Checkout.guards.OpeningPortal(model.checkout)

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
    SucceededReadCredits: ({ credits }) =>
      readCreditsAgain(modifyFields(model, { credits: () => CreditsData.Success({ data: credits }) }), credits),
    FailedReadCredits: () => ({
      model: modifyFields(model, {
        credits: (credits) => AsyncData.settle(credits, Result.fail('Unavailable' as const)),
      }),
    }),
    ClickedRetryCredits: () =>
      Option.match(AsyncData.revalidateOrLoad(model.credits), {
        onNone: () => ({ model }),
        onSome: (credits) => ({ model: modifyFields(model, { credits: () => credits }), commands: [ReadCredits()] }),
      }),
    ClickedChoosePlan: ({ plan }) =>
      opening(model)
        ? { model }
        : {
            model: modifyFields(model, { checkout: () => Checkout.Opening({ plan }) }),
            commands: [OpenCheckout({ plan })],
          },
    ClickedManageSubscription: () =>
      opening(model)
        ? { model }
        : { model: modifyFields(model, { checkout: () => Checkout.OpeningPortal() }), commands: [OpenPortal()] },
    // The browser is on its way to Dodo; the button stays busy until the page goes.
    LeftForCheckout: () => ({ model }),
    FailedOpenCheckout: () => ({ model: modifyFields(model, { checkout: () => Checkout.Failed() }) }),
    FailedOpenPortal: () => ({ model: modifyFields(model, { checkout: () => Checkout.PortalFailed() }) }),
  })
