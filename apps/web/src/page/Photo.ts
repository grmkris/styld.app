import { drawOperationId } from '../OperationIds.ts'
import {
  GarmentGroup,
  Look,
  Photo as PhotoContract,
  PhotoGarmentId,
  PhotoId,
  PhotoPicture,
  PieceId,
  PieceType,
} from '@styld/protocol'
import { Dialog } from '@foldkit/ui'
import { Effect, Number, Option, Predicate, Result, Schema } from 'effect'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import { AsyncData, Command, Subscription, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { Deletion } from '../Confirm.ts'
import { StyldClient } from '../StyldClient.ts'
import { Misses, pollWhilePending } from '../Polling.ts'
import { LoadError } from '../ServerData.ts'
import { initPicker, PiecePicker, pickerFolds, startingAt } from './PiecePicker.ts'
import * as SaveToBoard from './SaveToBoard.ts'

// One outfit photo of My Gallery (owner, 2026-10-31): the garments Styld found, each confirmed as one of the person's
// pieces, corrected, said to be none of them, or offered to the review tray; a favourite or not; worn again as a
// look; deleted. Once the outfit is cut out (by hand, 2026-11-03, T-17) the page shows the photo or the cut-out,
// swiped between or chosen, and a board gets whichever it shows.

// MODEL

/** The photo as last read. */
export const PhotoData = AsyncData.Schema(PhotoContract, LoadError)
export type PhotoData = typeof PhotoData.schema.Type

/** A change on its way, the outfit being cut out, one that did not go through, a cut-out that found no one, or one
 * asked for too soon after others. */
export const Work = defineTaggedUnion({
  Idle: {},
  Sending: {},
  CuttingOut: {},
  Failed: {},
  NoPerson: {},
  SlowDown: {},
})
export type Work = typeof Work.Type

export { Deletion }

/** What the wardrobe's sheet is open for: a garment Styld found, matched to a piece, or a piece Styld did not find,
 * added to the photo by hand (Eva, 4 November: "add from my wardrobe"). */
export const Choosing = defineTaggedUnion({
  ForGarment: { garmentId: PhotoGarmentId },
  NewPiece: {},
})
export type Choosing = typeof Choosing.Type

export const Model = Schema.Struct({
  photoId: Schema.String,
  photo: PhotoData.schema,
  work: Work,
  deletion: Deletion,
  /** What the wardrobe's sheet chooses a piece for, while it is open. */
  choosing: Schema.Option(Choosing),
  picker: PiecePicker,
  saveToBoard: SaveToBoard.Model,
  misses: Misses,
  /** The picture the page shows: the photo, or the person cut out of it once there is one. */
  showing: PhotoPicture,
  /** Where a press on the picture began, to tell a sideways swipe from a tap or a scroll. */
  press: Schema.Option(Schema.Struct({ x: Schema.Number, y: Schema.Number })),
})
export type Model = typeof Model.Type

/** How far a press must travel sideways, and how much more than it travels up or down, to be a swipe. */
const swipeDistance = 48
const swipeSlant = 1.5

export const init = (photoId: string): Model => ({
  photoId,
  photo: AsyncData.Loading(),
  misses: 0,
  work: Work.Idle(),
  deletion: Deletion.Idle(),
  choosing: Option.none(),
  picker: initPicker('photo-piece-picker'),
  saveToBoard: SaveToBoard.init({ kind: 'photo', id: photoId }),
  showing: 'photo',
  press: Option.none(),
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
  /** The wardrobe's sheet opened for a garment, on the kind Styld read it as. */
  ClickedChoose: { garmentId: PhotoGarmentId },
  /** The wardrobe's sheet opened to add a piece Styld did not find, on every piece. */
  ClickedAddFromWardrobe: {},
  ClickedAddPiece: { pieceId: PieceId },
  GotPiecePickerMessage: { message: Dialog.Message },
  SelectedPickerGroup: { group: Schema.Option(GarmentGroup) },
  SelectedPickerType: { type: Schema.Option(PieceType) },
  UpdatedPickerQuery: { query: Schema.String },
  ClickedOffer: { garmentId: PhotoGarmentId },
  /** "Wear it again", with the look's name in the person's language. */
  ClickedWearAgain: { name: Schema.String },
  ClickedCutOut: {},
  FailedCutOut: { reason: Schema.Literals(['noPerson', 'slowDown', 'failed']) },
  ClickedShow: { showing: PhotoPicture },
  PressedPicture: { x: Schema.Number, y: Schema.Number },
  ReleasedPicture: { x: Schema.Number, y: Schema.Number },
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
        payload: { operationId: yield* drawOperationId(), favourite },
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
        payload: { operationId: yield* drawOperationId(), pieceId },
      })
      return Message.SucceededChange({ photo })
    }).pipe(Effect.orElseSucceed(() => Message.FailedChange())),
})

