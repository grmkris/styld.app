import { cdn } from '../Cdn.ts'
import { drawOperationId } from '../OperationIds.ts'
import {
  Colour,
  Occasion,
  OperationId,
  Pattern,
  PictureChoice,
  Piece,
  PieceId,
  PiecePicture,
  PieceTurn,
  PieceType,
  textLength,
  TurnLayout,
  PieceChanges,
} from '@styld/protocol'
import { Effect, Number, Option, Result, Schema } from 'effect'
import { AsyncData, Command, Mount, Subscription, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { Deletion } from '../Confirm.ts'
import { StyldClient } from '../StyldClient.ts'
import type { PictureEncoder } from '../Upload.ts'
import { Misses, pollWhilePending } from '../Polling.ts'
import { LoadError } from '../ServerData.ts'
import * as PieceBack from './PieceBack.ts'
import * as PieceLooks from './PieceLooks.ts'
import * as PiecePhotos from './PiecePhotos.ts'
import { changeDetails, type Details, WornWhen } from './PieceFields.ts'
import { changesOf, Draft, DraftSave, draftOf, DraftText, nextTurn, shopUrlSendable, typedInto } from './PieceDraft.ts'
import * as SaveToBoard from './SaveToBoard.ts'
import * as PieceSlides from './PieceSlides.ts'
import { RedrawProblem, redrawProblemOf, TurnProblem, turnProblemOf } from './PieceProblems.ts'
import * as SecureRandom from 'effect/crypto/SecureRandom'

// MODEL

/** The piece as last read. */
export const PieceData = AsyncData.Schema(Piece, LoadError)
export type PieceData = typeof PieceData.schema.Type

export { Deletion }

/** A change of the picture shown: none, on its way, or one that failed. */
export const Choosing = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: {} })
export type Choosing = typeof Choosing.Type

/** The turn this page is asking for or building the frames of, or why the last try did not make one. */
export const TurnWork = defineTaggedUnion({ Idle: {}, Asking: {}, Building: {}, Failed: { problem: TurnProblem } })
export type TurnWork = typeof TurnWork.Type

/** Where the asked-for drawing stands: being written, on its way, or refused or lost. A lost one keeps the operation
 * it was sent as, so trying again repeats it. */
export const RedrawSend = defineTaggedUnion({
  Writing: {},
  Sending: {},
  Failed: { problem: RedrawProblem, maybeOperationId: Schema.Option(OperationId) },
})
export type RedrawSend = typeof RedrawSend.Type

/** The owner asking for a new drawing: their words about the piece, and where sending them stands. */
export const Redraw = Schema.Struct({ hint: Schema.String, send: RedrawSend })
export type Redraw = typeof Redraw.Type

export const Model = Schema.Struct({
  pieceId: Schema.String,
  piece: PieceData.schema,
  /** Polls in a row that did not get through while the piece settles. */
  misses: Misses,
  deletion: Deletion,
  draft: Schema.Option(Draft),
  redraw: Schema.Option(Redraw),
  choosing: Choosing,
  turnWork: TurnWork,
  back: PieceBack.Model,
  /** The outfit photos it is confirmed in. */
  photos: PiecePhotos.Model,
  /** The saved looks it is in. */
  looks: PieceLooks.Model,
  /** Whether the turn's player has drawn its first frame; until then the still shows under it. */
  turnShown: Schema.Boolean,
  saveToBoard: SaveToBoard.Model,
  /** Which of its pictures the page shows (`PieceSlides.ts`). */
  slides: PieceSlides.Model,
})
export type Model = typeof Model.Type

