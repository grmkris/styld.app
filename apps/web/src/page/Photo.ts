import { newOperation, newOperationId } from '../OperationIds.ts'
import { Look, Photo as PhotoContract, PhotoGarmentId, PhotoId, PieceId } from '@styld/protocol'
import { Effect, Number, Option, Predicate, Result, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { AsyncData, Command, Subscription, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { Deletion } from '../Confirm.ts'
import { StyldClient } from '../StyldClient.ts'
import { Misses, pollWhilePending } from '../Polling.ts'
import { LoadError } from '../ServerData.ts'
import * as SaveToBoard from './SaveToBoard.ts'

// One outfit photo of My Gallery (owner, 2026-10-31): the garments Styld found, each confirmed as one of the person's
// pieces, corrected, said to be none of them, or offered to the review tray; a favourite or not; worn again as a
// look; deleted.

// MODEL

/** The photo as last read. */
export const PhotoData = AsyncData.Schema(PhotoContract, LoadError)
export type PhotoData = typeof PhotoData.schema.Type

/** A change on its way, one that did not go through, or a cut-out that found no one. */
export const Work = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: {}, NoPerson: {} })
export type Work = typeof Work.Type

export { Deletion }

export const Model = Schema.Struct({
  photoId: Schema.String,
  photo: PhotoData.schema,
  work: Work,
  deletion: Deletion,
  /** The garment whose wardrobe picker is open. */
  choosing: Schema.Option(PhotoGarmentId),
  saveToBoard: SaveToBoard.Model,
  misses: Misses,
})
export type Model = typeof Model.Type

export const init = (photoId: string): Model => ({
  photoId,
  photo: AsyncData.Loading(),
  misses: 0,
  work: Work.Idle(),
  deletion: Deletion.Idle(),
  choosing: Option.none(),
  saveToBoard: SaveToBoard.init({ kind: 'photo', id: photoId }),
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededGetPhoto: { photo: PhotoContract },
  FailedGetPhoto: { error: LoadError },
  ClickedRetry: {},
  TickedFindingRefresh: {},
  ClickedFavourite: { favourite: Schema.Boolean },
  /** A garment confirmed as a piece, or none of them. */
  ClickedMatch: { garmentId: PhotoGarmentId, pieceId: Schema.NullOr(PieceId) },
  ClickedChoose: { garmentId: PhotoGarmentId },
  ClickedCancelChoose: {},
  ClickedOffer: { garmentId: PhotoGarmentId },
  /** "Wear it again", with the look's name in the person's language. */
  ClickedWearAgain: { name: Schema.String },
  ClickedCutOut: {},
  FailedCutOut: { noPerson: Schema.Boolean },
  SucceededChange: { photo: PhotoContract },
  SucceededWearAgain: { look: Look },
  FailedChange: {},
  ClickedDelete: {},
  ClickedCancelDelete: {},
  ClickedConfirmDelete: {},
  SucceededDeletePhoto: {},
  FailedDeletePhoto: {},
  GotSaveToBoardMessage: { message: SaveToBoard.Message },
})
export type Message = typeof Message.Type

/** The photo is gone: the app goes back to the Gallery. */
/** Gone once deleted; Save to board's sheet asks the app for the person's boards. */
export const OutMessage = defineMessageUnion({ DeletedPhoto: {}, RequestedBoards: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

const photoIdOf = (photoId: string) => Schema.decodeUnknownEffect(PhotoId)(photoId)
export const GetPhoto = Command.define('GetPhoto', {
  args: { photoId: Schema.String },
  messages: [Message.SucceededGetPhoto, Message.FailedGetPhoto],
  execute: ({ photoId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const photo = yield* api.photo.getPhoto({ params: { photoId: yield* photoIdOf(photoId) } })
      return Message.SucceededGetPhoto({ photo })
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          Message.FailedGetPhoto({ error: Predicate.isTagged(error, 'NotFound') ? 'NotFound' : 'Unavailable' }),
        ),
      ),
    ),
})

export const SetFavourite = Command.define('SetFavourite', {
  args: { photoId: Schema.String, favourite: Schema.Boolean },
  messages: [Message.SucceededChange, Message.FailedChange],
  execute: ({ photoId, favourite }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const photo = yield* api.photo.updatePhoto({
        params: { photoId: yield* photoIdOf(photoId) },
        payload: { operationId: yield* newOperationId, favourite },
      })
      return Message.SucceededChange({ photo })
    }).pipe(Effect.orElseSucceed(() => Message.FailedChange())),
})

