import { Board, Day, Piece, PieceId } from '@styld/protocol'
import { Array, Clock, Effect, Option, Result, Schema } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'
import { outfitFor, type Placed, placedByCategory } from './Outfit.ts'

// MODEL

/** Whether today's outfit is recorded: not yet, on its way, or worn (with the pieces worn). */
export const Worn = defineTaggedUnion({
  NotYet: {},
  Saving: {},
  Worn: { pieceIds: Schema.Array(PieceId) },
  Failed: {},
})
export type Worn = typeof Worn.Type

/** The last board with something on its table, if any. */
export const LastBoardData = AsyncData.Schema(Schema.Option(Board), Schema.Literal('Unavailable'))
export type LastBoardData = typeof LastBoardData.schema.Type
/** How many pieces wait in the review tray. */
export const TrayData = AsyncData.Schema(Schema.Int, Schema.Literal('Unavailable'))
export type TrayData = typeof TrayData.schema.Type

/** Home for a signed-in person: today's outfit on the table, then where they left off. The pieces themselves
 * are the wardrobe's, which the app keeps once for every page. */
export const Model = Schema.Struct({
  /** Today in the person's own time zone, read in the browser. */
  maybeDay: Schema.Option(Day),
  spin: Schema.Int,
  worn: Worn,
  lastBoard: LastBoardData.schema,
  tray: TrayData.schema,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  maybeDay: Option.none(),
  spin: 0,
  worn: Worn.NotYet(),
  lastBoard: AsyncData.Idle(),
  tray: AsyncData.Idle(),
})

// MESSAGE

export const Message = defineMessageUnion({
  CompletedDetermineDay: { day: Day },
  SucceededReadWorn: { pieceIds: Schema.Array(PieceId) },
  FailedReadWorn: {},
  SucceededListBoards: { maybeBoard: Schema.Option(Board) },
  FailedListBoards: {},
  SucceededReadTray: { waiting: Schema.Int },
  FailedReadTray: {},
  ClickedSpin: {},
  /** The pieces on the table when Wear this was pressed. */
  ClickedWear: { pieceIds: Schema.Array(PieceId) },
  SucceededWear: { pieceIds: Schema.Array(PieceId) },
  FailedWear: {},
  ClickedRetry: {},
})
export type Message = typeof Message.Type