export const init = (pieceId: string): Model => ({
  pieceId,
  piece: AsyncData.Loading(),
  misses: 0,
  deletion: Deletion.Idle(),
  draft: Option.none(),
  redraw: Option.none(),
  choosing: Choosing.Idle(),
  turnWork: TurnWork.Idle(),
  turnShown: false,
  back: PieceBack.init(pieceId),
  photos: PiecePhotos.init(),
  looks: PieceLooks.init(pieceId),
  saveToBoard: SaveToBoard.init({ kind: 'piece', id: pieceId }),
  slides: PieceSlides.init,
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededGetPiece: { piece: Piece },
  FailedGetPiece: { error: LoadError },
  TickedPieceRefresh: {},
  ClickedRetry: {},
  ClickedDelete: {},
  ClickedCancelDelete: {},
  ClickedConfirmDelete: {},
  SucceededDeletePiece: {},
  FailedDeletePiece: {},
  ClickedEdit: {},
  ClickedCancelEdit: {},
  /** The name, the notes or the brand typed into the form. */
  UpdatedText: { field: DraftText, value: Schema.String },
  ChoseType: { type: PieceType },
  ToggledColour: { colour: Colour },
  ToggledWorn: { when: WornWhen },
  ToggledOccasion: { occasion: Occasion },
  ChosePattern: { pattern: Pattern },
  UpdatedCategory: { value: Schema.String },
  ChoseCategory: { type: PieceType, name: Schema.String },
  UpdatedShopUrl: { value: Schema.String },
  ClickedRotate: {},
  SubmittedEdit: {},
  SucceededUpdatePiece: { piece: Piece },
  GotBackMessage: { message: PieceBack.Message },
  GotPhotosMessage: { message: PiecePhotos.Message },
  GotLooksMessage: { message: PieceLooks.Message },
  FailedUpdatePiece: {},
  ClickedSlide: { slide: PieceSlides.Slide },
  PressedPicture: { x: Schema.Number, y: Schema.Number },
  ReleasedPicture: { x: Schema.Number, y: Schema.Number },
  ClickedShowPicture: { use: PictureChoice },
  SucceededChoosePicture: { piece: Piece },
  FailedChoosePicture: {},
  ClickedRedraw: {},
  ClickedCancelRedraw: {},
  UpdatedHint: { value: Schema.String },
  SubmittedRedraw: {},
  SucceededRedrawPicture: { picture: PiecePicture },
  FailedRedrawPicture: { problem: RedrawProblem, operationId: OperationId },
  ClickedMakeTurn: {},
  SucceededMakeTurn: { turn: PieceTurn },
  FailedMakeTurn: { problem: TurnProblem },
  SucceededBuildTurnSheet: { turn: PieceTurn },
  FailedBuildTurnSheet: {},
  ShowedTurn: {},
  GotSaveToBoardMessage: { message: SaveToBoard.Message },
})
export type Message = typeof Message.Type

