import { groupOf, OperationId, type Piece, PieceId, Season, Slot, slotOf } from '@styld/protocol'
import { Array, Effect, Match, Option, Schema } from 'effect'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import { Command, Dom, Mount, Update } from 'foldkit'
import { DEVTOOLS_HOST_ID } from 'foldkit/devtools-host'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { load } from 'foldkit/navigation'
import { modifyFields } from 'foldkit/struct'
import { boardRouter } from '../route.ts'
import type { StyldClient } from '../StyldClient.ts'
import { CreateOutfitBoard, Making, StartProblem, type Message as StartMessage } from './BoardStart.ts'
import { Resume, SaveTo, type Message as SaveMessage } from './SaveToBoard.ts'

// "What to wear today" (Eva's sketch, owner 4 November): a wheel of the person's pieces turns over the whole screen
// and stops on one, today's pick, from which they build. Free, and spun again as often as they like. v1 had the same
// wheel (OU-11); this one draws afresh each spin.

// MODEL

/** The pieces on the wheel at once; fewer pieces repeat round it. */
export const wheelSize = 12

/** The screen: shut, drawing a piece, the wheel turning to it, or the piece drawn. Each opening or spin is a round,
 * so an answer from an earlier one changes nothing. */
export const Stage = defineTaggedUnion({
  Closed: {},
  Drawing: { round: Schema.Int },
  Turning: { round: Schema.Int, slots: Schema.Array(PieceId), landing: Schema.Int },
  Landed: { round: Schema.Int, slots: Schema.Array(PieceId), landing: Schema.Int },
})
export type Stage = typeof Stage.Type

/** Build my own: a board with the drawn piece on its table, on its way, or failed with what a try again resumes. */
export const Building = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: { resume: Resume } })
export type Building = typeof Building.Type

export const Model = Schema.Struct({
  stage: Stage,
  /** Make outfits with it: the "One piece, many outfits" board around the drawn piece, as the new-board sheet makes
   * it. */
  making: Making,
  building: Building,
  round: Schema.Int,
  /** The pieces a spin may land on, as the button found them when it was tapped. */
  pool: Schema.Array(PieceId),
  /** The season of the day, for a board of outfits made around the piece. */
  maybeSeason: Schema.Option(Season),
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  stage: Stage.Closed(),
  making: Making.Idle(),
  building: Building.Idle(),
  round: 0,
  pool: [],
  maybeSeason: Option.none(),
})

/** A piece the wheel may land on: ready with a picture, and something to build a day around (nothing made for sport,
 * no swimwear or loungewear, no socks). */
const drawable = (piece: Piece) =>
  piece.status === 'ready' &&
  piece.images !== undefined &&
  groupOf(piece.type) !== 'sport' &&
  slotOf(piece.type) !== 'set' &&
  piece.type !== 'socks'

/** The pieces a spin may land on: those that suit the day's season (a piece without seasons suits them all), or every
 * drawable piece when none does. */
export const tombolaPool = (pieces: ReadonlyArray<Piece>, maybeSeason: Option.Option<Season>): Array<PieceId> => {
  const candidates = pieces.filter(drawable)
  const inSeason = Option.match(maybeSeason, {
    onNone: () => candidates,
    onSome: (season) => candidates.filter((piece) => piece.seasons.length === 0 || piece.seasons.includes(season)),
  })
  return (inSeason.length > 0 ? inSeason : candidates).map(({ id }) => id)
}

/** The wheel's twelve slots: the drawn piece (the first of the shuffled) at `landing`, the others round it in turn. */
export const wheelOf = (shuffled: ReadonlyArray<PieceId>, landing: number): Array<PieceId> => {
  const [drawn, ...rest] = shuffled
  if (drawn === undefined) return []
  const around = Array.isReadonlyArrayNonEmpty(rest) ? rest : [drawn]
  return Array.makeBy(wheelSize, (slot) =>
    slot === landing ? drawn : (around[((slot - landing - 1 + wheelSize) % wheelSize) % around.length] ?? drawn),
  )
}

/** The piece the wheel stopped on, once it has. */
export const landedPiece = (stage: Stage): Option.Option<PieceId> =>
  Stage.guards.Landed(stage) ? Option.fromNullishOr(stage.slots[stage.landing]) : Option.none()

export const dialogId = 'tombola'
export const openerId = 'what-to-wear'
export const resultId = 'tombola-result'
export const wheelId = 'tombola-wheel'

// MESSAGE

