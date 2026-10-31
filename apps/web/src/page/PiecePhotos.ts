import { Photo, PieceId } from '@styld/protocol'
import { Effect, Result, Schema } from 'effect'
import { AsyncData, Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// A piece's "In your photos" (owner, 2026-10-31): the outfit photos of My Gallery it is confirmed in.

// MODEL

const PhotosData = AsyncData.Schema(Schema.Array(Photo), Schema.Literal('Unavailable'))

export const Model = Schema.Struct({ photos: PhotosData.schema })
export type Model = typeof Model.Type

export const init = (): Model => ({ photos: AsyncData.Loading() })

// MESSAGE

export const Message = defineMessageUnion({
  SucceededListPhotos: { photos: Schema.Array(Photo) },
  FailedListPhotos: {},
})
export type Message = typeof Message.Type

// COMMAND

const ListPiecePhotos = Command.define('ListPiecePhotos', {
  args: { pieceId: Schema.String },
  messages: [Message.SucceededListPhotos, Message.FailedListPhotos],
  execute: ({ pieceId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const params = { pieceId: yield* Schema.decodeUnknownEffect(PieceId)(pieceId) }
      return Message.SucceededListPhotos({ photos: (yield* api.photos.piecePhotos({ params })).photos })
    }).pipe(Effect.orElseSucceed(() => Message.FailedListPhotos())),
})

/** What opening the piece asks for here: its photos. */
export const load = (pieceId: string) => [ListPiecePhotos({ pieceId })]

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match(message, {
    SucceededListPhotos: ({ photos }) => ({
      model: modifyFields(model, { photos: () => PhotosData.Success({ data: photos }) }),
    }),
    FailedListPhotos: () => ({
      model: modifyFields(model, { photos: (photos) => AsyncData.settle(photos, Result.fail('Unavailable' as const)) }),
    }),
  })
