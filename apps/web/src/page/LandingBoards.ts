import { Explore } from '@styld/protocol'
import { Effect, Option, Result, Schema } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// The public boards a signed-out Home shows under its words: Styld's edits, or the newest public boards before there
// are any. Read from the same public endpoint assistants use (`explore_get`); the website has no Explore page of its
// own since 4 November (owner: What's new on Home replaces it).

// MODEL

export const BoardsData = AsyncData.Schema(Explore, Schema.Literal('Unavailable'))
export type BoardsData = typeof BoardsData.schema.Type

export const Model = Schema.Struct({ boards: BoardsData.schema })
export type Model = typeof Model.Type

/** Loading from the start, so the server's page draws the boards' shapes rather than an empty section. */
export const init = (): Model => ({ boards: AsyncData.Loading() })

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadLanding: { explore: Explore },
  FailedLoadLanding: {},
})
export type Message = typeof Message.Type

// COMMAND

export const LoadLanding = Command.define('LoadLanding', {
  messages: [Message.SucceededLoadLanding, Message.FailedLoadLanding],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return Message.SucceededLoadLanding({ explore: yield* api.public.explore({ query: {} }) })
  }).pipe(Effect.orElseSucceed(() => Message.FailedLoadLanding())),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

const unavailable = Result.fail('Unavailable' as const)

/** The boards read again: what was shown stays while they are, and a read already on its way is not repeated. */
export const retry = (model: Model): UpdateReturn =>
  Option.match(AsyncData.revalidateOrLoad(model.boards), {
    onNone: () => ({ model }),
    onSome: (boards) => ({ model: modifyFields(model, { boards: () => boards }), commands: [LoadLanding()] }),
  })

/** Opening the landing: boards already shown are read again behind them; otherwise they are asked for (the page starts
 * loading, so the server's HTML holds their shapes). */
export const enter = (model: Model): UpdateReturn =>
  Option.isSome(AsyncData.getData(model.boards))
    ? retry(model)
    : { model: modifyFields(model, { boards: () => AsyncData.Loading() }), commands: [LoadLanding()] }

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadLanding: ({ explore }) => ({
      model: modifyFields(model, { boards: () => BoardsData.Success({ data: explore }) }),
    }),
    FailedLoadLanding: () => ({
      model: modifyFields(model, { boards: (boards) => AsyncData.settle(boards, unavailable) }),
    }),
  })