/** Gone once deleted; Save to board's sheet asks the app for the person's boards. */
export const OutMessage = defineMessageUnion({ DeletedPiece: {}, RequestedBoards: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** A malformed id names no piece, so it is missing without asking. */
const pieceIdOf = (pieceId: string) => Schema.decodeUnknownEffect(PieceId)(pieceId)

export const GetPiece = Command.define('GetPiece', {
  args: { pieceId: Schema.String },
  messages: [Message.SucceededGetPiece, Message.FailedGetPiece],
  execute: ({ pieceId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const piece = yield* api.wardrobe.getPiece({ params: { pieceId: yield* pieceIdOf(pieceId) } })
      return Message.SucceededGetPiece({ piece })
    }).pipe(
      Effect.catchTags({
        NotFound: () => Effect.succeed(Message.FailedGetPiece({ error: 'NotFound' })),
        SchemaError: () => Effect.succeed(Message.FailedGetPiece({ error: 'NotFound' })),
      }),
      Effect.orElseSucceed(() => Message.FailedGetPiece({ error: 'Unavailable' })),
    ),
})

export const DeletePiece = Command.define('DeletePiece', {
  args: { pieceId: Schema.String },
  messages: [Message.SucceededDeletePiece, Message.FailedDeletePiece],
  execute: ({ pieceId }) =>
    Effect.gen(function* () {
      const params = { pieceId: yield* pieceIdOf(pieceId) }
      yield* (yield* (yield* StyldClient).api).wardrobe.deletePiece({
        params,
        payload: { operationId: yield* drawOperationId() },
      })
      return Message.SucceededDeletePiece()
    }).pipe(
      // A piece already gone is the outcome the person asked for.
      Effect.catchTag('NotFound', () => Effect.succeed(Message.SucceededDeletePiece())),
      Effect.orElseSucceed(() => Message.FailedDeletePiece()),
    ),
})

export const SavePiece = Command.define('SavePiece', {
  args: { pieceId: Schema.String, changes: PieceChanges },
  messages: [Message.SucceededUpdatePiece, Message.FailedUpdatePiece],
  execute: ({ pieceId, changes }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const piece = yield* api.wardrobe.updatePiece({
        params: { pieceId: yield* pieceIdOf(pieceId) },
        payload: { operationId: yield* drawOperationId(), ...changes },
      })
      return Message.SucceededUpdatePiece({ piece })
    }).pipe(Effect.orElseSucceed(() => Message.FailedUpdatePiece())),
})

export const ChoosePicture = Command.define('ChoosePicture', {
  args: { pieceId: Schema.String, use: PictureChoice },
  messages: [Message.SucceededChoosePicture, Message.FailedChoosePicture],
  execute: ({ pieceId, use }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const piece = yield* api.wardrobe.choosePicture({
        params: { pieceId: yield* pieceIdOf(pieceId) },
        payload: { operationId: yield* drawOperationId(), use },
      })
      return Message.SucceededChoosePicture({ piece })
    }).pipe(Effect.orElseSucceed(() => Message.FailedChoosePicture())),
})

export const RedrawPicture = Command.define('RedrawPicture', {
  args: { pieceId: Schema.String, hint: Schema.String, maybeOperationId: Schema.Option(OperationId) },
  messages: [Message.SucceededRedrawPicture, Message.FailedRedrawPicture],
  execute: ({ pieceId, hint, maybeOperationId }) =>
    Effect.gen(function* () {
      // A retry repeats the operation, so a lost answer never costs a second credit.
      const operationId = yield* drawOperationId(maybeOperationId)
      const words = hint.trim()
      const api = yield* (yield* StyldClient).api
      return yield* api.capture
        .redrawPicture({
          params: { pieceId: yield* pieceIdOf(pieceId) },
          payload: {
            operationId,
            ...(words.length === 0 ? {} : { hint: words.slice(0, textLength.hint) }),
          },
        })
        .pipe(
          Effect.map((picture) => Message.SucceededRedrawPicture({ picture })),
          Effect.catch((error) =>
            Effect.succeed(Message.FailedRedrawPicture({ problem: redrawProblemOf(error), operationId })),
          ),
        )
    }).pipe(Effect.orDie),
})

export const MakeTurn = Command.define('MakeTurn', {
  args: { pieceId: Schema.String },
  messages: [Message.SucceededMakeTurn, Message.FailedMakeTurn],
  execute: ({ pieceId }) =>
    Effect.gen(function* () {
      const operationId = yield* drawOperationId()
      const api = yield* (yield* StyldClient).api
      return yield* api.capture
        .makeTurn({ params: { pieceId: yield* pieceIdOf(pieceId) }, payload: { operationId } })
        .pipe(
          Effect.map((turn) => Message.SucceededMakeTurn({ turn })),
          Effect.catch((error) => Effect.succeed(Message.FailedMakeTurn({ problem: turnProblemOf(error) }))),
        )
    }).pipe(Effect.orElseSucceed(() => Message.FailedMakeTurn({ problem: 'network' }))),
})

/** Cut the turn's video into its frame sheet here, loading the video code only then, and hand the sheet to Styld.
 */