export const AddPiece = Command.define('AddPiece', {
  args: { photoId: Schema.String, pieceId: PieceId },
  messages: [Message.SucceededChange, Message.FailedChange],
  execute: ({ photoId, pieceId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const photo = yield* api.photo.addPiece({
        params: { photoId: yield* photoIdOf(photoId) },
        payload: { operationId: yield* drawOperationId(), pieceId },
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
        payload: { operationId: yield* drawOperationId() },
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
        payload: { operationId: yield* drawOperationId(), name },
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
        payload: { operationId: yield* drawOperationId() },
      })
      return Message.SucceededChange({ photo })
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          Message.FailedCutOut({
            reason: Predicate.isTagged(error, 'NoPersonFound')
              ? 'noPerson'
              : Predicate.isTagged(error, 'SlowDown')
                ? 'slowDown'
                : 'failed',
          }),
        ),
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
        payload: { operationId: yield* drawOperationId() },
      })
      return Message.SucceededDeletePhoto()
    }).pipe(Effect.orElseSucceed(() => Message.FailedDeletePhoto())),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | SecureRandom.SecureRandom>

/** What opening the page asks for: the photo. */
export const load = (model: Model) => [GetPhoto({ photoId: model.photoId })]

const busy = (work: Work) => Work.guards.Sending(work) || Work.guards.CuttingOut(work)

/** A change sent, unless one is already on its way; `work` says what is on its way. */
const sending = (
  model: Model,
  command: Command.Command<Message, never, StyldClient | SecureRandom.SecureRandom>,
  work: Work = Work.Sending(),
): UpdateReturn =>
  busy(model.work)
    ? { model }
    : { model: modifyFields(model, { work: () => work, choosing: () => Option.none() }), commands: [command] }

/** The page shows the photo or its cut-out (only once there is one), and a board gets the one it shows. */
const show = (model: Model, showing: PhotoPicture): Model => {
  const hasCutout = Option.exists(AsyncData.getData(model.photo), (photo) => photo.hasCutout)
  const shown = showing === 'cutout' && !hasCutout ? 'photo' : showing
  return modifyFields(model, {
    showing: () => shown,
    saveToBoard: (saveToBoard) => modifyFields(saveToBoard, { target: () => ({ kind: shown, id: model.photoId }) }),
  })
}

/** A press let go: a sideways swipe shows the other picture, leftwards the cut-out and rightwards the photo. */
const released = (model: Model, x: number, y: number): UpdateReturn => {
  const unpressed = modifyFields(model, { press: () => Option.none() })
  return Option.match(model.press, {
    onNone: () => ({ model: unpressed }),
    onSome: (press) => {
      const across = x - press.x
      const swiped = Math.abs(across) >= swipeDistance && Math.abs(across) > Math.abs(y - press.y) * swipeSlant
      return { model: swiped ? show(unpressed, across < 0 ? 'cutout' : 'photo') : unpressed }
    },
  })
}

