import type * as SecureRandom from 'effect/crypto/SecureRandom'
import { BoardId, OperationId, TriedBoard } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { drawOperationId } from '../../OperationIds.ts'
import { StyldClient } from '../../StyldClient.ts'

// Try with my wardrobe (owner, 4 November 2026): on a public board that shows generated pieces, a new private board of
// the person's own pieces where the generated ones lay, and how many of them came from their wardrobe.

// MODEL

/** Not tried yet, on its way, tried (the new board and its count), or failed, with the id a retry sends again so a
 * lost answer never makes a second board. */
export const Model = defineTaggedUnion({
  Idle: {},
  Trying: {},
  Tried: { tried: TriedBoard },
  Failed: { operationId: OperationId },
})
export type Model = typeof Model.Type

export const init = (): Model => Model.Idle()

// MESSAGE

export const Message = defineMessageUnion({
  ClickedTry: { boardId: BoardId },
  SucceededTry: { tried: TriedBoard },
  FailedTry: { operationId: OperationId },
})
export type Message = typeof Message.Type

// COMMAND

export const TryIt = Command.define('TryIt', {
  args: { boardId: BoardId, maybeOperationId: Schema.Option(OperationId) },
  messages: [Message.SucceededTry, Message.FailedTry],
  execute: ({ boardId, maybeOperationId }) =>
    Effect.gen(function* () {
      const operationId = yield* drawOperationId(maybeOperationId)
      return yield* Effect.gen(function* () {
        const api = yield* (yield* StyldClient).api
        const tried = yield* api.tryBoard.tryBoard({ params: { boardId }, payload: { operationId } })
        return Message.SucceededTry({ tried })
      }).pipe(Effect.orElseSucceed(() => Message.FailedTry({ operationId })))
    }),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient | SecureRandom.SecureRandom>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedTry: ({ boardId }) =>
      Model.guards.Trying(model)
        ? { model }
        : {
            model: Model.Trying(),
            commands: [
              TryIt({
                boardId,
                maybeOperationId: Model.guards.Failed(model) ? Option.some(model.operationId) : Option.none(),
              }),
            ],
          },
    SucceededTry: ({ tried }) => ({ model: Model.Tried({ tried }) }),
    FailedTry: ({ operationId }) => ({ model: Model.Failed({ operationId }) }),
  })
