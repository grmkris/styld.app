import { Look, PieceId } from '@styld/protocol'
import { Effect, Result, Schema } from 'effect'
import { AsyncData, Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// A piece's "In your looks" (browser review, 2 November 2026): the saved looks it is in, each opening its look.

// MODEL

const LooksData = AsyncData.Schema(Schema.Array(Look), Schema.Literal('Unavailable'))

export const Model = Schema.Struct({ looks: LooksData.schema })
export type Model = typeof Model.Type

export const init = (): Model => ({ looks: AsyncData.Loading() })

// MESSAGE

export const Message = defineMessageUnion({
  SucceededListLooks: { looks: Schema.Array(Look) },
  FailedListLooks: {},
})
export type Message = typeof Message.Type

// COMMAND

export const ListPieceLooks = Command.define('ListPieceLooks', {
  args: { pieceId: Schema.String },
  messages: [Message.SucceededListLooks, Message.FailedListLooks],
  execute: ({ pieceId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const params = { pieceId: yield* Schema.decodeUnknownEffect(PieceId)(pieceId) }
      return Message.SucceededListLooks({ looks: (yield* api.look.pieceLooks({ params })).looks })
    }).pipe(Effect.orElseSucceed(() => Message.FailedListLooks())),
})

/** What opening the piece asks for here: the looks it is in. */
export const load = (pieceId: string) => [ListPieceLooks({ pieceId })]

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    SucceededListLooks: ({ looks }) => ({
      model: modifyFields(model, { looks: () => LooksData.Success({ data: looks }) }),
    }),
    FailedListLooks: () => ({
      model: modifyFields(model, { looks: (looks) => AsyncData.settle(looks, Result.fail('Unavailable' as const)) }),
    }),
  })