const photoCache = (revalidate: (photo: PhotoData) => Option.Option<PhotoData>) => (model: Model) =>
  Update.refresh<Model, Message, PhotoContract, LoadError, StyldClient>({
    read: (current: Model) => Option.some(current.photo),
    revalidate,
    write: (current: Model, photo: PhotoData) => modifyFields(current, { photo: () => photo }),
    load: GetPhoto({ photoId: model.photoId }),
  })(model)

/** A change went through: the photo as the server answered it, and the page ready for the next change. A cut-out
 * just made is shown at once. */
const changed = (model: Model, photo: PhotoContract): UpdateReturn => {
  const answered = modifyFields(model, { photo: () => PhotoData.Success({ data: photo }), work: () => Work.Idle() })
  return { model: Work.guards.CuttingOut(model.work) && photo.hasCutout ? show(answered, 'cutout') : answered }
}

const picker = pickerFolds<Model, Message>({
  read: (model) => model.picker,
  write: (model, nextPicker) => modifyFields(model, { picker: () => nextPicker }),
  toParentMessage: (message) => Message.GotPiecePickerMessage({ message }),
})

/** The sheet opens on the kind Styld read the garment as; every other piece is one tap on All away. */
const openedFor = (model: Model, garmentId: PhotoGarmentId): UpdateReturn => {
  const garment = Option.flatMap(AsyncData.getData(model.photo), (photo) =>
    Option.fromNullishOr(photo.garments.find(({ id }) => id === garmentId)),
  )
  const read = Option.flatMap(garment, ({ type }) => Option.fromNullishOr(type))
  return picker.openAt(startingAt(read))(
    modifyFields(model, { choosing: () => Option.some(Choosing.ForGarment({ garmentId })) }),
  )
}

/** The sheet opens on every piece, for one Styld did not find. */
const openedToAdd = (model: Model): UpdateReturn =>
  picker.openAt(startingAt(Option.none()))(modifyFields(model, { choosing: () => Option.some(Choosing.NewPiece()) }))

/** A piece chosen in the sheet, or none of them: the sheet closes and the match is sent. */
const sentFromSheet = (
  model: Model,
  command: Command.Command<Message, never, StyldClient | SecureRandom.SecureRandom>,
): UpdateReturn => {
  const closed = picker.close(model)
  const sent = sending(closed.model, command)
  return { ...sent, commands: [...(closed.commands ?? []), ...(sent.commands ?? [])] }
}

const cutOutFailures = { noPerson: Work.NoPerson(), slowDown: Work.SlowDown(), failed: Work.Failed() } as const

const foldSaveToBoard = SaveToBoard.fold<Model, Message, OutMessage>(
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
      sentFromSheet(model, MatchGarment({ photoId: model.photoId, garmentId, pieceId })),
    ClickedChoose: ({ garmentId }) => openedFor(model, garmentId),
    ClickedAddFromWardrobe: () => openedToAdd(model),
    ClickedAddPiece: ({ pieceId }) => sentFromSheet(model, AddPiece({ photoId: model.photoId, pieceId })),
    GotPiecePickerMessage: (got) => picker.update(model, got.message),
    SelectedPickerGroup: ({ group }) => picker.selectedGroup(model, group),
    SelectedPickerType: ({ type }) => picker.selectedType(model, type),
    UpdatedPickerQuery: ({ query }) => picker.updatedQuery(model, query),
    ClickedOffer: ({ garmentId }) => sending(model, OfferGarment({ photoId: model.photoId, garmentId })),
    ClickedWearAgain: ({ name }) => sending(model, WearAgain({ photoId: model.photoId, name })),
    ClickedCutOut: () => sending(model, CutOut({ photoId: model.photoId }), Work.CuttingOut()),
    FailedCutOut: ({ reason }) => ({ model: modifyFields(model, { work: () => cutOutFailures[reason] }) }),
    ClickedShow: ({ showing }) => ({ model: show(model, showing) }),
    PressedPicture: ({ x, y }) => ({ model: modifyFields(model, { press: () => Option.some({ x, y }) }) }),
    ReleasedPicture: ({ x, y }) => released(model, x, y),
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
