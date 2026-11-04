import { drawOperationId } from '../OperationIds.ts'
import { Dialog } from '@foldkit/ui'
import { Board, BoardName, GarmentGroup, OperationId, PieceId, Season, Slot } from '@styld/protocol'
import { Effect, Option, Predicate, Schema } from 'effect'
import type * as SecureRandom from 'effect/crypto/SecureRandom'
import { Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// A new board starts from a template (Eva's review, F-26; owner 4 November 2026): + on Boards, or Start a board in Ask's
// sheet, opens this sheet instead of making a blank board. Blank makes one as before; "One piece, many outfits" (T-10)
// asks for a piece of the person's own and, if they like, a season, then makes the board with its outfits.

// MODEL

/** Where the sheet is: its two templates, or the piece and season of "One piece, many outfits". */
export const Step = defineTaggedUnion({ Templates: {}, Anchor: {} })
export type Step = typeof Step.Type

/** Why the board was not made: no complete outfit around the piece, too many asks at once, or it failed on the way. */
export const StartProblem = Schema.Literals(['noOutfits', 'slowDown', 'failed'])
export type StartProblem = typeof StartProblem.Type

/** Making the board, and why it was not made. A failure that may have reached Styld keeps its operation id, so asking
 * again for the same piece and season makes one board, not two. */
export const Making = defineTaggedUnion({
  Idle: {},
  Sending: {},
  Failed: { problem: StartProblem, missing: Schema.Array(Slot), operationId: Schema.Option(OperationId) },
})
export type Making = typeof Making.Type

export const Model = Schema.Struct({
  sheet: Dialog.Model,
  step: Step,
  maybeGroup: Schema.Option(GarmentGroup),
  maybeAnchor: Schema.Option(PieceId),
  maybeSeason: Schema.Option(Season),
  making: Making,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  sheet: Dialog.init({ id: 'board-start', isAnimated: true }),
  step: Step.Templates(),
  maybeGroup: Option.none(),
  maybeAnchor: Option.none(),
  maybeSeason: Option.none(),
  making: Making.Idle(),
})

// MESSAGE

export const Message = defineMessageUnion({
  GotSheetMessage: { message: Dialog.Message },
  ClickedBlank: { defaultName: Schema.String },
  ClickedOutfitsTemplate: {},
  ClickedTemplates: {},
  SelectedGroup: { group: Schema.Option(GarmentGroup) },
  SelectedAnchor: { pieceId: PieceId },
  SelectedSeason: { season: Schema.Option(Season) },
  SubmittedOutfits: { name: Schema.String },
  SucceededCreateOutfitBoard: { board: Board },
  FailedCreateOutfitBoard: {
    problem: StartProblem,
    missing: Schema.Array(Slot),
    operationId: Schema.Option(OperationId),
  },
})
export type Message = typeof Message.Type

/** Blank was chosen (Boards makes it as before), the person's pieces are wanted for choosing one, or the outfit board
 * was made and opens. */
export const OutMessage = defineMessageUnion({
  ChoseBlank: { defaultName: Schema.String },
  RequestedPieces: {},
  CreatedBoard: { boardId: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** Why the board was not made, and what the wardrobe lacks when that is why. */
const failureOf = (error: unknown): { readonly problem: StartProblem; readonly missing: ReadonlyArray<Slot> } => {
  if (Predicate.isTagged(error, 'OutfitRefused')) {
    const missing = Predicate.hasProperty(error, 'missing')
      ? Schema.decodeUnknownOption(Schema.Array(Slot))(error.missing)
      : Option.none()
    return { problem: 'noOutfits', missing: Option.getOrElse(missing, () => []) }
  }
  return { problem: Predicate.isTagged(error, 'SlowDown') ? 'slowDown' : 'failed', missing: [] }
}

/** Make a "One piece, many outfits" board around the piece, for the season when one is chosen. */
export const CreateOutfitBoard = Command.define('CreateOutfitBoard', {
  args: {
    name: Schema.String,
    anchorPieceId: PieceId,
    maybeSeason: Schema.Option(Season),
    maybeOperationId: Schema.Option(OperationId),
  },
  messages: [Message.SucceededCreateOutfitBoard, Message.FailedCreateOutfitBoard],
  execute: ({ name, anchorPieceId, maybeSeason, maybeOperationId }) =>
    Effect.gen(function* () {
      const operationId = yield* drawOperationId(maybeOperationId)
      return yield* Effect.gen(function* () {
        const api = yield* (yield* StyldClient).api
        const board = yield* api.board.createOutfitBoard({
          payload: {
            operationId,
            name: yield* Schema.decodeUnknownEffect(BoardName)(name),
            anchorPieceId,
            ...Option.match(maybeSeason, { onNone: () => ({}), onSome: (season) => ({ season }) }),
          },
        })
        return Message.SucceededCreateOutfitBoard({ board })
      }).pipe(
        Effect.catch((error) => {
          const { problem, missing } = failureOf(error)
          return Effect.succeed(
            Message.FailedCreateOutfitBoard({
              problem,
              missing,
              operationId: problem === 'failed' ? Option.some(operationId) : Option.none(),
            }),
          )
        }),
      )
    }).pipe(
      Effect.orElseSucceed(() =>
        Message.FailedCreateOutfitBoard({ problem: 'failed', missing: [], operationId: Option.none() }),
      ),
    ),
})

// UPDATE

type Services = StyldClient | SecureRandom.SecureRandom
type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, Services>
type Step_ = Update.StepWithOutMessage<Model, Message, OutMessage, Services>

const sheetFold = {
  read: (model: Model) => Option.some(model.sheet),
  write: (model: Model, sheet: Dialog.Model) => modifyFields(model, { sheet: () => sheet }),
  toParentMessage: (message: Dialog.Message) => Message.GotSheetMessage({ message }),
  foldOutMessage: Dialog.OutMessage.match<Step_>({
    Opened: () => (model) => ({ model }),
    Closed: () => (model) => ({ model }),
  }),
}
const foldSheet = Update.foldChild({ update: Dialog.update, ...sheetFold })
const openSheet = Update.foldChildStep({ update: Dialog.open, ...sheetFold })
const closeSheet = Update.foldChildStep({ update: Dialog.close, ...sheetFold })

/** Open the sheet on its templates, as a new start: + on Boards, or Start a board from Ask. */
export const open = (model: Model): UpdateReturn =>
  openSheet(modifyFields(model, { step: () => Step.Templates(), making: () => Making.Idle() }))

/** Another piece or season is another board: a kept operation id no longer fits it. */
const chosen = (model: Model, change: Partial<Pick<Model, 'maybeAnchor' | 'maybeSeason'>>): UpdateReturn => ({
  model: modifyFields(model, {
    maybeAnchor: (anchor) => change.maybeAnchor ?? anchor,
    maybeSeason: (season) => change.maybeSeason ?? season,
    making: (making) => (Making.guards.Sending(making) ? making : Making.Idle()),
  }),
})

const submitted = (model: Model, name: string): UpdateReturn =>
  Option.match(model.maybeAnchor, {
    onNone: () => ({ model }),
    onSome: (anchorPieceId) =>
      Making.guards.Sending(model.making)
        ? { model }
        : {
            model: modifyFields(model, { making: () => Making.Sending() }),
            commands: [
              CreateOutfitBoard({
                name,
                anchorPieceId,
                maybeSeason: model.maybeSeason,
                maybeOperationId: Making.guards.Failed(model.making) ? model.making.operationId : Option.none(),
              }),
            ],
          },
  })

/** Close the sheet, and tell Boards what happened. */
const closedWith = (model: Model, outMessage: OutMessage): UpdateReturn => {
  const closed = closeSheet(model)
  return { model: closed.model, commands: closed.commands ?? [], outMessage }
}

const created = (model: Model, board: Board): UpdateReturn =>
  closedWith(
    modifyFields(model, { making: () => Making.Idle(), maybeAnchor: () => Option.none() }),
    OutMessage.CreatedBoard({ boardId: board.id }),
  )

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    GotSheetMessage: (got) => foldSheet(model, got.message),
    ClickedBlank: ({ defaultName }) => closedWith(model, OutMessage.ChoseBlank({ defaultName })),
    ClickedOutfitsTemplate: () => ({
      model: modifyFields(model, { step: () => Step.Anchor() }),
      outMessage: OutMessage.RequestedPieces(),
    }),
    ClickedTemplates: () => ({ model: modifyFields(model, { step: () => Step.Templates() }) }),
    SelectedGroup: ({ group }) => ({ model: modifyFields(model, { maybeGroup: () => group }) }),
    SelectedAnchor: ({ pieceId }) => chosen(model, { maybeAnchor: Option.some(pieceId) }),
    SelectedSeason: ({ season }) => chosen(model, { maybeSeason: season }),
    SubmittedOutfits: ({ name }) => submitted(model, name),
    SucceededCreateOutfitBoard: ({ board }) => created(model, board),
    FailedCreateOutfitBoard: ({ problem, missing, operationId }) => ({
      model: modifyFields(model, { making: () => Making.Failed({ problem, missing, operationId }) }),
    }),
  })
