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
  Season,
  ShopUrl,
  TurnLayout,
  UpdatePiece,
} from '@styld/protocol'
import { Duration, Effect, Option, Predicate, Schema } from 'effect'
import { Command, Mount, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'
import * as PieceBack from './PieceBack.ts'
import { changeDetails, Details, detailsOf } from './PieceFields.ts'
import * as SaveToBoard from './SaveToBoard.ts'
import * as Crypto from 'effect/Crypto'

// MODEL

export const Load = defineTaggedUnion({
  Loading: {},
  Loaded: { piece: Piece },
  Missing: {},
  Failed: {},
})

export const Deletion = defineTaggedUnion({ Idle: {}, Confirming: {}, Deleting: {}, Failed: {} })

/** The edit form's values; nothing reaches the piece until it is saved. */
export const Draft = Schema.Struct({
  name: Schema.String,
  notes: Schema.String,
  details: Details,
  brand: Schema.String,
  shopUrl: Schema.String,
  saving: Schema.Boolean,
  failed: Schema.Boolean,
  /** The shop link is not an https address: nothing is sent until it is. */
  shopUrlInvalid: Schema.Boolean,
})
export type Draft = typeof Draft.Type

/** Why a redraw was not asked for: the API's refusals, the day's credits, or no answer. */
export const RedrawProblem = Schema.Literals(['busy', 'face', 'photo', 'off', 'dailyLimit', 'network'])
export type RedrawProblem = typeof RedrawProblem.Type

/** The owner asking for a new drawing: their words about the piece, and the operation a retry repeats. */
export const Redraw = Schema.Struct({
  hint: Schema.String,
  sending: Schema.Boolean,
  problem: Schema.Option(RedrawProblem),
  operationId: Schema.Option(Schema.String),
})
export type Redraw = typeof Redraw.Type

/** Why a turn was not made: the API's refusals, the day's credits, no answer, or a device that could not cut the
 * turn's video into frames. */
export const TurnProblem = Schema.Literals(['busy', 'picture', 'off', 'dailyLimit', 'network', 'build'])
export type TurnProblem = typeof TurnProblem.Type

export const Model = Schema.Struct({
  pieceId: Schema.String,
  load: Load,
  deletion: Deletion,
  draft: Schema.Option(Draft),
  redraw: Schema.Option(Redraw),
  /** Whether a change of the picture shown is on its way, or failed. */
  choosing: Schema.Literals(['idle', 'sending', 'failed']),
  /** The turn this page is asking for, or building the frames of. */
  turnWork: Schema.Literals(['idle', 'asking', 'building']),
  turnProblem: Schema.Option(TurnProblem),
  back: PieceBack.Model,
  /** Whether the turn's player has drawn its first frame; until then the still shows under it. */
  turnShown: Schema.Boolean,
  saveToBoard: SaveToBoard.Model,
})
export type Model = typeof Model.Type

export const init = (pieceId: string): Model => ({
  pieceId,
  load: Load.Loading(),
  deletion: Deletion.Idle(),
  draft: Option.none(),
  redraw: Option.none(),
  choosing: 'idle',
  turnWork: 'idle',
  turnShown: false,
  turnProblem: Option.none(),
  back: PieceBack.init(pieceId),
  saveToBoard: SaveToBoard.init({ kind: 'piece', id: pieceId }),
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededGetPiece: { piece: Piece },
  FailedGetPiece: { missing: Schema.Boolean },
  ElapsedRefreshPause: {},
  ClickedRetry: {},
  ClickedDelete: {},
  ClickedCancelDelete: {},
  ClickedConfirmDelete: {},
  SucceededDeletePiece: {},
  FailedDeletePiece: {},
  ClickedEdit: {},
  ClickedCancelEdit: {},
  UpdatedName: { value: Schema.String },
  UpdatedNotes: { value: Schema.String },
  ChoseType: { type: PieceType },
  ToggledColour: { colour: Colour },
  ChoseSeason: { season: Season },
  ToggledOccasion: { occasion: Occasion },
  ChosePattern: { pattern: Pattern },
  UpdatedBrand: { value: Schema.String },
  UpdatedShopUrl: { value: Schema.String },
  SubmittedEdit: {},
  SucceededUpdatePiece: { piece: Piece },
  GotBackMessage: { message: PieceBack.Message },
  FailedUpdatePiece: {},
  ClickedShowPicture: { use: PictureChoice },
  SucceededChoosePicture: { piece: Piece },
  FailedChoosePicture: {},
  ClickedRedraw: {},
  ClickedCancelRedraw: {},
  UpdatedHint: { value: Schema.String },
  SubmittedRedraw: {},
  SucceededRedrawPicture: { picture: PiecePicture },
  FailedRedrawPicture: { problem: RedrawProblem, operationId: Schema.String },
  ClickedMakeTurn: {},
  SucceededMakeTurn: { turn: PieceTurn },
  FailedMakeTurn: { problem: TurnProblem },
  SucceededBuildTurnSheet: { turn: PieceTurn },
  FailedBuildTurnSheet: {},
  ShowedTurn: {},
  GotSaveToBoardMessage: { message: SaveToBoard.Message },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({ DeletedPiece: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

const refreshPause = Duration.seconds(2)

/** A malformed id names no piece, so it is missing without asking. */
const pieceIdOf = (pieceId: string) => Schema.decodeUnknownEffect(PieceId)(pieceId)

/** @internal Exported for its tests. */
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
        PieceNotFound: () => Effect.succeed(Message.FailedGetPiece({ missing: true })),
        SchemaError: () => Effect.succeed(Message.FailedGetPiece({ missing: true })),
      }),
      Effect.orElseSucceed(() => Message.FailedGetPiece({ missing: false })),
    ),
})

