import { Board, Day, Piece, PieceId } from '@styld/protocol'
import { Clock, Effect, Option, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'
import { outfitFor, type Placed, placedByCategory } from './Outfit.ts'

// MODEL

export const Pieces = defineTaggedUnion({
  Loading: {},
  Loaded: { pieces: Schema.Array(Piece) },
  Failed: {},
})

/** Whether today's outfit is recorded: not yet, on its way, or worn (with the pieces worn). */
export const Worn = defineTaggedUnion({
  NotYet: {},
  Saving: {},
  Worn: { pieceIds: Schema.Array(PieceId) },
  Failed: {},
})
export type Worn = typeof Worn.Type

/** Home for a signed-in person: today's outfit on the table, then where they left off. */
export const Model = Schema.Struct({
  /** Today in the person's own time zone, read in the browser. */
  maybeDay: Schema.Option(Day),
  pieces: Pieces,
  spin: Schema.Int,
  worn: Worn,
  maybeBoard: Schema.Option(Board),
  waiting: Schema.Int,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  maybeDay: Option.none(),
  pieces: Pieces.Loading(),
  spin: 0,
  worn: Worn.NotYet(),
  maybeBoard: Option.none(),
  waiting: 0,
})

// MESSAGE

export const Message = defineMessageUnion({
  CompletedDetermineDay: { day: Day },
  SucceededListPieces: { pieces: Schema.Array(Piece) },
  FailedListPieces: {},
  SucceededReadWorn: { pieceIds: Schema.Array(PieceId) },
  FailedReadWorn: {},
  SucceededListBoards: { maybeBoard: Schema.Option(Board) },
  FailedListBoards: {},
  SucceededReadTray: { waiting: Schema.Int },
  FailedReadTray: {},
  ClickedSpin: {},
  ClickedWear: {},
  SucceededWear: { pieceIds: Schema.Array(PieceId) },
  FailedWear: {},
  ClickedRetry: {},
})
export type Message = typeof Message.Type

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
export const ListPieces = Command.define('ListPieces', {
  messages: [Message.SucceededListPieces, Message.FailedListPieces],
  execute: Effect.gen(function* () {
    const { pieces } = yield* (yield* (yield* StyldClient).api).wardrobe.listPieces()
    return Message.SucceededListPieces({ pieces })
  }).pipe(Effect.orElseSucceed(() => Message.FailedListPieces())),
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
    return Message.SucceededListBoards({ maybeBoard: Option.fromNullishOr(boards[0]) })
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

export const load = (): ReadonlyArray<Command.Command<Message, never, StyldClient>> => [
  DetermineDay(),
  ListPieces(),
  ListBoards(),
  ReadTray(),
]

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

/** The outfit on the table now: what was worn today, else today's choice for this Spin. */
export const tableOutfit = (model: Model): ReadonlyArray<Placed> => {
  if (!Pieces.guards.Loaded(model.pieces)) return []
  const { pieces } = model.pieces
  if (Worn.guards.Worn(model.worn) && model.spin === 0) {
    const worn = new Set<string>(model.worn.pieceIds)
    return placedByCategory(pieces.filter((piece) => worn.has(piece.id)))
  }
  const day = Option.getOrElse(model.maybeDay, () => '')
  return outfitFor(pieces, `${day}:${String(model.spin)}`)
}

const wear = (model: Model): UpdateReturn => {
  const pieceIds = tableOutfit(model).map(({ piece }) => piece.id)
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
      model: modifyFields(model, { maybeDay: () => Option.some(day) }),
      commands: [ReadWorn({ day })],
    }),
    SucceededListPieces: ({ pieces }) => ({ model: modifyFields(model, { pieces: () => Pieces.Loaded({ pieces }) }) }),
    FailedListPieces: () => ({ model: modifyFields(model, { pieces: () => Pieces.Failed() }) }),
    SucceededReadWorn: ({ pieceIds }) => ({
      model: modifyFields(model, { worn: () => (pieceIds.length > 0 ? Worn.Worn({ pieceIds }) : Worn.NotYet()) }),
    }),
    FailedReadWorn: () => ({ model }),
    SucceededListBoards: ({ maybeBoard }) => ({ model: modifyFields(model, { maybeBoard: () => maybeBoard }) }),
    FailedListBoards: () => ({ model }),
    SucceededReadTray: ({ waiting }) => ({ model: modifyFields(model, { waiting: () => waiting }) }),
    FailedReadTray: () => ({ model }),
    ClickedSpin: () => ({ model: modifyFields(model, { spin: (spin) => spin + 1, worn: () => Worn.NotYet() }) }),
    ClickedWear: () => wear(model),
    SucceededWear: ({ pieceIds }) => ({
      model: modifyFields(model, { worn: () => Worn.Worn({ pieceIds }), spin: () => 0 }),
    }),
    FailedWear: () => ({ model: modifyFields(model, { worn: () => Worn.Failed() }) }),
    ClickedRetry: () => ({ model: modifyFields(model, { pieces: () => Pieces.Loading() }), commands: [ListPieces()] }),
  })
