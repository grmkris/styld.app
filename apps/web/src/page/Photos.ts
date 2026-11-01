import { newOperationId } from '../OperationIds.ts'
import { Photo } from '@styld/protocol'
import { Duration, Effect, Option, Predicate, Result, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { AsyncData, Command, File, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { type PictureEncoder, uploadPicture } from '../Upload.ts'
import { StyldClient } from '../StyldClient.ts'

// My Gallery (owner, 2026-10-31): the person's own outfit photos, newest first. Adding one sends it for a credit while
// Styld finds its garments; the page follows it until they are found.

// MODEL

export const PhotosData = AsyncData.Schema(Schema.Array(Photo), Schema.Literal('Unavailable'))
export type PhotosData = typeof PhotosData.schema.Type

/** A photo on its way: being sent, or refused (today's free credits spent, or anything else). */
export const Adding = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: { spent: Schema.Boolean } })
export type Adding = typeof Adding.Type

export const Model = Schema.Struct({ photos: PhotosData.schema, adding: Adding })
export type Model = typeof Model.Type

export const init = (): Model => ({ photos: AsyncData.Idle(), adding: Adding.Idle() })

// MESSAGE

export const Message = defineMessageUnion({
  SucceededListPhotos: { photos: Schema.Array(Photo) },
  FailedListPhotos: {},
  ClickedRetry: {},
  ChosePhoto: { files: Schema.Array(File.File) },
  SucceededAddPhoto: { photo: Photo },
  FailedAddPhoto: { spent: Schema.Boolean },
  ElapsedFindingPause: {},
})
export type Message = typeof Message.Type

// COMMAND

/** @internal Exported for its tests. */
export const ListPhotos = Command.define('ListPhotos', {
  messages: [Message.SucceededListPhotos, Message.FailedListPhotos],
  execute: Effect.gen(function* () {
    const { photos } = yield* (yield* (yield* StyldClient).api).photo.listPhotos()
    return Message.SucceededListPhotos({ photos })
  }).pipe(Effect.orElseSucceed(() => Message.FailedListPhotos())),
})

/** Send a picked photo, shrunk and without its metadata, then add it for a credit.
 * @internal Exported for its tests. */
export const AddPhoto = Command.define('AddPhoto', {
  args: { file: File.File },
  messages: [Message.SucceededAddPhoto, Message.FailedAddPhoto],
  execute: ({ file }) =>
    Effect.gen(function* () {
      const uploadId = yield* uploadPicture(file)
      const operationId = yield* newOperationId
      const api = yield* (yield* StyldClient).api
      const photo = yield* api.photo.addPhoto({ payload: { operationId, uploadId } })
      return Message.SucceededAddPhoto({ photo })
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedAddPhoto({ spent: Predicate.isTagged(error, 'LimitReached') })),
      ),
    ),
})

/** A pause before asking again whether a photo's garments are found. */
export const findingPause = Effect.sleep(Duration.seconds(2))

/** @internal Exported for its tests. */
export const WaitWhileFinding = Command.define('WaitWhileFinding', {
  messages: [Message.ElapsedFindingPause],
  execute: findingPause.pipe(Effect.as(Message.ElapsedFindingPause())),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient | Crypto.Crypto | PictureEncoder>

const isFinding = (photos: ReadonlyArray<Photo>) => photos.some(({ status }) => status === 'finding')

/** Opening the page: the photos already here stay while they are asked for again; a first visit asks. */
export const revisit = Update.refresh<Model, Message, ReadonlyArray<Photo>, 'Unavailable', StyldClient>({
  read: (model: Model) => Option.some(model.photos),
  revalidate: AsyncData.revalidateOrLoad,
  write: (model: Model, photos: PhotosData) => modifyFields(model, { photos: () => photos }),
  load: ListPhotos(),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededListPhotos: ({ photos }) => ({
      model: modifyFields(model, { photos: () => PhotosData.Success({ data: photos }) }),
      commands: isFinding(photos) ? [WaitWhileFinding()] : [],
    }),
    FailedListPhotos: () => ({
      model: modifyFields(model, { photos: (photos) => AsyncData.settle(photos, Result.fail('Unavailable' as const)) }),
    }),
    ClickedRetry: () => revisit(model),
    ChosePhoto: ({ files }) => {
      const [file] = files
      if (file === undefined || Adding.guards.Sending(model.adding)) return { model }
      return { model: modifyFields(model, { adding: () => Adding.Sending() }), commands: [AddPhoto({ file })] }
    },
    SucceededAddPhoto: ({ photo }) => ({
      model: modifyFields(model, {
        adding: () => Adding.Idle(),
        photos: (photos) =>
          PhotosData.Success({
            data: [photo, ...Option.getOrElse(AsyncData.getData(photos), (): ReadonlyArray<Photo> => [])],
          }),
      }),
      commands: [WaitWhileFinding()],
    }),
    FailedAddPhoto: ({ spent }) => ({ model: modifyFields(model, { adding: () => Adding.Failed({ spent }) }) }),
    ElapsedFindingPause: () => ({ model, commands: [ListPhotos()] }),
  })