/** The pieces didn't load: the app asks for them again. */
export const OutMessage = defineMessageUnion({ RequestedPieces: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** Today in the browser's own time zone (the server renders in UTC). `en-CA` writes dates as `2026-10-30`.
 * @internal Exported for its tests. */
export const DetermineDay = Command.define('DetermineDay', {
  messages: [Message.CompletedDetermineDay],
  execute: Clock.currentTimeMillis.pipe(
    Effect.map((now) =>
      new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now),
    ),
    Effect.flatMap((text) => Schema.decodeUnknownEffect(Day)(text)),
    Effect.map((day) => Message.CompletedDetermineDay({ day })),
    Effect.orDie,
  ),
})

/** @internal Exported for its tests. */
export const ReadWorn = Command.define('ReadWorn', {
  args: { day: Day },
  messages: [Message.SucceededReadWorn, Message.FailedReadWorn],
  execute: ({ day }) =>
    Effect.gen(function* () {
      const { days } = yield* (yield* (yield* StyldClient).api).worn.listWorn({ query: { from: day, to: day } })
      return Message.SucceededReadWorn({ pieceIds: days[0]?.pieceIds ?? [] })
    }).pipe(Effect.orElseSucceed(() => Message.FailedReadWorn())),
})

/** @internal Exported for its tests. */
export const ListBoards = Command.define('ListBoards', {
  messages: [Message.SucceededListBoards, Message.FailedListBoards],
  execute: Effect.gen(function* () {
    const { boards } = yield* (yield* (yield* StyldClient).api).board.listBoards()
    // An empty board is nothing to pick up: the newest one with something on its table.
    return Message.SucceededListBoards({ maybeBoard: Array.findFirst(boards, (board) => board.items.length > 0) })
  }).pipe(Effect.orElseSucceed(() => Message.FailedListBoards())),
})

/** @internal Exported for its tests. */
export const ReadTray = Command.define('ReadTray', {
  messages: [Message.SucceededReadTray, Message.FailedReadTray],
  execute: Effect.gen(function* () {
    const { captures } = yield* (yield* (yield* StyldClient).api).capture.tray()
    const waiting = captures.reduce((sum, capture) => sum + capture.detections.length, 0)
    return Message.SucceededReadTray({ waiting })
  }).pipe(Effect.orElseSucceed(() => Message.FailedReadTray())),
})

/** @internal Exported for its tests. */
export const Wear = Command.define('Wear', {
  args: { day: Day, pieceIds: Schema.Array(PieceId) },
  messages: [Message.SucceededWear, Message.FailedWear],
  execute: ({ day, pieceIds }) =>
    Effect.gen(function* () {
      const worn = yield* (yield* (yield* StyldClient).api).worn.wearPieces({ params: { day }, payload: { pieceIds } })
      return Message.SucceededWear({ pieceIds: worn.pieceIds })
    }).pipe(Effect.orElseSucceed(() => Message.FailedWear())),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient>

const unavailable = Result.fail('Unavailable' as const)

/** Opening Home: today is read again, and where they left off is kept on screen while it is asked for again. */
export const enter = (model: Model): Update.Return<Model, Message, StyldClient> =>
  Update.combine<Model, Message, StyldClient>(model, [
    (current) => ({ model: current, commands: [DetermineDay()] }),
    Update.refresh<Model, Message, Option.Option<Board>, 'Unavailable', StyldClient>({
      read: (current: Model) => Option.some(current.lastBoard),
      revalidate: AsyncData.revalidateOrLoad,
      write: (current: Model, lastBoard: LastBoardData) => modifyFields(current, { lastBoard: () => lastBoard }),
      load: ListBoards(),
    }),
    Update.refresh<Model, Message, number, 'Unavailable', StyldClient>({
      read: (current: Model) => Option.some(current.tray),
      revalidate: AsyncData.revalidateOrLoad,
      write: (current: Model, tray: TrayData) => modifyFields(current, { tray: () => tray }),
      load: ReadTray(),
    }),
  ])

/** The outfit on the table now: what was worn today, else today's choice for this Spin. */
export const tableOutfit = (model: Model, pieces: ReadonlyArray<Piece>): ReadonlyArray<Placed> => {
  if (Worn.guards.Worn(model.worn) && model.spin === 0) {
    const worn = new Set<string>(model.worn.pieceIds)
    return placedByCategory(pieces.filter((piece) => worn.has(piece.id)))
  }
  const day = Option.getOrElse(model.maybeDay, () => '')
  return outfitFor(pieces, `${day}:${String(model.spin)}`)
}

const wear = (model: Model, pieceIds: ReadonlyArray<PieceId>): UpdateReturn => {
  const alreadyWorn = Worn.guards.Worn(model.worn) && model.spin === 0
  if (Option.isNone(model.maybeDay) || pieceIds.length === 0 || Worn.guards.Saving(model.worn) || alreadyWorn)
    return { model }
  return {
    model: modifyFields(model, { worn: () => Worn.Saving() }),
    commands: [Wear({ day: model.maybeDay.value, pieceIds })],
  }
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    CompletedDetermineDay: ({ day }) => ({
      model: Option.contains(model.maybeDay, day) ? model : modifyFields(model, { maybeDay: () => Option.some(day) }),
      commands: [ReadWorn({ day })],
    }),
    SucceededReadWorn: ({ pieceIds }) => ({
      model: modifyFields(model, { worn: () => (pieceIds.length > 0 ? Worn.Worn({ pieceIds }) : Worn.NotYet()) }),
    }),
    FailedReadWorn: () => ({ model }),
    SucceededListBoards: ({ maybeBoard }) => ({
      model: modifyFields(model, { lastBoard: () => LastBoardData.Success({ data: maybeBoard }) }),
    }),
    FailedListBoards: () => ({
      model: modifyFields(model, { lastBoard: (lastBoard) => AsyncData.settle(lastBoard, unavailable) }),
    }),
    SucceededReadTray: ({ waiting }) => ({
      model: modifyFields(model, { tray: () => TrayData.Success({ data: waiting }) }),
    }),
    FailedReadTray: () => ({ model: modifyFields(model, { tray: (tray) => AsyncData.settle(tray, unavailable) }) }),
    ClickedSpin: () => ({ model: modifyFields(model, { spin: (spin) => spin + 1, worn: () => Worn.NotYet() }) }),
    ClickedWear: ({ pieceIds }) => wear(model, pieceIds),
    SucceededWear: ({ pieceIds }) => ({
      model: modifyFields(model, { worn: () => Worn.Worn({ pieceIds }), spin: () => 0 }),
    }),
    FailedWear: () => ({ model: modifyFields(model, { worn: () => Worn.Failed() }) }),
    ClickedRetry: () => ({ model, outMessage: OutMessage.RequestedPieces() }),
  })
