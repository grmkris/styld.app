import { LookPin, type PhotoId, type PhotoPicture, type TryOnId } from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import { AsyncData, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { pickerFolds } from '../PiecePicker.ts'
import { addedPieces, picturesSent, placedPicture } from './Actions.ts'
import { AddGalleryPicture, AddTryOnPicture } from './Commands.ts'
import type { UpdateReturn } from './Edits.ts'
import { Message } from './Message.ts'
import { type AddKind, LooksData, type Model, PhotosData, TryOnsData } from './Model.ts'
import { LoadLooks, LoadPhotos, LoadTryOns, PinLook } from './PageCommands.ts'

// The board's Add sheet: one sheet for everything the person can put on the table (their pieces, looks, Gallery photos
// and try-ons), one search across them, each kind read the first time it is shown. A tap puts the thing on the table
// and closes the sheet.

const sheet = pickerFolds<Model, Message>({
  read: (model) => model.piecePicker,
  write: (model, nextPicker) => modifyFields(model, { piecePicker: () => nextPicker }),
  toParentMessage: (message) => Message.GotPiecePickerMessage({ message }),
})
const close = sheet.close

/** Read the kind's things the first time the sheet shows it; pieces are the app's and always read. */
const readFor = (model: Model, kind: AddKind): UpdateReturn => {
  if (kind === 'looks' && AsyncData.isIdle(model.looks))
    return { model: modifyFields(model, { looks: () => AsyncData.Loading() }), commands: [LoadLooks()] }
  if (kind === 'gallery' && AsyncData.isIdle(model.photos))
    return { model: modifyFields(model, { photos: () => AsyncData.Loading() }), commands: [LoadPhotos()] }
  if (kind === 'tryOns' && AsyncData.isIdle(model.tryOns))
    return { model: modifyFields(model, { tryOns: () => AsyncData.Loading() }), commands: [LoadTryOns()] }
  return { model }
}

const opened = (model: Model): UpdateReturn =>
  Update.combine(model, [sheet.open, (stepModel) => readFor(stepModel, stepModel.addKind)])

const kindSelected = (model: Model, kind: AddKind): UpdateReturn =>
  readFor(modifyFields(model, { addKind: () => kind }), kind)

/** A look's pieces go on the table, and the look is pinned unless it is already. */
const lookClicked = (model: Model, lookId: string): UpdateReturn => {
  const look = Option.flatMap(
    AsyncData.getData(model.looks),
    Array.findFirst((each) => each.id === lookId),
  )
  if (Option.isNone(look)) return { model }
  const isPinned = model.pins.some((pin) => Schema.is(LookPin)(pin) && pin.look.id === lookId)
  return Update.combine(model, [
    (stepModel) =>
      addedPieces(
        stepModel,
        look.value.pieces.map((piece) => piece.id),
      ),
    close,
    (stepModel) => ({
      model: stepModel,
      commands: isPinned ? [] : [PinLook({ boardId: stepModel.boardId, lookId })],
    }),
  ])
}

const galleryClicked = (model: Model, photoId: PhotoId, picture: PhotoPicture): UpdateReturn =>
  Update.combine(model, [
    close,
    (stepModel) => picturesSent(stepModel, [AddGalleryPicture({ boardId: stepModel.boardId, photoId, picture })]),
  ])

const tryOnClicked = (model: Model, tryOnId: TryOnId): UpdateReturn =>
  Update.combine(model, [
    close,
    (stepModel) => picturesSent(stepModel, [AddTryOnPicture({ boardId: stepModel.boardId, tryOnId })]),
  ])

type AddTag =
  | 'ClickedAdd'
  | 'GotPiecePickerMessage'
  | 'SelectedAddKind'
  | 'SelectedPickerGroup'
  | 'SelectedPickerType'
  | 'UpdatedPickerQuery'
  | 'ClickedPinnedPicture'
  | 'ClickedLook'
  | 'ClickedGalleryPhoto'
  | 'ClickedTryOn'
  | 'SucceededLoadLooks'
  | 'FailedLoadLooks'
  | 'SucceededLoadPhotos'
  | 'FailedLoadPhotos'
  | 'SucceededLoadTryOns'
  | 'FailedLoadTryOns'
  | 'CompletedPinLook'

/** How the Add sheet's Messages change the board, for the board's update to spread into its match. */
export const addSteps = (
  model: Model,
): { readonly [Tag in AddTag]: (message: Extract<Message, { readonly _tag: Tag }>) => UpdateReturn } => ({
  ClickedAdd: () => opened(model),
  GotPiecePickerMessage: ({ message }) => sheet.update(model, message),
  SelectedAddKind: ({ kind }) => kindSelected(model, kind),
  SelectedPickerGroup: ({ group }) => sheet.selectedGroup(model, group),
  SelectedPickerType: ({ type }) => sheet.selectedType(model, type),
  UpdatedPickerQuery: ({ query }) => sheet.updatedQuery(model, query),
  ClickedPinnedPicture: ({ imageId }) =>
    Update.combine(model, [(stepModel) => placedPicture(stepModel, imageId), close]),
  ClickedLook: ({ lookId }) => lookClicked(model, lookId),
  ClickedGalleryPhoto: ({ photoId, picture }) => galleryClicked(model, photoId, picture),
  ClickedTryOn: ({ tryOnId }) => tryOnClicked(model, tryOnId),
  SucceededLoadLooks: ({ looks }) => ({
    model: modifyFields(model, { looks: () => LooksData.Success({ data: looks }) }),
  }),
  FailedLoadLooks: () => ({ model: modifyFields(model, { looks: () => LooksData.Failure({ error: 'Unavailable' }) }) }),
  SucceededLoadPhotos: ({ photos }) => ({
    model: modifyFields(model, { photos: () => PhotosData.Success({ data: photos }) }),
  }),
  FailedLoadPhotos: () => ({
    model: modifyFields(model, { photos: () => PhotosData.Failure({ error: 'Unavailable' }) }),
  }),
  SucceededLoadTryOns: ({ tryOns }) => ({
    model: modifyFields(model, { tryOns: () => TryOnsData.Success({ data: tryOns }) }),
  }),
  FailedLoadTryOns: () => ({
    model: modifyFields(model, { tryOns: () => TryOnsData.Failure({ error: 'Unavailable' }) }),
  }),
  CompletedPinLook: ({ maybeBoard }) =>
    Option.match(maybeBoard, {
      onNone: () => ({ model }),
      onSome: (board) => ({
        model: modifyFields(model, { pins: () => board.pins, publicPins: () => board.publicPins }),
      }),
    }),
})

/** Closing the Add sheet, for the table's own steps. */
export const closeAddSheet = close