export const BuildTurnSheet = Command.define('BuildTurnSheet', {
  args: { pieceId: Schema.String, turn: PieceTurn },
  messages: [Message.SucceededBuildTurnSheet, Message.FailedBuildTurnSheet],
  execute: ({ pieceId, turn }) =>
    Effect.gen(function* () {
      const { buildSheet } = yield* Effect.tryPromise(() => import('../turn/BuildSheet.ts'))
      const client = yield* StyldClient
      const video = yield* client.readFile(cdn.turn(turn, 'video'))
      const front = yield* client.readFile(cdn.turn(turn, 'front'))
      const built = yield* buildSheet(new Blob([new Uint8Array(video)], { type: 'video/mp4' }), front)
      const payload = { operationId: yield* drawOperationId(), ...built }
      const result = yield* (yield* client.api).capture.turnSheet({
        params: { pieceId: yield* pieceIdOf(pieceId) },
        payload,
      })
      return Message.SucceededBuildTurnSheet({ turn: result })
    }).pipe(Effect.orElseSucceed(() => Message.FailedBuildTurnSheet())),
})

/** Play a ready turn on the canvas it is mounted on, loading the player only then. */
export const ShowTurn = Mount.define('ShowTurn', {
  args: { sheet: Schema.String, layout: TurnLayout },
  messages: [Message.ShowedTurn],
  execute: ({ element, sheet, layout }) =>
    Effect.tryPromise(() => import('../turn/Player.ts')).pipe(
      Effect.flatMap(({ playTurn }) =>
        element instanceof HTMLCanvasElement ? playTurn(element, sheet, layout) : Effect.void,
      ),
      Effect.ignore,
      Effect.as(Message.ShowedTurn()),
    ),
})

/** The Commands that open the page. */
export const load = (model: Model): ReadonlyArray<Command.Command<Message, never, StyldClient>> => [
  GetPiece({ pieceId: model.pieceId }),
  ...Command.mapMessages(PiecePhotos.load(model.pieceId), (message) => Message.GotPhotosMessage({ message })),
  ...Command.mapMessages(PieceLooks.load(model.pieceId), (message) => Message.GotLooksMessage({ message })),
]

// UPDATE

type Services = StyldClient | SecureRandom.SecureRandom | PictureEncoder
type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, Services>

/** Asking for the piece again unless a read is on its way. */
const pieceCache = (revalidate: (piece: PieceData) => Option.Option<PieceData>) => (model: Model) =>
  Update.refresh<Model, Message, Piece, LoadError, StyldClient>({
    read: (current: Model) => Option.some(current.piece),
    revalidate,
    write: (current: Model, piece: PieceData) => modifyFields(current, { piece: () => piece }),
    load: GetPiece({ pieceId: model.pieceId }),
  })(model)

const foldSaveToBoard = SaveToBoard.fold<Model, Message, OutMessage>(
  (message) => Message.GotSaveToBoardMessage({ message }),
  () => OutMessage.RequestedBoards(),
)

const foldBack = Update.foldChild({
  update: PieceBack.update,
  read: (model: Model) => Option.some(model.back),
  write: (model: Model, back: PieceBack.Model) => modifyFields(model, { back: () => back }),
  toParentMessage: (message: PieceBack.Message) => Message.GotBackMessage({ message }),
  foldOutMessage: PieceBack.OutMessage.match<Update.StepWithOutMessage<Model, Message, OutMessage, Services>>({
    ChangedPiece:
      ({ piece }) =>
      (stepModel) => ({
        model: modifyFields(stepModel, {
          piece: () => PieceData.Success({ data: piece }),
          slides: (slides) => PieceSlides.backChanged(slides, piece.hasBack),
        }),
      }),
  }),
})

const foldLooks = Update.foldChild({
  update: PieceLooks.update,
  ...PieceLooks.heldBy<Model, Message>((message) => Message.GotLooksMessage({ message })),
})

const editDraft = (model: Model, change: (draft: Draft) => Draft): UpdateReturn => ({
  model: modifyFields(model, {
    draft: Option.map((draft) =>
      modifyFields(change(draft), { save: (save) => (DraftSave.guards.Failed(save) ? DraftSave.Editing() : save) }),
    ),
  }),
})