export const Message = defineMessageUnion({
  ClickedOpen: { pool: Schema.Array(PieceId), maybeSeason: Schema.Option(Season) },
  CompletedHoldTombola: {},
  CompletedDrawPiece: { round: Schema.Int, slots: Schema.Array(PieceId), landing: Schema.Int },
  CompletedTurnWheel: { round: Schema.Int },
  ClickedSpinAgain: {},
  ClickedWearIt: {},
  ClickedMakeOutfits: { name: Schema.String },
  SucceededMakeOutfits: { boardId: Schema.String },
  FailedMakeOutfits: { problem: StartProblem, missing: Schema.Array(Slot), operationId: Schema.Option(OperationId) },
  ClickedBuildOwn: { name: Schema.String },
  SucceededBuildOwn: { boardId: Schema.String },
  FailedBuildOwn: { resume: Resume },
  CompletedOpenBoard: {},
  ClickedClose: {},
  CompletedFocusResult: {},
  CompletedFocusOpener: {},
})
export type Message = typeof Message.Type

/** The drawn piece chosen to wear today: Home makes today's outfits around it. */
export const OutMessage = defineMessageUnion({ ChoseWearIt: { pieceId: PieceId } })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** Shuffle the pool and pick where on the wheel the first of it stops. */
export const DrawPiece = Command.define('DrawPiece', {
  args: { pool: Schema.Array(PieceId), round: Schema.Int },
  messages: [Message.CompletedDrawPiece],
  execute: ({ pool, round }) =>
    Effect.gen(function* () {
      const random = yield* SecureRandom.SecureRandom
      const shuffled = yield* random.shuffle(pool)
      const landing = yield* random.intBetween(0, wheelSize, { halfOpen: true })
      return Message.CompletedDrawPiece({ round, slots: wheelOf(shuffled, landing), landing })
    }),
})

/** The drawn piece's heading takes focus, so a screen reader says what was drawn. */
export const FocusResult = Command.define('FocusResult', {
  messages: [Message.CompletedFocusResult],
  execute: Dom.focus(`#${resultId}`, { makeFocusable: true }).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedFocusResult()),
  ),
})

/** Back to the button that opened it, once it is shut. */
export const FocusOpener = Command.define('FocusOpener', {
  messages: [Message.CompletedFocusOpener],
  execute: Dom.focus(`#${openerId}`).pipe(Effect.ignore, Effect.as(Message.CompletedFocusOpener())),
})

/** The board made from the drawn piece opens in its own page. */
export const OpenBoard = Command.define('OpenBoard', {
  args: { boardId: Schema.String },
  messages: [Message.CompletedOpenBoard],
  execute: ({ boardId }) => load(boardRouter({ boardId })).pipe(Effect.as(Message.CompletedOpenBoard())),
})

/** What the new-board sheet's request answers, as the tombola's own facts. */
const fromMaking = (message: StartMessage): Message =>
  Match.value(message).pipe(
    Match.tag('SucceededCreateOutfitBoard', ({ board }) => Message.SucceededMakeOutfits({ boardId: board.id })),
    Match.tag('FailedCreateOutfitBoard', ({ problem, missing, operationId }) =>
      Message.FailedMakeOutfits({ problem, missing, operationId }),
    ),
    Match.orElse(() => Message.FailedMakeOutfits({ problem: 'failed', missing: [], operationId: Option.none() })),
  )

/** What Save to board's request answers, as the tombola's own facts. */
const fromSaving = (message: SaveMessage): Message =>
  Match.value(message).pipe(
    Match.tag('SucceededSave', ({ boardId }) => Message.SucceededBuildOwn({ boardId })),
    Match.tag('FailedSave', ({ resume }) => Message.FailedBuildOwn({ resume })),
    Match.orElse(() => Message.CompletedOpenBoard()),
  )

// MOUNT

/** Hold the screen as modal while it is in the page: the page behind goes inert and stops scrolling, focus starts on
 * Close, and Escape asks to close it. */
export const HoldTombola = Mount.define('HoldTombola', {
  messages: [Message.CompletedHoldTombola],
  execute: ({ element }) =>
    Effect.acquireRelease(
      Dom.showDialog(`#${element.id}`, {
        isModal: true,
        focusSelector: '[data-tombola-close]',
        allowedOutsideSelectors: [`#${DEVTOOLS_HOST_ID}`],
      }).pipe(
        Effect.tap((acquired) => (acquired ? Dom.lockScroll : Effect.void)),
        Effect.orElseSucceed(() => false),
      ),
      (acquired) => (acquired ? Dom.releaseDialogResources(element.id) : Effect.void),
    ).pipe(Effect.as(Message.CompletedHoldTombola())),
})

