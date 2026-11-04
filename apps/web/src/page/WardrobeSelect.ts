import { OperationId, PieceId, piecesAtOnce } from '@styld/protocol'
import { Array, Effect, Option, Schema } from 'effect'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { Deletion } from '../Confirm.ts'
import { drawOperationId } from '../OperationIds.ts'
import { StyldClient } from '../StyldClient.ts'

// Deleting from the wardrobe's grid (Eva, 4 November; owner: a Select mode, one confirmation, no undo): Select turns
// the type's pieces into ticks, the bar says how many will go, and one question in the page sends them all.

// MODEL

/** Select mode: off, or on with the pieces ticked, in the order ticked, and where their deletion stands. A delete whose
 * answer was lost keeps its operation id, so trying again asks the server for the same delete. */
export const Model = defineTaggedUnion({
  Off: {},
  On: { pieceIds: Schema.Array(PieceId), deletion: Deletion, maybeOperationId: Schema.Option(OperationId) },
})
export type Model = typeof Model.Type

export const init = (): Model => Model.Off()

const ticking = (pieceIds: ReadonlyArray<PieceId>): Model =>
  Model.On({ pieceIds, deletion: Deletion.Idle(), maybeOperationId: Option.none() })

// MESSAGE

export const Message = defineMessageUnion({
  ClickedSelect: {},
  ClickedDone: {},
  ToggledPiece: { pieceId: PieceId },
  ClickedDelete: {},
  ClickedCancelDelete: {},
  ClickedConfirmDelete: {},
  SucceededDeletePieces: {},
  FailedDeletePieces: { maybeOperationId: Schema.Option(OperationId) },
})
export type Message = typeof Message.Type

/** The pieces went: the app reads them again, and their cards leave the grid. */
export const OutMessage = defineMessageUnion({ DeletedPieces: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** Delete the ticked pieces under a new operation id, or the one a lost answer had. */
export const DeletePieces = Command.define('DeletePieces', {
  args: { pieceIds: Schema.Array(PieceId), maybeOperationId: Schema.Option(OperationId) },
  messages: [Message.SucceededDeletePieces, Message.FailedDeletePieces],
  execute: ({ pieceIds, maybeOperationId }) =>
    Effect.gen(function* () {
      const operationId = yield* drawOperationId(maybeOperationId)
      const sent = Effect.gen(function* () {
        const api = yield* (yield* StyldClient).api
        yield* api.wardrobe.deletePieces({ payload: { operationId, pieceIds } })
        return Message.SucceededDeletePieces()
      })
      return yield* sent.pipe(
        // Refused as sent (a piece that is not the person's, or the id reused): a new try draws a new id.
        Effect.catchTags({
          NotFound: () => Effect.succeed(Message.FailedDeletePieces({ maybeOperationId: Option.none() })),
          OperationConflict: () => Effect.succeed(Message.FailedDeletePieces({ maybeOperationId: Option.none() })),
        }),
        Effect.orElseSucceed(() => Message.FailedDeletePieces({ maybeOperationId: Option.some(operationId) })),
      )
    }),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | SecureRandom.SecureRandom>

/** Ticking a piece, or unticking it; a delete on its way changes nothing, and a change of ticks asks again, under a
 * new operation id, since it is another delete. At most as many as one delete takes are ticked. */
const toggled = (model: Model, pieceId: PieceId): UpdateReturn =>
  Model.match(model, {
    Off: () => ({ model }),
    On: ({ pieceIds, deletion }) => {
      if (Deletion.guards.Deleting(deletion)) return { model }
      if (pieceIds.includes(pieceId)) return { model: ticking(Array.filter(pieceIds, (id) => id !== pieceId)) }
      return { model: pieceIds.length >= piecesAtOnce ? model : ticking([...pieceIds, pieceId]) }
    },
  })

type On = Extract<Model, { readonly _tag: 'On' }>

/** The same ticks, with the deletion at another step. */
const at = (selection: On, deletion: Deletion, maybeOperationId = selection.maybeOperationId): Model =>
  Model.On({ pieceIds: selection.pieceIds, deletion, maybeOperationId })

/** The question again, the delete, or nothing, from where the deletion stands. */
const deletion = (model: Model, next: (selection: On) => UpdateReturn) =>
  Model.guards.On(model) && model.pieceIds.length > 0 ? next(model) : { model }

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedSelect: () => ({ model: Model.guards.On(model) ? model : ticking([]) }),
    ClickedDone: () =>
      Model.guards.On(model) && Deletion.guards.Deleting(model.deletion) ? { model } : { model: Model.Off() },
    ToggledPiece: ({ pieceId }) => toggled(model, pieceId),
    ClickedDelete: () =>
      deletion(model, (selection) =>
        Deletion.guards.Idle(selection.deletion) ? { model: at(selection, Deletion.Confirming()) } : { model },
      ),
    ClickedCancelDelete: () =>
      deletion(model, (selection) =>
        Deletion.guards.Deleting(selection.deletion) ? { model } : { model: at(selection, Deletion.Idle()) },
      ),
    // Confirmed, or tried again after a failure under the id the failed try drew.
    ClickedConfirmDelete: () =>
      deletion(model, (selection) =>
        Deletion.guards.Confirming(selection.deletion) || Deletion.guards.Failed(selection.deletion)
          ? {
              model: at(selection, Deletion.Deleting()),
              commands: [DeletePieces({ pieceIds: selection.pieceIds, maybeOperationId: selection.maybeOperationId })],
            }
          : { model },
      ),
    SucceededDeletePieces: () => ({ model: Model.Off(), outMessage: OutMessage.DeletedPieces() }),
    FailedDeletePieces: ({ maybeOperationId }) =>
      Model.guards.On(model) ? { model: at(model, Deletion.Failed(), maybeOperationId) } : { model },
  })