const editDetails = (model: Model, change: (details: Details) => Details): UpdateReturn =>
  editDraft(model, (draft) => modifyFields(draft, { details: change }))

const submittedEdit = (model: Model): UpdateReturn =>
  Option.match(model.draft, {
    onNone: () => ({ model }),
    onSome: (draft) => {
      if (DraftSave.guards.Saving(draft.save)) return { model }
      // A shop link that is not an https address holds the form back: nothing is sent until it is.
      const sendable = shopUrlSendable(draft.shopUrl)
      const save = sendable ? DraftSave.Saving() : DraftSave.ShopUrlRefused()
      return {
        model: modifyFields(model, { draft: () => Option.some(modifyFields(draft, { save: () => save })) }),
        commands: sendable ? [SavePiece({ pieceId: model.pieceId, changes: changesOf(draft) })] : [],
      }
    },
  })

/** The piece as the server last answered it, a read's or a change's. The page's own work stays as it is, except that
 * a turn whose video is ready is cut into frames here, once. Following the piece while it settles is the
 * subscription's, not this answer's. */
const shown = (model: Model, piece: Piece): UpdateReturn => {
  const build = piece.turn?.state === 'building' && isTurnSettled(model.turnWork)
  const next = modifyFields(model, { piece: () => PieceData.Success({ data: piece }) })
  return build && piece.turn !== undefined
    ? {
        model: modifyFields(next, { turnWork: () => TurnWork.Building() }),
        commands: [BuildTurnSheet({ pieceId: piece.id, turn: piece.turn })],
      }
    : { model: next }
}

/** The piece shown, changed as an answer says; nothing while it has not been read. */
const shownWith = (model: Model, change: (piece: Piece) => Piece): UpdateReturn =>
  Option.match(AsyncData.getData(model.piece), {
    onNone: () => ({ model }),
    onSome: (piece) => shown(model, change(piece)),
  })

/** The loaded piece with its turn as the API last answered it. */
const withTurn = (model: Model, turn: PieceTurn): UpdateReturn =>
  shownWith(modifyFields(model, { turnWork: () => TurnWork.Idle() }), (piece) => ({ ...piece, turn }))

/** Nothing of the turn's is on its way from this page: none asked for, or the last try failed. */
const isTurnSettled = (turnWork: TurnWork) => TurnWork.guards.Idle(turnWork) || TurnWork.guards.Failed(turnWork)

const turnUpdates = (model: Model) => ({
  ClickedMakeTurn: (): UpdateReturn =>
    isTurnSettled(model.turnWork)
      ? {
          model: modifyFields(model, { turnWork: () => TurnWork.Asking() }),
          commands: [MakeTurn({ pieceId: model.pieceId })],
        }
      : { model },
  SucceededMakeTurn: ({ turn }: { readonly turn: PieceTurn }): UpdateReturn => withTurn(model, turn),
  FailedMakeTurn: ({ problem }: { readonly problem: TurnProblem }): UpdateReturn => ({
    model: modifyFields(model, { turnWork: () => TurnWork.Failed({ problem }) }),
  }),
  SucceededBuildTurnSheet: ({ turn }: { readonly turn: PieceTurn }): UpdateReturn => withTurn(model, turn),
  FailedBuildTurnSheet: (): UpdateReturn => ({
    model: modifyFields(model, { turnWork: () => TurnWork.Failed({ problem: 'build' }) }),
  }),
  ShowedTurn: (): UpdateReturn => ({ model: modifyFields(model, { turnShown: () => true }) }),
})

const editRedraw = (model: Model, change: (redraw: Redraw) => Redraw): UpdateReturn => ({
  model: modifyFields(model, { redraw: Option.map(change) }),
})