/** @internal Exported for its tests. */
export const WaitToRefreshPiece = Command.define('WaitToRefreshPiece', {
  messages: [Message.ElapsedRefreshPause],
  execute: Effect.sleep(refreshPause).pipe(Effect.as(Message.ElapsedRefreshPause())),
})

/** @internal Exported for its tests. */
export const DeletePiece = Command.define('DeletePiece', {
  args: { pieceId: Schema.String },
  messages: [Message.SucceededDeletePiece, Message.FailedDeletePiece],
  execute: ({ pieceId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      yield* api.wardrobe.deletePiece({ params: { pieceId: yield* pieceIdOf(pieceId) } })
      return Message.SucceededDeletePiece()
    }).pipe(
      // A piece already gone is the outcome the person asked for.
      Effect.catchTag('PieceNotFound', () => Effect.succeed(Message.SucceededDeletePiece())),
      Effect.orElseSucceed(() => Message.FailedDeletePiece()),
    ),
})

/** @internal Exported for its tests. */
export const SavePiece = Command.define('SavePiece', {
  args: { pieceId: Schema.String, changes: UpdatePiece },
  messages: [Message.SucceededUpdatePiece, Message.FailedUpdatePiece],
  execute: ({ pieceId, changes }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const piece = yield* api.wardrobe.updatePiece({
        params: { pieceId: yield* pieceIdOf(pieceId) },
        payload: changes,
      })
      return Message.SucceededUpdatePiece({ piece })
    }).pipe(Effect.orElseSucceed(() => Message.FailedUpdatePiece())),
})

/** @internal Exported for its tests. */
export const ChoosePicture = Command.define('ChoosePicture', {
  args: { pieceId: Schema.String, use: PictureChoice },
  messages: [Message.SucceededChoosePicture, Message.FailedChoosePicture],
  execute: ({ pieceId, use }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const piece = yield* api.wardrobe.choosePicture({
        params: { pieceId: yield* pieceIdOf(pieceId) },
        payload: { use },
      })
      return Message.SucceededChoosePicture({ piece })
    }).pipe(Effect.orElseSucceed(() => Message.FailedChoosePicture())),
})

