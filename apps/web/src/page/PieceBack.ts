import { OperationId, Piece, PieceId } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { Command, File, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { uploadPicture } from '../PictureUpload.ts'
import { StyldClient } from '../StyldClient.ts'

// A piece's back on its page (owner, 2026-10-31): Front and Back under the picture once it has one, and adding,
// replacing or removing it. A picked photo is cut out on the server like the front, for a photo's credit.

// MODEL

const Side = Schema.Literals(['front', 'back'])
type Side = typeof Side.Type

export const Model = Schema.Struct({
  pieceId: Schema.String,
  /** Which side the picture shows, once the piece has a back. */
  side: Side,
  /** A back on its way, or one that did not go through. */
  work: Schema.Literals(['idle', 'sending', 'failed']),
})
export type Model = typeof Model.Type

export const init = (pieceId: string): Model => ({ pieceId, side: 'front', work: 'idle' })

// MESSAGE

export const Message = defineMessageUnion({
  ClickedSide: { side: Side },
  ChoseBack: { files: Schema.Array(File.File) },
  ClickedRemoveBack: {},
  SucceededBack: { piece: Piece },
  FailedBack: {},
})
export type Message = typeof Message.Type

/** The piece changed: its page shows it as it is now. */
export const OutMessage = defineMessageUnion({ ChangedPiece: { piece: Piece } })
export type OutMessage = typeof OutMessage.Type

// COMMAND

const pieceIdOf = (pieceId: string) => Schema.decodeUnknownEffect(PieceId)(pieceId)

/** Send a photo of the piece's back: it is uploaded, then cut out on the server.
 * @internal Exported for its tests. */
export const SetBack = Command.define('SetBack', {
  args: { pieceId: Schema.String, file: File.File },
  messages: [Message.SucceededBack, Message.FailedBack],
  execute: ({ pieceId, file }) =>
    Effect.gen(function* () {
      const uploadId = yield* uploadPicture(file)
      const api = yield* (yield* StyldClient).api
      const operationId = yield* Schema.decodeUnknownEffect(OperationId)(yield* (yield* Crypto.Crypto).randomUUIDv4())
      const piece = yield* api.wardrobe.setBack({
        params: { pieceId: yield* pieceIdOf(pieceId) },
        payload: { operationId, uploadId },
      })
      return Message.SucceededBack({ piece })
    }).pipe(Effect.orElseSucceed(() => Message.FailedBack())),
})

/** Forget the piece's back.
 * @internal Exported for its tests. */
export const RemoveBack = Command.define('RemoveBack', {
  args: { pieceId: Schema.String },
  messages: [Message.SucceededBack, Message.FailedBack],
  execute: ({ pieceId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const piece = yield* api.wardrobe.removeBack({ params: { pieceId: yield* pieceIdOf(pieceId) } })
      return Message.SucceededBack({ piece })
    }).pipe(Effect.orElseSucceed(() => Message.FailedBack())),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | Crypto.Crypto>

const sending = (model: Model, command: Command.Command<Message, never, StyldClient | Crypto.Crypto>) =>
  model.work === 'sending'
    ? { model }
    : { model: modifyFields(model, { work: () => 'sending' as const }), commands: [command] }

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedSide: ({ side }) => ({ model: modifyFields(model, { side: () => side }) }),
    ChoseBack: ({ files }) =>
      Option.match(Option.fromNullishOr(files[0]), {
        onNone: () => ({ model }),
        onSome: (file) => sending(model, SetBack({ pieceId: model.pieceId, file })),
      }),
    ClickedRemoveBack: () => sending(model, RemoveBack({ pieceId: model.pieceId })),
    // A new back is shown at once; without one, the front is.
    SucceededBack: ({ piece }) => ({
      model: modifyFields(model, { work: () => 'idle' as const, side: () => (piece.hasBack ? 'back' : 'front') }),
      outMessage: OutMessage.ChangedPiece({ piece }),
    }),
    FailedBack: () => ({ model: modifyFields(model, { work: () => 'failed' as const }) }),
  })
