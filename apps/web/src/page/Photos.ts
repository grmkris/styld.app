import { drawOperationId } from '../OperationIds.ts'
import { Photo, PhotoId } from '@styld/protocol'
import { Array, Effect, Number, Option, Predicate, Result, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { AsyncData, Command, File, Subscription, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { Misses, pollWhilePending } from '../Polling.ts'
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

export const Model = Schema.Struct({
  photos: PhotosData.schema,
  adding: Adding,
  /** Photos added on this page that a list read before they were made does not have yet. */
  added: Schema.Array(Photo),
  misses: Misses,
})
export type Model = typeof Model.Type

export const init = (): Model => ({ photos: AsyncData.Idle(), adding: Adding.Idle(), added: [], misses: 0 })

// MESSAGE

export const Message = defineMessageUnion({
  SucceededListPhotos: { photos: Schema.Array(Photo) },
  FailedListPhotos: {},
  ClickedRetry: {},
  ChosePhoto: { files: Schema.Array(File.File) },
  SucceededAddPhoto: { photo: Photo },
  FailedAddPhoto: { spent: Schema.Boolean },
  TickedFindingRefresh: {},
})
export type Message = typeof Message.Type

// COMMAND

export const ListPhotos = Command.define('ListPhotos', {
  messages: [Message.SucceededListPhotos, Message.FailedListPhotos],
  execute: Effect.gen(function* () {
    const { photos } = yield* (yield* (yield* StyldClient).api).photo.listPhotos()
    return Message.SucceededListPhotos({ photos })
  }).pipe(Effect.orElseSucceed(() => Message.FailedListPhotos())),
})

/** Send a picked photo, shrunk and without its metadata, then add it for a credit.
 */
export const AddPhoto = Command.define('AddPhoto', {
  args: { file: File.File },
  messages: [Message.SucceededAddPhoto, Message.FailedAddPhoto],
  execute: ({ file }) =>
    Effect.gen(function* () {
      const uploadId = yield* uploadPicture(file)
      const operationId = yield* drawOperationId()
      const api = yield* (yield* StyldClient).api
      const photo = yield* api.photo.addPhoto({ payload: { operationId, uploadId } })
      return Message.SucceededAddPhoto({ photo })
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedAddPhoto({ spent: Predicate.isTagged(error, 'LimitReached') })),
      ),
    ),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient | Crypto.Crypto | PictureEncoder>

const photosCache = (revalidate: (photos: PhotosData) => Option.Option<PhotosData>) =>
  Update.refresh<Model, Message, ReadonlyArray<Photo>, 'Unavailable', StyldClient>({
    read: (model: Model) => Option.some(model.photos),
    revalidate,
    write: (model: Model, photos: PhotosData) => modifyFields(model, { photos: () => photos }),
    load: ListPhotos(),
  })

/** Opening the page, or Try again: the photos already here stay while they are asked for again; a first visit asks;
 * a page that stopped following its photos starts over. */
export const revisit = Update.combine<Model, Message, StyldClient>([
  (model) => ({ model: modifyFields(model, { misses: () => 0 }) }),
  photosCache(AsyncData.revalidateOrLoad),
])

/** The photos as read, with any added here that the read did not have yet, newest first. */
const listed = (model: Model, photos: ReadonlyArray<Photo>): Model => {
  const isListed = (added: Photo) => photos.some(({ id }) => id === added.id)
  const missing = Array.filter(model.added, (added) => !isListed(added))
  return modifyFields(model, {
    photos: () => PhotosData.Success({ data: [...missing, ...photos] }),
    added: () => missing,
    misses: () => 0,
  })
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededListPhotos: ({ photos }) => ({ model: listed(model, photos) }),
    FailedListPhotos: () => ({
      model: modifyFields(model, {
        photos: (photos) => AsyncData.settle(photos, Result.fail('Unavailable' as const)),
        misses: Number.increment,
      }),
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
        added: (added) => [photo, ...added],
        photos: (photos) =>
          PhotosData.Success({
            data: [photo, ...Option.getOrElse(AsyncData.getData(photos), (): ReadonlyArray<Photo> => [])],
          }),
      }),
    }),
    FailedAddPhoto: ({ spent }) => ({ model: modifyFields(model, { adding: () => Adding.Failed({ spent }) }) }),
    TickedFindingRefresh: () => photosCache(AsyncData.revalidate)(model),
  })

// SUBSCRIPTION

/** The photos whose garments Styld is still finding. */
const findingIds = (model: Model): ReadonlyArray<PhotoId> =>
  Option.getOrElse(AsyncData.getData(model.photos), (): ReadonlyArray<Photo> => [])
    .filter(({ status }) => status === 'finding')
    .map(({ id }) => id)

/** The photos are asked for again while Styld finds a photo's garments. */
export const subscriptions = Subscription.make<Model, Message>()(() => ({
  photosWhileFinding: pollWhilePending<Model, Message>({
    pendingIds: findingIds,
    misses: (model) => model.misses,
    tick: Message.TickedFindingRefresh(),
  }),
}))