/** What a refused redraw means for the owner. */
const redrawProblemOf = (error: unknown): RedrawProblem => {
  if (Predicate.isTagged(error, 'DailyLimitReached')) return 'dailyLimit'
  if (Predicate.isTagged(error, 'PictureRefused') && Predicate.hasProperty(error, 'reason'))
    return Schema.decodeUnknownOption(RedrawProblem)(error.reason).pipe(Option.getOrElse(() => 'network' as const))
  return 'network'
}

/** @internal Exported for its tests. */
export const RedrawPicture = Command.define('RedrawPicture', {
  args: { pieceId: Schema.String, hint: Schema.String, operationId: Schema.Option(Schema.String) },
  messages: [Message.SucceededRedrawPicture, Message.FailedRedrawPicture],
  execute: ({ pieceId, hint, operationId }) =>
    Effect.gen(function* () {
      // A retry repeats the operation, so a lost answer never costs a second credit.
      const id = Option.isSome(operationId) ? operationId.value : yield* (yield* Crypto.Crypto).randomUUIDv4()
      const words = hint.trim()
      const api = yield* (yield* StyldClient).api
      return yield* api.capture
        .redrawPicture({
          params: { pieceId: yield* pieceIdOf(pieceId) },
          payload: {
            operationId: yield* Schema.decodeUnknownEffect(OperationId)(id),
            ...(words.length === 0 ? {} : { hint: words.slice(0, 80) }),
          },
        })
        .pipe(
          Effect.map((picture) => Message.SucceededRedrawPicture({ picture })),
          Effect.catch((error) =>
            Effect.succeed(Message.FailedRedrawPicture({ problem: redrawProblemOf(error), operationId: id })),
          ),
        )
    }).pipe(Effect.orDie),
})

/** What a refused turn means for the owner. */
const turnProblemOf = (error: unknown): TurnProblem => {
  if (Predicate.isTagged(error, 'DailyLimitReached')) return 'dailyLimit'
  if (Predicate.isTagged(error, 'TurnRefused') && Predicate.hasProperty(error, 'reason'))
    return Schema.decodeUnknownOption(TurnProblem)(error.reason).pipe(Option.getOrElse(() => 'network' as const))
  return 'network'
}