/** Says when the wheel has stopped turning: at once under reduced motion, where the turn takes no time. */
export const TurnWheel = Mount.define('TurnWheel', {
  args: { round: Schema.Int },
  messages: [Message.CompletedTurnWheel],
  execute: ({ element, round }) =>
    Dom.waitForAnimationSettled(`#${element.id}`).pipe(Effect.ignore, Effect.as(Message.CompletedTurnWheel({ round }))),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | SecureRandom.SecureRandom>

const roundOf = (stage: Stage) =>
  Stage.match(stage, {
    Closed: () => Option.none<number>(),
    Drawing: ({ round }) => Option.some(round),
    Turning: ({ round }) => Option.some(round),
    Landed: ({ round }) => Option.some(round),
  })

/** A new round from the pool: the screen shows it is drawing, and the draw is asked for. */
const spin = (model: Model): UpdateReturn => {
  const round = model.round + 1
  return {
    model: modifyFields(model, {
      stage: () => Stage.Drawing({ round }),
      round: () => round,
      making: () => Making.Idle(),
      building: () => Building.Idle(),
    }),
    commands: [DrawPiece({ pool: model.pool, round })],
  }
}

/** The wheel stopped: the drawn piece is shown and takes focus, if it is this round's wheel. */
const landed = (model: Model, round: number): UpdateReturn => {
  const { stage } = model
  if (!Stage.guards.Turning(stage) || stage.round !== round) return { model }
  const { slots, landing } = stage
  return {
    model: modifyFields(model, { stage: () => Stage.Landed({ round, slots, landing }) }),
    commands: [FocusResult()],
  }
}

/** Whether a board is on its way from the drawn piece: one at a time. */
const busy = (model: Model) => Making.guards.Sending(model.making) || Building.guards.Sending(model.building)

/** Make outfits with it: the outfit board around the drawn piece, for the day's season; a failure that may have
 * reached Styld is asked for again under its operation id. */
const makeOutfits = (model: Model, name: string): UpdateReturn =>
  Option.match(landedPiece(model.stage), {
    onNone: () => ({ model }),
    onSome: (anchorPieceId) =>
      busy(model)
        ? { model }
        : {
            model: modifyFields(model, { making: () => Making.Sending() }),
            commands: [
              Command.mapMessage(
                CreateOutfitBoard({
                  name,
                  anchorPieceId,
                  maybeSeason: model.maybeSeason,
                  maybeOperationId: Making.guards.Failed(model.making) ? model.making.operationId : Option.none(),
                }),
                fromMaking,
              ),
            ],
          },
  })

/** Build my own: a new board with the drawn piece on its table; a failure resumes where it stopped. */
const buildOwn = (model: Model, name: string): UpdateReturn =>
  Option.match(landedPiece(model.stage), {
    onNone: () => ({ model }),
    onSome: (pieceId) =>
      busy(model)
        ? { model }
        : {
            model: modifyFields(model, { building: () => Building.Sending() }),
            commands: [
              Command.mapMessage(
                SaveTo({
                  target: { kind: 'piece', id: pieceId },
                  destination: { boardId: Option.none(), boardName: name },
                  resume: Building.guards.Failed(model.building) ? Option.some(model.building.resume) : Option.none(),
                }),
                fromSaving,
              ),
            ],
          },
  })

/** Opening Home again shuts the screen: it is never left open behind a page the person came back to. */
export const shut = (model: Model): Model => modifyFields(model, { stage: () => Stage.Closed() })

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedOpen: ({ pool, maybeSeason }) =>
      Array.isReadonlyArrayEmpty(pool) || !Stage.guards.Closed(model.stage)
        ? { model }
        : spin(modifyFields(model, { pool: () => pool, maybeSeason: () => maybeSeason })),
    CompletedHoldTombola: () => ({ model }),
    CompletedDrawPiece: ({ round, slots, landing }) =>
      Stage.guards.Drawing(model.stage) && model.stage.round === round
        ? { model: modifyFields(model, { stage: () => Stage.Turning({ round, slots, landing }) }) }
        : { model },
    CompletedTurnWheel: ({ round }) => landed(model, round),
    ClickedSpinAgain: () => (Stage.guards.Landed(model.stage) ? spin(model) : { model }),
    ClickedWearIt: () =>
      Option.match(landedPiece(model.stage), {
        onNone: () => ({ model }),
        onSome: (pieceId) => ({ model: shut(model), outMessage: OutMessage.ChoseWearIt({ pieceId }) }),
      }),
    ClickedMakeOutfits: ({ name }) => makeOutfits(model, name),
    SucceededMakeOutfits: ({ boardId }) => ({ model, commands: [OpenBoard({ boardId })] }),
    FailedMakeOutfits: ({ problem, missing, operationId }) => ({
      model: modifyFields(model, { making: () => Making.Failed({ problem, missing, operationId }) }),
    }),
    ClickedBuildOwn: ({ name }) => buildOwn(model, name),
    SucceededBuildOwn: ({ boardId }) => ({ model, commands: [OpenBoard({ boardId })] }),
    FailedBuildOwn: ({ resume }) => ({ model: modifyFields(model, { building: () => Building.Failed({ resume }) }) }),
    CompletedOpenBoard: () => ({ model }),
    ClickedClose: () =>
      Option.isNone(roundOf(model.stage)) ? { model } : { model: shut(model), commands: [FocusOpener()] },
    CompletedFocusResult: () => ({ model }),
    CompletedFocusOpener: () => ({ model }),
  })
