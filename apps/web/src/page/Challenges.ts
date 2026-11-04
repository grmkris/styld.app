import { Challenges } from '@styld/protocol'
import { Effect, Option, Result, Schema } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// Challenges on Home (Eva's sketch, owner 4 November 2026): each of her three opens the house board made for it once
// the house boards are seeded; until then, and if they cannot be read, the cards stay as they are, "coming soon".

export const ChallengesData = AsyncData.Schema(Challenges, Schema.Literal('Unavailable'))

export const Model = Schema.Struct({ challenges: ChallengesData.schema })
export type Model = typeof Model.Type

export const init = (): Model => ({ challenges: AsyncData.Idle() })

export const Message = defineMessageUnion({
  SucceededReadChallenges: { challenges: Challenges },
  FailedReadChallenges: {},
})
export type Message = typeof Message.Type

export const ReadChallenges = Command.define('ReadChallenges', {
  messages: [Message.SucceededReadChallenges, Message.FailedReadChallenges],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return Message.SucceededReadChallenges({ challenges: yield* api.public.challenges() })
  }).pipe(Effect.orElseSucceed(() => Message.FailedReadChallenges())),
})

/** Opening Home: the challenges' boards, kept on screen while they are read again. */
export const enter = (model: Model): Update.Return<Model, Message, StyldClient> =>
  Update.refresh<Model, Message, Challenges, 'Unavailable', StyldClient>({
    read: (current: Model) => Option.some(current.challenges),
    revalidate: AsyncData.revalidateOrLoad,
    write: (current: Model, challenges) => modifyFields(current, { challenges: () => challenges }),
    load: ReadChallenges(),
  })(model)

export const update = (model: Model, message: Message): Update.Return<Model, Message, StyldClient> =>
  Message.match<Update.Return<Model, Message, StyldClient>>(message, {
    SucceededReadChallenges: ({ challenges }) => ({
      model: modifyFields(model, { challenges: () => ChallengesData.Success({ data: challenges }) }),
    }),
    FailedReadChallenges: () => ({
      model: modifyFields(model, {
        challenges: (challenges) => AsyncData.settle(challenges, Result.fail('Unavailable' as const)),
      }),
    }),
  })

/** The board a challenge opens, when it has one. */
export const boardOf = (model: Model, challenge: string) =>
  Option.flatMap(AsyncData.getData(model.challenges), ({ challenges }) =>
    Option.fromNullishOr(challenges.find((each) => each.challenge === challenge)?.found.board.id),
  )