/** @internal Exported for its tests. */
export const MakeTurn = Command.define('MakeTurn', {
  args: { pieceId: Schema.String },
  messages: [Message.SucceededMakeTurn, Message.FailedMakeTurn],
  execute: ({ pieceId }) =>
    Effect.gen(function* () {
      const operationId = yield* Schema.decodeUnknownEffect(OperationId)(yield* (yield* Crypto.Crypto).randomUUIDv4())
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
 * @internal Exported for its tests. */
export const BuildTurnSheet = Command.define('BuildTurnSheet', {
  args: { pieceId: Schema.String, version: Schema.Number },
  messages: [Message.SucceededBuildTurnSheet, Message.FailedBuildTurnSheet],
  execute: ({ pieceId, version }) =>
    Effect.gen(function* () {
      const { buildSheet } = yield* Effect.tryPromise(() => import('../turn/BuildSheet.ts'))
      const client = yield* StyldClient
      const video = yield* client.readFile(`/cdn/turns/${pieceId}/video?v=${version}`)
      const front = yield* client.readFile(`/cdn/turns/${pieceId}/front?v=${version}`)
      const built = yield* buildSheet(new Blob([new Uint8Array(video)], { type: 'video/mp4' }), front)
      const api = yield* client.api
      const turn = yield* api.capture.turnSheet({ params: { pieceId: yield* pieceIdOf(pieceId) }, payload: built })
      return Message.SucceededBuildTurnSheet({ turn })
    }).pipe(Effect.orElseSucceed(() => Message.FailedBuildTurnSheet())),
})

/** Play a ready turn on the canvas it is mounted on, loading the player only then. */
export const ShowTurn = Mount.define('ShowTurn', {
  args: { pieceId: Schema.String, version: Schema.Number, layout: TurnLayout },
  messages: [Message.ShowedTurn],
  execute: ({ element, pieceId, version, layout }) =>
    Effect.tryPromise(() => import('../turn/Player.ts')).pipe(
      Effect.flatMap(({ playTurn }) =>
        element instanceof HTMLCanvasElement
          ? playTurn(element, `/cdn/turns/${pieceId}/sheet?v=${version}`, layout)
          : Effect.void,
      ),
      Effect.ignore,
      Effect.as(Message.ShowedTurn()),
    ),
})

/** The Commands that open the page. */
export const load = (model: Model) => [GetPiece({ pieceId: model.pieceId })]

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | Crypto.Crypto>

const foldSaveToBoard = SaveToBoard.foldInto<Model, Message>((message) => Message.GotSaveToBoardMessage({ message }))

const foldBack = Update.foldChild({
  update: PieceBack.update,
  read: (model: Model) => Option.some(model.back),
  write: (model: Model, back: PieceBack.Model) => modifyFields(model, { back: () => back }),
  toParentMessage: (message: PieceBack.Message) => Message.GotBackMessage({ message }),
  foldOutMessage: PieceBack.OutMessage.match<
    Update.StepWithOutMessage<Model, Message, OutMessage, StyldClient | Crypto.Crypto>
  >({
    ChangedPiece:
      ({ piece }) =>
      (stepModel) => ({ model: modifyFields(stepModel, { load: () => Load.Loaded({ piece }) }) }),
  }),
})

const draftOf = (piece: Piece): Draft => ({
  name: piece.name ?? '',
  notes: piece.notes ?? '',
  details: detailsOf(piece),
  brand: piece.brand ?? '',
  shopUrl: piece.shopUrl ?? '',
  saving: false,
  failed: false,
  shopUrlInvalid: false,
})

/** Words left empty, spaces aside, are no value. */
const given = (value: string) => {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/** The saved form, as the API takes it: an empty field is no value, and an attribute left unchosen is cleared. */
const changesOf = (draft: Draft): typeof UpdatePiece.Type => ({
  name: given(draft.name),
  notes: given(draft.notes),
  ...Option.match(draft.details.type, { onNone: () => ({}), onSome: (type) => ({ type }) }),
  colours: draft.details.colours,
  season: Option.getOrNull(draft.details.season),
  occasions: draft.details.occasions,
  pattern: Option.getOrNull(draft.details.pattern),
  brand: given(draft.brand),
  shopUrl: given(draft.shopUrl),
})

const isShopUrl = Schema.is(ShopUrl)

const editDraft = (model: Model, change: (draft: Draft) => Draft): UpdateReturn => ({
  model: modifyFields(model, {
    draft: Option.map((draft) => modifyFields(change(draft), { failed: () => false })),
  }),
})

const editDetails = (model: Model, change: (details: Details) => Details): UpdateReturn =>
  editDraft(model, (draft) => modifyFields(draft, { details: change }))

const submittedEdit = (model: Model): UpdateReturn =>
  Option.match(model.draft, {
    onNone: () => ({ model }),
    onSome: (draft) =>
      draft.saving
        ? { model }
        : !(draft.shopUrl.trim() === '' || isShopUrl(draft.shopUrl.trim()))
          ? {
              model: modifyFields(model, {
                draft: () => Option.some(modifyFields(draft, { shopUrlInvalid: () => true })),
              }),
            }
          : {
              model: modifyFields(model, { draft: () => Option.some(modifyFields(draft, { saving: () => true })) }),
              commands: [SavePiece({ pieceId: model.pieceId, changes: changesOf(draft) })],
            },
  })

/** A piece still processing, or with a drawing or a turn on its way, is asked for again until it settles; a turn
 * whose video is ready is cut into frames here, once. */
const loaded = (model: Model, piece: Piece): UpdateReturn => {
  const waiting = piece.status === 'processing' || piece.picture?.state === 'drawing' || piece.turn?.state === 'making'
  const build = piece.turn?.state === 'building' && model.turnWork === 'idle'
  return {
    model: modifyFields(model, {
      load: () => Load.Loaded({ piece }),
      turnWork: (work) => (build ? 'building' : work),
    }),
    commands: [
      ...(waiting ? [WaitToRefreshPiece()] : []),
      ...(build && piece.turn !== undefined
        ? [BuildTurnSheet({ pieceId: piece.id, version: piece.turn.version })]
        : []),
    ],
  }
}

/** The loaded piece with its turn as the API last answered it. */
const withTurn = (model: Model, turn: PieceTurn): UpdateReturn => {
  const shown = model.load
  const settled = modifyFields(model, { turnWork: () => 'idle' as const })
  return Load.guards.Loaded(shown) ? loaded(settled, { ...shown.piece, turn }) : { model: settled }
}

const turnUpdates = (model: Model) => ({
  ClickedMakeTurn: (): UpdateReturn =>
    model.turnWork === 'idle'
      ? {
          model: modifyFields(model, { turnWork: () => 'asking' as const, turnProblem: () => Option.none() }),
          commands: [MakeTurn({ pieceId: model.pieceId })],
        }
      : { model },
  SucceededMakeTurn: ({ turn }: { readonly turn: PieceTurn }): UpdateReturn => withTurn(model, turn),
  FailedMakeTurn: ({ problem }: { readonly problem: TurnProblem }): UpdateReturn => ({
    model: modifyFields(model, { turnWork: () => 'idle' as const, turnProblem: () => Option.some(problem) }),
  }),
  SucceededBuildTurnSheet: ({ turn }: { readonly turn: PieceTurn }): UpdateReturn => withTurn(model, turn),
  FailedBuildTurnSheet: (): UpdateReturn => ({
    model: modifyFields(model, { turnWork: () => 'idle' as const, turnProblem: () => Option.some('build' as const) }),
  }),
  ShowedTurn: (): UpdateReturn => ({ model: modifyFields(model, { turnShown: () => true }) }),
})

const editRedraw = (model: Model, change: (redraw: Redraw) => Redraw): UpdateReturn => ({
  model: modifyFields(model, { redraw: Option.map(change) }),
})

const submittedRedraw = (model: Model): UpdateReturn =>
  Option.match(model.redraw, {
    onNone: () => ({ model }),
    onSome: (redraw) =>
      redraw.sending
        ? { model }
        : {
            model: modifyFields(model, {
              redraw: () => Option.some(modifyFields(redraw, { sending: () => true, problem: () => Option.none() })),
            }),
            commands: [RedrawPicture({ pieceId: model.pieceId, hint: redraw.hint, operationId: redraw.operationId })],
          },
  })

/** A drawing on its way: the piece shows its photo meanwhile and is asked for again until the drawing settles. */
const redrawing = (model: Model, picture: PiecePicture): UpdateReturn => {
  const shown = model.load
  if (!Load.guards.Loaded(shown)) return { model: modifyFields(model, { redraw: () => Option.none() }) }
  return loaded(modifyFields(model, { redraw: () => Option.none() }), { ...shown.piece, picture })
}

const pictureUpdates = (model: Model) => ({
  ClickedShowPicture: ({ use }: { readonly use: PictureChoice }): UpdateReturn =>
    model.choosing === 'sending'
      ? { model }
      : {
          model: modifyFields(model, { choosing: () => 'sending' as const }),
          commands: [ChoosePicture({ pieceId: model.pieceId, use })],
        },
  SucceededChoosePicture: ({ piece }: { readonly piece: Piece }): UpdateReturn => ({
    model: modifyFields(model, { load: () => Load.Loaded({ piece }), choosing: () => 'idle' as const }),
  }),
  FailedChoosePicture: (): UpdateReturn => ({ model: modifyFields(model, { choosing: () => 'failed' as const }) }),
  ClickedRedraw: (): UpdateReturn => ({
    model: modifyFields(model, {
      redraw: () => Option.some({ hint: '', sending: false, problem: Option.none(), operationId: Option.none() }),
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
    readonly operationId: string
  }): UpdateReturn =>
    editRedraw(model, (redraw) =>
      modifyFields(redraw, {
        sending: () => false,
        problem: () => Option.some(problem),
        // A refusal answered the operation; only a lost answer is tried again as the same one.
        operationId: () => (problem === 'network' ? Option.some(operationId) : Option.none()),
      }),
    ),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    GotSaveToBoardMessage: (got) => foldSaveToBoard(model, got.message),
    SucceededGetPiece: ({ piece }) => loaded(model, piece),
    FailedGetPiece: ({ missing }) =>
      Load.guards.Loaded(model.load)
        ? { model }
        : { model: modifyFields(model, { load: () => (missing ? Load.Missing() : Load.Failed()) }) },
    ElapsedRefreshPause: () => ({ model, commands: [GetPiece({ pieceId: model.pieceId })] }),
    ClickedRetry: () => ({
      model: modifyFields(model, { load: () => Load.Loading() }),
      commands: [GetPiece({ pieceId: model.pieceId })],
    }),
    ClickedDelete: () => ({ model: modifyFields(model, { deletion: () => Deletion.Confirming() }) }),
    ClickedCancelDelete: () => ({ model: modifyFields(model, { deletion: () => Deletion.Idle() }) }),
    ClickedConfirmDelete: () =>
      Deletion.guards.Deleting(model.deletion)
        ? { model }
        : {
            model: modifyFields(model, { deletion: () => Deletion.Deleting() }),
            commands: [DeletePiece({ pieceId: model.pieceId })],
          },
    SucceededDeletePiece: () => ({ model, outMessage: OutMessage.DeletedPiece() }),
    FailedDeletePiece: () => ({ model: modifyFields(model, { deletion: () => Deletion.Failed() }) }),
    ClickedEdit: () => {
      const shown = model.load
      return Load.guards.Loaded(shown)
        ? { model: modifyFields(model, { draft: () => Option.some(draftOf(shown.piece)) }) }
        : { model }
    },
    ClickedCancelEdit: () => ({ model: modifyFields(model, { draft: () => Option.none() }) }),
    UpdatedName: ({ value }) => editDraft(model, (draft) => modifyFields(draft, { name: () => value })),
    UpdatedNotes: ({ value }) => editDraft(model, (draft) => modifyFields(draft, { notes: () => value })),
    ChoseType: ({ type }) => editDetails(model, changeDetails.type(type)),
    ToggledColour: ({ colour }) => editDetails(model, changeDetails.colour(colour)),
    ChoseSeason: ({ season }) => editDetails(model, changeDetails.season(season)),
    ToggledOccasion: ({ occasion }) => editDetails(model, changeDetails.occasion(occasion)),
    ChosePattern: ({ pattern }) => editDetails(model, changeDetails.pattern(pattern)),
    UpdatedBrand: ({ value }) => editDraft(model, (draft) => modifyFields(draft, { brand: () => value })),
    UpdatedShopUrl: ({ value }) =>
      editDraft(model, (draft) => modifyFields(draft, { shopUrl: () => value, shopUrlInvalid: () => false })),
    SubmittedEdit: () => submittedEdit(model),
    SucceededUpdatePiece: ({ piece }) => ({
      model: modifyFields(model, { load: () => Load.Loaded({ piece }), draft: () => Option.none() }),
    }),
    GotBackMessage: ({ message: backMessage }) => foldBack(model, backMessage),
    FailedUpdatePiece: () => ({
      model: modifyFields(model, {
        draft: Option.map((draft) => modifyFields(draft, { saving: () => false, failed: () => true })),
      }),
    }),
    ...pictureUpdates(model),
    ...turnUpdates(model),
  })