export const MatchGarment = Command.define('MatchGarment', {
  args: { photoId: Schema.String, garmentId: PhotoGarmentId, pieceId: Schema.NullOr(PieceId) },
  messages: [Message.SucceededChange, Message.FailedChange],
  execute: ({ photoId, garmentId, pieceId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const photo = yield* api.photo.matchGarment({
        params: { photoId: yield* photoIdOf(photoId), garmentId },
        payload: { operationId: yield* newOperationId, pieceId },
      })
      return Message.SucceededChange({ photo })
    }).pipe(Effect.orElseSucceed(() => Message.FailedChange())),
})

export const OfferGarment = Command.define('OfferGarment', {
  args: { photoId: Schema.String, garmentId: PhotoGarmentId },
  messages: [Message.SucceededChange, Message.FailedChange],
  execute: ({ photoId, garmentId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const photo = yield* api.photo.offerGarment({
        params: { photoId: yield* photoIdOf(photoId), garmentId },
        payload: yield* newOperation,
      })
      return Message.SucceededChange({ photo })
    }).pipe(Effect.orElseSucceed(() => Message.FailedChange())),
})

export const WearAgain = Command.define('WearAgain', {
  args: { photoId: Schema.String, name: Schema.String },
  messages: [Message.SucceededWearAgain, Message.FailedChange],
  execute: ({ photoId, name }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const look = yield* api.photo.wearAgain({
        params: { photoId: yield* photoIdOf(photoId) },
        payload: { operationId: yield* newOperationId, name },
      })
      return Message.SucceededWearAgain({ look })
    }).pipe(Effect.orElseSucceed(() => Message.FailedChange())),
})

export const CutOut = Command.define('CutOut', {
  args: { photoId: Schema.String },
  messages: [Message.SucceededChange, Message.FailedCutOut],
  execute: ({ photoId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const photo = yield* api.photo.cutOut({
        params: { photoId: yield* photoIdOf(photoId) },
        payload: yield* newOperation,
      })
      return Message.SucceededChange({ photo })
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedCutOut({ noPerson: Predicate.isTagged(error, 'NoPersonFound') })),
      ),
    ),
})

