import {
  BoardImageId,
  GarmentGroup,
  Look,
  LookId,
  Photo,
  PhotoId,
  PhotoPicture,
  PieceId,
  PieceType,
  TryOn,
  TryOnId,
} from '@styld/protocol'
import { Array, Effect, Option, Schema } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { Dialog } from '@foldkit/ui'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { initPicker, PiecePicker, pickerFolds } from '../PiecePicker.ts'
import { StyldClient } from '../../StyldClient.ts'
import { sheetShown } from '../Sheet.ts'

// The board's Add sheet: one sheet for everything the person can put on the table (their pieces, looks, Gallery photos
// and try-ons), one search across them, each kind read the first time it is shown. A tap closes the sheet and tells
// the board what was chosen; the board puts it on its table.

// MODEL

/** What the Add sheet offers: the wardrobe's pieces, the person's looks, their Gallery's outfit photos or their
 * try-ons' pictures. */
export const AddKind = Schema.Literals(['pieces', 'looks', 'gallery', 'tryOns'])
export type AddKind = typeof AddKind.Type

/** The person's looks, for the Add sheet. */
export const LooksData = AsyncData.Schema(Schema.Array(Look), Schema.Literal('Unavailable'))
export type LooksData = typeof LooksData.schema.Type

/** The person's Gallery photos, for the Add sheet. */
export const PhotosData = AsyncData.Schema(Schema.Array(Photo), Schema.Literal('Unavailable'))
export type PhotosData = typeof PhotosData.schema.Type

/** The person's try-ons, for the Add sheet. */
export const TryOnsData = AsyncData.Schema(Schema.Array(TryOn), Schema.Literal('Unavailable'))
export type TryOnsData = typeof TryOnsData.schema.Type

export const Model = Schema.Struct({
  /** Its sheet, its search and the pieces' chips. */
  picker: PiecePicker,
  kind: AddKind,
  looks: LooksData.schema,
  photos: PhotosData.schema,
  tryOns: TryOnsData.schema,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  picker: initPicker('board-add'),
  kind: 'pieces',
  looks: AsyncData.Idle(),
  photos: AsyncData.Idle(),
  tryOns: AsyncData.Idle(),
})

/** Whether the sheet covers the table, so its keys and hands are the sheet's. */
export const isSheetShown = (model: Model): boolean => sheetShown(model.picker.sheet)

// MESSAGE

export const Message = defineMessageUnion({
  ClickedAdd: {},
  GotSheetMessage: { message: Dialog.Message },
  SelectedKind: { kind: AddKind },
  SelectedGroup: { group: Schema.Option(GarmentGroup) },
  SelectedType: { type: Schema.Option(PieceType) },
  UpdatedQuery: { query: Schema.String },
  ClickedPiece: { pieceId: PieceId },
  ClickedPinnedPicture: { imageId: BoardImageId },
  ClickedLook: { lookId: LookId },
  ClickedGalleryPhoto: { photoId: PhotoId, picture: PhotoPicture },
  ClickedTryOn: { tryOnId: TryOnId },
  SucceededLoadLooks: { looks: Schema.Array(Look) },
  FailedLoadLooks: {},
  SucceededLoadPhotos: { photos: Schema.Array(Photo) },
  FailedLoadPhotos: {},
  SucceededLoadTryOns: { tryOns: Schema.Array(TryOn) },
  FailedLoadTryOns: {},
})
export type Message = typeof Message.Type

/** What the person chose to put on the table; the sheet has closed behind it. */
export const OutMessage = defineMessageUnion({
  ChosePiece: { pieceId: PieceId },
  ChosePinnedPicture: { imageId: BoardImageId },
  ChoseLook: { look: Look },
  ChosePhoto: { photoId: PhotoId, picture: PhotoPicture },
  ChoseTryOn: { tryOnId: TryOnId },
})
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** The person's Gallery photos, for the Add sheet. */
export const LoadPhotos = Command.define('LoadPhotos', {
  messages: [Message.SucceededLoadPhotos, Message.FailedLoadPhotos],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { photos } = yield* api.photo.listPhotos()
    return Message.SucceededLoadPhotos({ photos })
  }).pipe(Effect.orElseSucceed(() => Message.FailedLoadPhotos())),
})