const submittedRedraw = (model: Model): UpdateReturn =>
  Option.match(model.redraw, {
    onNone: () => ({ model }),
    onSome: (redraw) => {
      if (RedrawSend.guards.Sending(redraw.send)) return { model }
      const maybeOperationId = RedrawSend.guards.Failed(redraw.send) ? redraw.send.maybeOperationId : Option.none()
      return {
        model: modifyFields(model, {
          redraw: () => Option.some(modifyFields(redraw, { send: () => RedrawSend.Sending() })),
        }),
        commands: [RedrawPicture({ pieceId: model.pieceId, hint: redraw.hint, maybeOperationId })],
      }
    },
  })

/** A drawing on its way: the piece shows its photo meanwhile, and the poll follows it until the drawing settles. */
const redrawing = (model: Model, picture: PiecePicture): UpdateReturn =>
  shownWith(modifyFields(model, { redraw: () => Option.none() }), (piece) => ({ ...piece, picture }))

/** The page's pictures after a tap or a swipe (`PieceSlides.ts`). */
const withSlides = (model: Model, change: (slides: PieceSlides.Model) => PieceSlides.Model): UpdateReturn => ({
  model: modifyFields(model, { slides: change }),
})

const pictureUpdates = (model: Model) => ({
  ClickedShowPicture: ({ use }: { readonly use: PictureChoice }): UpdateReturn =>
    Choosing.guards.Sending(model.choosing)
      ? { model }
      : {
          model: modifyFields(model, { choosing: () => Choosing.Sending() }),
          commands: [ChoosePicture({ pieceId: model.pieceId, use })],
        },
  SucceededChoosePicture: ({ piece }: { readonly piece: Piece }): UpdateReturn => ({
    model: modifyFields(model, { piece: () => PieceData.Success({ data: piece }), choosing: () => Choosing.Idle() }),
  }),
  FailedChoosePicture: (): UpdateReturn => ({ model: modifyFields(model, { choosing: () => Choosing.Failed() }) }),
  ClickedRedraw: (): UpdateReturn => ({
    model: modifyFields(model, {
      redraw: () => Option.some({ hint: '', send: RedrawSend.Writing() }),
    }),
  }),
  ClickedCancelRedraw: (): UpdateReturn => ({ model: modifyFields(model, { redraw: () => Option.none() }) }),
  UpdatedHint: ({ value }: { readonly value: string }): UpdateReturn =>
    editRedraw(model, (redraw) => modifyFields(redraw, { hint: () => value })),
  SubmittedRedraw: (): UpdateReturn => submittedRedraw(model),
  SucceededRedrawPicture: ({ picture }: { readonly picture: PiecePicture }): UpdateReturn => redrawing(model, picture),
  FailedRedrawPicture: ({
    problem,
    operationId,
  }: {
    readonly problem: RedrawProblem
    readonly operationId: OperationId
  }): UpdateReturn =>
    editRedraw(model, (redraw) =>
      modifyFields(redraw, {
        // A refusal answered the operation; only a lost answer is tried again as the same one.
        send: () =>
          RedrawSend.Failed({
            problem,
            maybeOperationId: problem === 'network' ? Option.some(operationId) : Option.none(),
          }),
      }),
    ),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    GotSaveToBoardMessage: (got) => foldSaveToBoard(model, got.message),
    SucceededGetPiece: ({ piece }) => shown(modifyFields(model, { misses: () => 0 }), piece),
    // A failed read keeps the piece shown.
    FailedGetPiece: ({ error }) => ({
      model: modifyFields(model, {
        piece: (piece) => AsyncData.settle(piece, Result.fail(error)),
        misses: Number.increment,
      }),
    }),
    TickedPieceRefresh: () => pieceCache(AsyncData.revalidate)(model),
    ClickedRetry: () => pieceCache(AsyncData.revalidateOrLoad)(modifyFields(model, { misses: () => 0 })),
    ClickedDelete: () =>
      Option.isSome(model.draft) && !DraftSave.guards.Saving(model.draft.value.save)
        ? { model: modifyFields(model, { deletion: () => Deletion.Confirming() }) }
        : { model },
    ClickedCancelDelete: () => ({ model: modifyFields(model, { deletion: () => Deletion.Idle() }) }),
    ClickedConfirmDelete: () =>
      !Deletion.guards.Confirming(model.deletion) && !Deletion.guards.Failed(model.deletion)
        ? { model }
        : {
            model: modifyFields(model, { deletion: () => Deletion.Deleting() }),
            commands: [DeletePiece({ pieceId: model.pieceId })],
          },
    SucceededDeletePiece: () => ({ model, outMessage: OutMessage.DeletedPiece() }),
    FailedDeletePiece: () => ({ model: modifyFields(model, { deletion: () => Deletion.Failed() }) }),
    ClickedEdit: () =>
      Option.match(AsyncData.getData(model.piece), {
        onNone: () => ({ model }),
        onSome: (piece) => ({ model: modifyFields(model, { draft: () => Option.some(draftOf(piece)) }) }),
      }),
    ClickedCancelEdit: () => ({ model: modifyFields(model, { draft: () => Option.none() }) }),
    UpdatedText: ({ field, value }) => editDraft(model, typedInto(field, value)),
    ChoseType: ({ type }) => editDetails(model, changeDetails.type(type)),
    ToggledColour: ({ colour }) => editDetails(model, changeDetails.colour(colour)),
    ToggledWorn: ({ when }) => editDetails(model, changeDetails.worn(when)),
    ToggledOccasion: ({ occasion }) => editDetails(model, changeDetails.occasion(occasion)),
    ChosePattern: ({ pattern }) => editDetails(model, changeDetails.pattern(pattern)),
    UpdatedCategory: ({ value }) => editDetails(model, changeDetails.category(value)),
    ChoseCategory: (category) => editDetails(model, changeDetails.chosenCategory(category)),
    UpdatedShopUrl: ({ value }) => editDraft(model, typedInto('shopUrl', value)),
    ClickedRotate: () => editDraft(model, (draft) => modifyFields(draft, { rotation: nextTurn })),
    SubmittedEdit: () => submittedEdit(model),
    SucceededUpdatePiece: ({ piece }) => ({
      model: modifyFields(model, { piece: () => PieceData.Success({ data: piece }), draft: () => Option.none() }),
    }),
    GotBackMessage: ({ message: backMessage }) => foldBack(model, backMessage),
    GotPhotosMessage: ({ message: photosMessage }) => ({
      model: modifyFields(model, { photos: (photos) => PiecePhotos.update(photos, photosMessage).model }),
    }),
    GotLooksMessage: (got) => foldLooks(model, got.message),
    FailedUpdatePiece: () => ({
      model: modifyFields(model, {
        draft: Option.map((draft) => modifyFields(draft, { save: () => DraftSave.Failed() })),
      }),
    }),
    ClickedSlide: ({ slide }) => withSlides(model, (slides) => PieceSlides.chose(slides, slide)),
    PressedPicture: ({ x, y }) => withSlides(model, (slides) => PieceSlides.pressed(slides, x, y)),
    ReleasedPicture: ({ x, y }) =>
      withSlides(model, (slides) => PieceSlides.released(slides, AsyncData.getData(model.piece), x, y)),
    ...pictureUpdates(model),
    ...turnUpdates(model),
  })

// SUBSCRIPTION

/** Whether the piece is still settling: processing, its clean picture being drawn, or its turn being made. */
const isSettling = (piece: Piece) =>
  piece.status === 'processing' || piece.picture?.state === 'drawing' || piece.turn?.state === 'making'

/** The piece is asked for again while it settles; the page's own work is left as it is. */
export const subscriptions = Subscription.make<Model, Message>()(() => ({
  pieceWhileSettling: pollWhilePending<Model, Message>({
    pendingIds: (model) =>
      Option.match(AsyncData.getData(model.piece), {
        onNone: (): ReadonlyArray<string> => [],
        onSome: (piece) => (isSettling(piece) ? [piece.id] : []),
      }),
    misses: (model) => model.misses,
    tick: Message.TickedPieceRefresh(),
  }),
}))
