import type * as SecureRandom from 'effect/crypto/SecureRandom'
import { Audience, Preferences } from '@styld/protocol'
import { Effect, Option, Result, Schema } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { drawOperationId } from '../OperationIds.ts'
import { StyldClient } from '../StyldClient.ts'

// Show me (owner, 4 November 2026): what What's new starts with, Women's, Men's or Everything. Home asks once after
// sign-in, above What's new, until the person answers or puts the card away; the Account page keeps the choice. It
// only reorders: nothing is hidden.

// MODEL

export const PreferencesData = AsyncData.Schema(Preferences, Schema.Literal('Unavailable'))
export type PreferencesData = typeof PreferencesData.schema.Type

/** An answer: none on its way, one on its way, a choice that did not save, or Home's card put away though that did
 * not save (it asks again next time). Saving `null` puts the card away with nothing chosen. */
export const Answer = defineTaggedUnion({
  Idle: {},
  Saving: { showMe: Schema.NullOr(Audience) },
  Failed: { showMe: Audience },
  PutAway: {},
})
export type Answer = typeof Answer.Type

export const Model = Schema.Struct({ preferences: PreferencesData.schema, answer: Answer })
export type Model = typeof Model.Type

export const init = (): Model => ({ preferences: AsyncData.Idle(), answer: Answer.Idle() })

/** The choices, in the order they show. */
export const choices: ReadonlyArray<Audience> = ['women', 'men', 'all']

/** What What's new starts with under a choice: none chosen ranks everything alike, as Everything does. */
const orderOf = (showMe: Audience | null): Audience => showMe ?? 'all'

/** The choice shown as chosen: the one on its way, else the one saved. */
export const shownChoice = (model: Model): Option.Option<Audience> =>
  Answer.guards.Saving(model.answer) && model.answer.showMe !== null
    ? Option.some(model.answer.showMe)
    : Option.map(AsyncData.getData(model.preferences), ({ showMe }) => orderOf(showMe))

/** Whether the person just put Home's card away. */
const putAway = (answer: Answer) =>
  Answer.guards.PutAway(answer) || (Answer.guards.Saving(answer) && answer.showMe === null)

/** Whether Home's card asks: the person has not answered or put it away. */
export const asks = (model: Model): boolean =>
  Option.exists(AsyncData.getData(model.preferences), ({ showMeAsked }) => !showMeAsked) && !putAway(model.answer)

// MESSAGE

export const Message = defineMessageUnion({
  SucceededReadPreferences: { preferences: Preferences },
  FailedReadPreferences: {},
  ClickedRetry: {},
  ClickedChoice: { showMe: Audience },
  ClickedNotNow: {},
  SucceededSaveShowMe: { preferences: Preferences },
  FailedSaveShowMe: {},
})
export type Message = typeof Message.Type

/** The order of What's new changed, so it is read again. */
export const OutMessage = defineMessageUnion({ ChangedShowMe: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

export const ReadPreferences = Command.define('ReadPreferences', {
  messages: [Message.SucceededReadPreferences, Message.FailedReadPreferences],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return Message.SucceededReadPreferences({ preferences: yield* api.preferences.getPreferences() })
  }).pipe(Effect.orElseSucceed(() => Message.FailedReadPreferences())),
})

export const SaveShowMe = Command.define('SaveShowMe', {
  args: { showMe: Schema.NullOr(Audience) },
  messages: [Message.SucceededSaveShowMe, Message.FailedSaveShowMe],
  execute: ({ showMe }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const preferences = yield* api.preferences.setShowMe({
        payload: { operationId: yield* drawOperationId(), showMe },
      })
      return Message.SucceededSaveShowMe({ preferences })
    }).pipe(Effect.orElseSucceed(() => Message.FailedSaveShowMe())),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | SecureRandom.SecureRandom>

const unavailable = Result.fail('Unavailable' as const)

/** How Home and the Account page hold Show me: in their `showMe`, its Messages wrapped in theirs. */
export const heldBy = <Parent extends { readonly showMe: Model }, ParentMessage>(
  toParentMessage: (message: Message) => ParentMessage,
) => ({
  read: (parent: Parent) => Option.some(parent.showMe),
  write: (parent: Parent, showMe: Model): Parent => ({ ...parent, showMe }),
  toParentMessage,
})

/** Opening Home or the Account page: the choice as saved, kept on screen while it is read again. */
export const enter = (model: Model): Update.Return<Model, Message, StyldClient> =>
  Update.refresh<Model, Message, Preferences, 'Unavailable', StyldClient>({
    read: (current: Model) => Option.some(current.preferences),
    revalidate: AsyncData.revalidateOrLoad,
    write: (current: Model, preferences: PreferencesData) => modifyFields(current, { preferences: () => preferences }),
    load: ReadPreferences(),
  })(model)

/** Save an answer, unless one is on its way. */
const answer = (model: Model, showMe: Audience | null): UpdateReturn =>
  Answer.guards.Saving(model.answer)
    ? { model }
    : { model: modifyFields(model, { answer: () => Answer.Saving({ showMe }) }), commands: [SaveShowMe({ showMe })] }

/** A saved answer: What's new is read again when its order changed. */
const saved = (model: Model, preferences: Preferences): UpdateReturn => {
  const before = Option.map(AsyncData.getData(model.preferences), ({ showMe }) => orderOf(showMe))
  const next = modifyFields(model, {
    preferences: () => PreferencesData.Success({ data: preferences }),
    answer: () => Answer.Idle(),
  })
  return Option.contains(before, orderOf(preferences.showMe))
    ? { model: next }
    : { model: next, outMessage: OutMessage.ChangedShowMe() }
}

/** What an answer that did not save leaves. */
const failedAnswer = (current: Answer): Answer => {
  if (!Answer.guards.Saving(current)) return current
  return current.showMe === null ? Answer.PutAway() : Answer.Failed({ showMe: current.showMe })
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededReadPreferences: ({ preferences }) => ({
      model: modifyFields(model, { preferences: () => PreferencesData.Success({ data: preferences }) }),
    }),
    // A failed read keeps the choice already shown; Home's card stays away.
    FailedReadPreferences: () => ({
      model: modifyFields(model, { preferences: (preferences) => AsyncData.settle(preferences, unavailable) }),
    }),
    ClickedRetry: () =>
      Option.match(AsyncData.revalidateOrLoad(model.preferences), {
        onNone: () => ({ model }),
        onSome: (preferences) => ({
          model: modifyFields(model, { preferences: () => preferences }),
          commands: [ReadPreferences()],
        }),
      }),
    ClickedChoice: ({ showMe }) => answer(model, showMe),
    ClickedNotNow: () => answer(model, null),
    SucceededSaveShowMe: ({ preferences }) => saved(model, preferences),
    // "Not now" that did not save puts the card away all the same; Home asks again next time.
    FailedSaveShowMe: () => ({ model: modifyFields(model, { answer: failedAnswer }) }),
  })
