import { type Chat, TryOn, TryOnId } from '@styld/protocol'
import { Array, Effect, Number, Option, Predicate, Record, Schema } from 'effect'
import { Command, Subscription, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { Misses, pollWhilePending } from '../Polling.ts'
import { StyldClient } from '../StyldClient.ts'

// The try-ons Styld started or read in a chat (owner, 4 November 2026). A reply carries only a try-on's id; its
// picture is read here, with the person's own session, and read again while it is being drawn. Styld never sees it.

// MODEL

export const Model = Schema.Struct({
  /** Each try-on as last read, by id. */
  tryOns: Schema.Record(Schema.String, TryOn),
  misses: Misses,
})
export type Model = typeof Model.Type

export const init = (): Model => ({ tryOns: {}, misses: 0 })

/** Whether a try-on is still being drawn. */
export const isMaking = (tryOn: TryOn) => tryOn.status === 'admitting' || tryOn.status === 'drawing'

/** The try-on a chat card shows, once it is read. */
export const tryOnOf = (model: Model, tryOnId: string): Option.Option<TryOn> => Record.get(model.tryOns, tryOnId)

// MESSAGE

export const Message = defineMessageUnion({
  SucceededReadTryOn: { tryOn: TryOn },
  FailedReadTryOn: {},
  TickedTryOnsRefresh: {},
})
export type Message = typeof Message.Type

// COMMAND

export const ReadTryOn = Command.define('ReadTryOn', {
  args: { tryOnId: TryOnId },
  messages: [Message.SucceededReadTryOn, Message.FailedReadTryOn],
  execute: ({ tryOnId }) =>
    Effect.gen(function* () {
      const tryOn = yield* (yield* (yield* StyldClient).api).tryOn.getTryOn({ params: { tryOnId } })
      return Message.SucceededReadTryOn({ tryOn })
    }).pipe(Effect.orElseSucceed(() => Message.FailedReadTryOn())),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

/** The try-ons a chat's replies name, in order, each once. */
const tryOnIdsOf = (chat: Chat): ReadonlyArray<TryOnId> =>
  Array.dedupe(
    [...chat.messages.flatMap(({ parts }) => parts), ...(chat.replying?.parts ?? [])].flatMap((part) =>
      Predicate.isTagged(part, 'TryOn') ? [part.tryOnId] : [],
    ),
  )

/** A chat shown: the try-ons it names that are not read yet are read. */
export const follow = (model: Model, chat: Chat): UpdateReturn => ({
  model,
  commands: Array.filter(tryOnIdsOf(chat), (tryOnId) => !Record.has(model.tryOns, tryOnId)).map((tryOnId) =>
    ReadTryOn({ tryOnId }),
  ),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededReadTryOn: ({ tryOn }) => ({
      model: modifyFields(model, { tryOns: Record.set(tryOn.id, tryOn), misses: () => 0 }),
    }),
    FailedReadTryOn: () => ({ model: modifyFields(model, { misses: Number.increment }) }),
    TickedTryOnsRefresh: () => ({
      model,
      commands: Array.filter(Record.values(model.tryOns), isMaking).map(({ id }) => ReadTryOn({ tryOnId: id })),
    }),
  })

// SUBSCRIPTION

/** The chat's try-ons are read again while one is being drawn. */
export const subscriptions = Subscription.make<Model, Message>()(() => ({
  chatTryOnsWhileMaking: pollWhilePending<Model, Message>({
    pendingIds: (model) => Array.map(Array.filter(Record.values(model.tryOns), isMaking), ({ id }) => id),
    misses: (model) => model.misses,
    tick: Message.TickedTryOnsRefresh(),
  }),
}))