export const DeletePhoto = Command.define('DeletePhoto', {
  args: { photoId: Schema.String },
  messages: [Message.SucceededDeletePhoto, Message.FailedDeletePhoto],
  execute: ({ photoId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      yield* api.photo.deletePhoto({
        params: { photoId: yield* photoIdOf(photoId) },
        payload: yield* newOperation,
      })
      return Message.SucceededDeletePhoto()
    }).pipe(Effect.orElseSucceed(() => Message.FailedDeletePhoto())),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | Crypto.Crypto>

/** What opening the page asks for: the photo. */
export const load = (model: Model) => [GetPhoto({ photoId: model.photoId })]

/** A change sent, unless one is already on its way. */
const sending = (model: Model, command: Command.Command<Message, never, StyldClient | Crypto.Crypto>): UpdateReturn =>
  Work.guards.Sending(model.work)
    ? { model }
    : { model: modifyFields(model, { work: () => Work.Sending(), choosing: () => Option.none() }), commands: [command] }

const photoCache = (revalidate: (photo: PhotoData) => Option.Option<PhotoData>) => (model: Model) =>
  Update.refresh<Model, Message, PhotoContract, LoadError, StyldClient>({
    read: (current: Model) => Option.some(current.photo),
    revalidate,
    write: (current: Model, photo: PhotoData) => modifyFields(current, { photo: () => photo }),
    load: GetPhoto({ photoId: model.photoId }),
  })(model)

/** A change went through: the photo as the server answered it, and the page ready for the next change. */
const changed = (model: Model, photo: PhotoContract): UpdateReturn => ({
  model: modifyFields(model, { photo: () => PhotoData.Success({ data: photo }), work: () => Work.Idle() }),
})

const foldSaveToBoard = SaveToBoard.foldInto<Model, Message, OutMessage>(
  (message) => Message.GotSaveToBoardMessage({ message }),
  () => OutMessage.RequestedBoards(),
)

const confirmDelete = (model: Model): UpdateReturn =>
  Deletion.guards.Deleting(model.deletion)
    ? { model }
    : {
        model: modifyFields(model, { deletion: () => Deletion.Deleting() }),
        commands: [DeletePhoto({ photoId: model.photoId })],
      }

const wornAgain = (model: Model, look: Look): UpdateReturn => ({
  model: modifyFields(model, {
    work: () => Work.Idle(),
    photo: AsyncData.map((photo) => ({ ...photo, lookId: look.id })),
  }),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    // A read (the first, or a poll while the garments are found) shows the photo; a change on its way stays so.
    SucceededGetPhoto: ({ photo }) => ({
      model: modifyFields(model, { photo: () => PhotoData.Success({ data: photo }), misses: () => 0 }),
    }),
    FailedGetPhoto: ({ error }) => ({
      model: modifyFields(model, {
        photo: (photo) => AsyncData.settle(photo, Result.fail(error)),
        misses: Number.increment,
      }),
    }),
    ClickedRetry: () => photoCache(AsyncData.revalidateOrLoad)(modifyFields(model, { misses: () => 0 })),
    TickedFindingRefresh: () => photoCache(AsyncData.revalidate)(model),
    ClickedFavourite: ({ favourite }) => sending(model, SetFavourite({ photoId: model.photoId, favourite })),
    ClickedMatch: ({ garmentId, pieceId }) =>
      sending(model, MatchGarment({ photoId: model.photoId, garmentId, pieceId })),
    ClickedChoose: ({ garmentId }) => ({ model: modifyFields(model, { choosing: () => Option.some(garmentId) }) }),
    ClickedCancelChoose: () => ({ model: modifyFields(model, { choosing: () => Option.none() }) }),
    ClickedOffer: ({ garmentId }) => sending(model, OfferGarment({ photoId: model.photoId, garmentId })),
    ClickedWearAgain: ({ name }) => sending(model, WearAgain({ photoId: model.photoId, name })),
    ClickedCutOut: () => sending(model, CutOut({ photoId: model.photoId })),
    FailedCutOut: ({ noPerson }) => ({
      model: modifyFields(model, { work: () => (noPerson ? Work.NoPerson() : Work.Failed()) }),
    }),
    SucceededChange: ({ photo }) => changed(model, photo),
    SucceededWearAgain: ({ look }) => wornAgain(model, look),
    FailedChange: () => ({ model: modifyFields(model, { work: () => Work.Failed() }) }),
    ClickedDelete: () => ({ model: modifyFields(model, { deletion: () => Deletion.Confirming() }) }),
    ClickedCancelDelete: () => ({ model: modifyFields(model, { deletion: () => Deletion.Idle() }) }),
    ClickedConfirmDelete: () => confirmDelete(model),
    SucceededDeletePhoto: () => ({ model, outMessage: OutMessage.DeletedPhoto() }),
    FailedDeletePhoto: () => ({ model: modifyFields(model, { deletion: () => Deletion.Failed() }) }),
    GotSaveToBoardMessage: (got) => foldSaveToBoard(model, got.message),
  })

// SUBSCRIPTION

/** The photo is asked for again while Styld finds its garments; a change on its way is left as it is. */
export const subscriptions = Subscription.make<Model, Message>()(() => ({
  photoWhileFinding: pollWhilePending<Model, Message>({
    pendingIds: (model) =>
      Option.match(AsyncData.getData(model.photo), {
        onNone: (): ReadonlyArray<string> => [],
        onSome: (photo) => (photo.status === 'finding' ? [photo.id] : []),
      }),
    misses: (model) => model.misses,
    tick: Message.TickedFindingRefresh(),
  }),
}))
