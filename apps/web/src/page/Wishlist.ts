import { Wish, WishId } from '@styld/protocol'
import { Effect, Option, Result, Schema } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// The wishlist: pieces the person wants one like, a tab of the wardrobe beside Pieces and Looks.

// MODEL

export const WishesData = AsyncData.Schema(Schema.Array(Wish), Schema.Literal('Unavailable'))
export type WishesData = typeof WishesData.schema.Type

export const Model = Schema.Struct({ wishes: WishesData.schema })
export type Model = typeof Model.Type

export const init = (): Model => ({ wishes: AsyncData.Idle() })

// MESSAGE

export const Message = defineMessageUnion({
  SucceededListWishes: { wishes: Schema.Array(Wish) },
  FailedListWishes: {},
  ClickedRetry: {},
  ClickedRemove: { wishId: WishId },
  CompletedRemoveWish: {},
})
export type Message = typeof Message.Type

// COMMAND

/** @internal Exported for its tests. */
export const ListWishes = Command.define('ListWishes', {
  messages: [Message.SucceededListWishes, Message.FailedListWishes],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return Message.SucceededListWishes({ wishes: (yield* api.social.listWishes()).wishes })
  }).pipe(Effect.orElseSucceed(() => Message.FailedListWishes())),
})

/** Take a wish off the list; the list was already updated, and a failure brings it back on the next visit.
 * @internal Exported for its tests. */
export const RemoveWish = Command.define('RemoveWish', {
  args: { wishId: WishId },
  messages: [Message.CompletedRemoveWish],
  execute: ({ wishId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      yield* api.social.removeWish({ params: { wishId } })
    }).pipe(Effect.ignore, Effect.as(Message.CompletedRemoveWish())),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

/** Opening the tab: the wishes already here stay while they are asked for again; a first visit asks. */
export const revisit = Update.refresh<Model, Message, ReadonlyArray<Wish>, 'Unavailable', StyldClient>({
  read: (model: Model) => Option.some(model.wishes),
  revalidate: AsyncData.revalidateOrLoad,
  write: (model: Model, wishes: WishesData) => modifyFields(model, { wishes: () => wishes }),
  load: ListWishes(),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededListWishes: ({ wishes }) => ({
      model: modifyFields(model, { wishes: () => WishesData.Success({ data: wishes }) }),
    }),
    FailedListWishes: () => ({
      model: modifyFields(model, { wishes: (wishes) => AsyncData.settle(wishes, Result.fail('Unavailable' as const)) }),
    }),
    ClickedRetry: () => revisit(model),
    ClickedRemove: ({ wishId }) => ({
      model: modifyFields(model, {
        wishes: (wishes) => AsyncData.map(wishes, (list) => list.filter(({ id }) => id !== wishId)),
      }),
      commands: [RemoveWish({ wishId })],
    }),
    CompletedRemoveWish: () => ({ model }),
  })