/** The person's try-ons, for the Add sheet. */
export const LoadTryOns = Command.define('LoadTryOns', {
  messages: [Message.SucceededLoadTryOns, Message.FailedLoadTryOns],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { tryOns } = yield* api.tryOn.listTryOns()
    return Message.SucceededLoadTryOns({ tryOns })
  }).pipe(Effect.orElseSucceed(() => Message.FailedLoadTryOns())),
})

/** The person's looks, for the Add sheet. */
export const LoadLooks = Command.define('LoadLooks', {
  messages: [Message.SucceededLoadLooks, Message.FailedLoadLooks],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { looks } = yield* api.look.listLooks()
    return Message.SucceededLoadLooks({ looks })
  }).pipe(Effect.orElseSucceed(() => Message.FailedLoadLooks())),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient>

const sheet = pickerFolds<Model, Message>({
  read: (model) => model.picker,
  write: (model, picker) => modifyFields(model, { picker: () => picker }),
  toParentMessage: (message) => Message.GotSheetMessage({ message }),
})

/** Read the kind's things the first time the sheet shows it; pieces are the app's and always read. */
const readFor = (model: Model, kind: AddKind): Update.Return<Model, Message, StyldClient> => {
  if (kind === 'looks' && AsyncData.isIdle(model.looks))
    return { model: modifyFields(model, { looks: () => AsyncData.Loading() }), commands: [LoadLooks()] }
  if (kind === 'gallery' && AsyncData.isIdle(model.photos))
    return { model: modifyFields(model, { photos: () => AsyncData.Loading() }), commands: [LoadPhotos()] }
  if (kind === 'tryOns' && AsyncData.isIdle(model.tryOns))
    return { model: modifyFields(model, { tryOns: () => AsyncData.Loading() }), commands: [LoadTryOns()] }
  return { model }
}

/** The sheet closes, and the board hears what was chosen. */
const chose = (model: Model, outMessage: OutMessage): UpdateReturn => ({ ...sheet.close(model), outMessage })

const lookClicked = (model: Model, lookId: LookId): UpdateReturn =>
  Option.match(
    Option.flatMap(
      AsyncData.getData(model.looks),
      Array.findFirst((each) => each.id === lookId),
    ),
    { onNone: () => ({ model }), onSome: (look) => chose(model, OutMessage.ChoseLook({ look })) },
  )

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedAdd: () => Update.combine(model, [sheet.open, (opened) => readFor(opened, opened.kind)]),
    GotSheetMessage: ({ message: sheetMessage }) => sheet.update(model, sheetMessage),
    SelectedKind: ({ kind }) => readFor(modifyFields(model, { kind: () => kind }), kind),
    SelectedGroup: ({ group }) => sheet.selectedGroup(model, group),
    SelectedType: ({ type }) => sheet.selectedType(model, type),
    UpdatedQuery: ({ query }) => sheet.updatedQuery(model, query),
    ClickedPiece: ({ pieceId }) => chose(model, OutMessage.ChosePiece({ pieceId })),
    ClickedPinnedPicture: ({ imageId }) => chose(model, OutMessage.ChosePinnedPicture({ imageId })),
    ClickedLook: ({ lookId }) => lookClicked(model, lookId),
    ClickedGalleryPhoto: ({ photoId, picture }) => chose(model, OutMessage.ChosePhoto({ photoId, picture })),
    ClickedTryOn: ({ tryOnId }) => chose(model, OutMessage.ChoseTryOn({ tryOnId })),
    SucceededLoadLooks: ({ looks }) => ({
      model: modifyFields(model, { looks: () => LooksData.Success({ data: looks }) }),
    }),
    FailedLoadLooks: () => ({
      model: modifyFields(model, { looks: () => LooksData.Failure({ error: 'Unavailable' }) }),
    }),
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
  })
