import { newOperation, newOperationId } from '../OperationIds.ts'
import { Look, Photo as PhotoContract, PhotoGarmentId, PhotoId, PieceId } from '@styld/protocol'
import { Effect, Option, Predicate, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'
import { findingPause } from './Photos.ts'
import * as SaveToBoard from './SaveToBoard.ts'

// One outfit photo of My Gallery (owner, 2026-10-31): the garments Styld found, each confirmed as one of the person's
// pieces, corrected, said to be none of them, or offered to the review tray; a favourite or not; worn again as a
// look; deleted.

// MODEL

export const Shown = defineTaggedUnion({
  Loading: {},
  Loaded: { photo: PhotoContract },
  NotFound: {},
  Failed: {},
})
export type Shown = typeof Shown.Type

/** A change on its way, one that did not go through, or a cut-out that found no one. */
export const Work = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: {}, NoPerson: {} })
export type Work = typeof Work.Type

export const Deletion = defineTaggedUnion({ Idle: {}, Confirming: {}, Deleting: {}, Failed: {} })
export type Deletion = typeof Deletion.Type

export const Model = Schema.Struct({
  photoId: Schema.String,
  shown: Shown,
  work: Work,
  deletion: Deletion,
  /** The garment whose wardrobe picker is open. */
  choosing: Schema.Option(PhotoGarmentId),
  saveToBoard: SaveToBoard.Model,
})
export type Model = typeof Model.Type

export const init = (photoId: string): Model => ({
  photoId,
  shown: Shown.Loading(),
  work: Work.Idle(),
  deletion: Deletion.Idle(),
  choosing: Option.none(),
  saveToBoard: SaveToBoard.init({ kind: 'photo', id: photoId }),
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededGetPhoto: { photo: PhotoContract },
  FailedGetPhoto: { notFound: Schema.Boolean },
  ClickedRetry: {},
  ElapsedFindingPause: {},
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
export const OutMessage = defineMessageUnion({ DeletedPhoto: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

const photoIdOf = (photoId: string) => Schema.decodeUnknownEffect(PhotoId)(photoId)
/** @internal Exported for its tests. */
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
        Effect.succeed(Message.FailedGetPhoto({ notFound: Predicate.isTagged(error, 'NotFound') })),
      ),
    ),
})

/** @internal Exported for its tests. */
export const WaitWhileFinding = Command.define('WaitWhileFinding', {
  messages: [Message.ElapsedFindingPause],
  execute: findingPause.pipe(Effect.as(Message.ElapsedFindingPause())),
})

/** @internal Exported for its tests. */
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

/** @internal Exported for its tests. */
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

/** @internal Exported for its tests. */
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

/** @internal Exported for its tests. */
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

/** @internal Exported for its tests. */
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

/** @internal Exported for its tests. */
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

const loaded = (model: Model, photo: PhotoContract): UpdateReturn => ({
  model: modifyFields(model, { shown: () => Shown.Loaded({ photo }), work: () => Work.Idle() }),
  commands: photo.status === 'finding' ? [WaitWhileFinding()] : [],
})

const foldSaveToBoard = SaveToBoard.foldInto<Model, Message>((message) => Message.GotSaveToBoardMessage({ message }))

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
    shown: (shown) =>
      Shown.guards.Loaded(shown) ? Shown.Loaded({ photo: { ...shown.photo, lookId: look.id } }) : shown,
  }),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededGetPhoto: ({ photo }) => loaded(model, photo),
    FailedGetPhoto: ({ notFound }) => ({
      model: modifyFields(model, { shown: () => (notFound ? Shown.NotFound() : Shown.Failed()) }),
    }),
    ClickedRetry: () => ({
      model: modifyFields(model, { shown: () => Shown.Loading() }),
      commands: [GetPhoto({ photoId: model.photoId })],
    }),
    ElapsedFindingPause: () => ({ model, commands: [GetPhoto({ photoId: model.photoId })] }),
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
    SucceededChange: ({ photo }) => loaded(model, photo),
    SucceededWearAgain: ({ look }) => wornAgain(model, look),
    FailedChange: () => ({ model: modifyFields(model, { work: () => Work.Failed() }) }),
    ClickedDelete: () => ({ model: modifyFields(model, { deletion: () => Deletion.Confirming() }) }),
    ClickedCancelDelete: () => ({ model: modifyFields(model, { deletion: () => Deletion.Idle() }) }),
    ClickedConfirmDelete: () => confirmDelete(model),
    SucceededDeletePhoto: () => ({ model, outMessage: OutMessage.DeletedPhoto() }),
    FailedDeletePhoto: () => ({ model: modifyFields(model, { deletion: () => Deletion.Failed() }) }),
    GotSaveToBoardMessage: (got) => foldSaveToBoard(model, got.message),
  })
