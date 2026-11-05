import { BoardSummary, Piece } from '@styld/protocol'
import { Effect, Number, Option, Result, Schema } from 'effect'
import { AsyncData, Command, Subscription, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { Misses, pollWhilePending } from './Polling.ts'
import { StyldClient } from './StyldClient.ts'

// What the server holds that several pages show: the person's pieces and boards, each read in one place for the app
// and kept on screen while asked for again. Pages take them as view inputs and ask for them through their OutMessages.

// MODEL

/** Why something a page asked for is not shown: it does not exist (or is not the person's), or the server did not
 * answer. Pages read their data as `AsyncData` with this error; a failure keeps what was shown before. */
export const LoadError = Schema.Literals(['NotFound', 'Unavailable'])
export type LoadError = typeof LoadError.Type

/** The person's pieces as last read. */
export const PiecesData = AsyncData.Schema(Schema.Array(Piece), Schema.Literal('Unavailable'))
export type PiecesData = typeof PiecesData.schema.Type

/** The person's boards as last read, newest first: the Boards page's list, Save to board's choices and Home's last
 * board. */
export const BoardsData = AsyncData.Schema(Schema.Array(BoardSummary), Schema.Literal('Unavailable'))
export type BoardsData = typeof BoardsData.schema.Type

export const Model = Schema.Struct({ pieces: PiecesData.schema, misses: Misses, boards: BoardsData.schema })
export type Model = typeof Model.Type

export const init = (): Model => ({ pieces: AsyncData.Idle(), misses: 0, boards: AsyncData.Idle() })

/** The pieces as last read, or none yet. */
export const readPieces = (pieces: PiecesData): ReadonlyArray<Piece> =>
  Option.getOrElse(AsyncData.getData(pieces), (): ReadonlyArray<Piece> => [])

// MESSAGE

export const Message = defineMessageUnion({
  SucceededListPieces: { pieces: Schema.Array(Piece) },
  FailedListPieces: {},
  TickedPiecesRefresh: {},
  SucceededListBoards: { boards: Schema.Array(BoardSummary) },
  FailedListBoards: {},
})
export type Message = typeof Message.Type

/** The pieces have been read: the app can now put the wardrobe back where it was and hand Ask the person's pieces. */
export const OutMessage = defineMessageUnion({ ReadPieces: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

export const ListPieces = Command.define('ListPieces', {
  messages: [Message.SucceededListPieces, Message.FailedListPieces],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { pieces } = yield* api.wardrobe.listPieces()
    return Message.SucceededListPieces({ pieces })
  }).pipe(Effect.orElseSucceed(() => Message.FailedListPieces())),
})

export const ListBoards = Command.define('ListBoards', {
  messages: [Message.SucceededListBoards, Message.FailedListBoards],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { boards } = yield* api.board.listBoards()
    return Message.SucceededListBoards({ boards })
  }).pipe(Effect.orElseSucceed(() => Message.FailedListBoards())),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

const piecesCache = (revalidate: (pieces: PiecesData) => Option.Option<PiecesData>) =>
  Update.refresh<Model, Message, ReadonlyArray<Piece>, 'Unavailable', StyldClient>({
    read: (model: Model) => Option.some(model.pieces),
    revalidate,
    write: (model: Model, pieces: PiecesData) => modifyFields(model, { pieces: () => pieces }),
    load: ListPieces(),
  })

/** Opening a page that shows the pieces: those already here stay on screen while they are asked for again, a first
 * visit asks, and a request on its way is not repeated. It also starts following settling pieces over, after polls
 * that failed. */
export const revisitPieces = Update.combine<Model, Message, StyldClient>([
  (model) => ({ model: modifyFields(model, { misses: () => 0 }) }),
  piecesCache(AsyncData.revalidateOrLoad),
])

/** The pieces read again after a change made here (pieces deleted), even with a read on its way: that read may predate
 * the change. */
export const readPiecesAgain = (model: Model): UpdateReturn => ({
  model: modifyFields(model, { pieces: (pieces) => Option.getOrElse(AsyncData.revalidate(pieces), () => pieces) }),
  commands: [ListPieces()],
})

/** Asking again for pieces already here, after a change that touches them; a request on its way is not repeated. */
const refreshPieces = piecesCache(AsyncData.revalidate)

/** Showing the boards (the Boards page, Save to board's sheet, Home): those already here stay on screen while they are
 * asked for again, so a board made meanwhile appears; a first time asks, and a request on its way is not repeated. */
export const revisitBoards = Update.refresh<Model, Message, ReadonlyArray<BoardSummary>, 'Unavailable', StyldClient>({
  read: (model: Model) => Option.some(model.boards),
  revalidate: AsyncData.revalidateOrLoad,
  write: (model: Model, boards: BoardsData) => modifyFields(model, { boards: () => boards }),
  load: ListBoards(),
})

export const update = (
  model: Model,
  message: Message,
): Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient> =>
  Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient>>(message, {
    SucceededListPieces: ({ pieces }) => ({
      model: modifyFields(model, { pieces: () => PiecesData.Success({ data: pieces }), misses: () => 0 }),
      outMessage: OutMessage.ReadPieces(),
    }),
    // A failed read keeps the pieces already shown.
    FailedListPieces: () => ({
      model: modifyFields(model, {
        pieces: (pieces) => AsyncData.settle(pieces, Result.fail('Unavailable' as const)),
        misses: Number.increment,
      }),
    }),
    TickedPiecesRefresh: () => refreshPieces(model),
    SucceededListBoards: ({ boards }) => ({
      model: modifyFields(model, { boards: () => BoardsData.Success({ data: boards }) }),
    }),
    // A failed read keeps the boards already shown.
    FailedListBoards: () => ({
      model: modifyFields(model, { boards: (boards) => AsyncData.settle(boards, Result.fail('Unavailable' as const)) }),
    }),
  })

// SUBSCRIPTION

/** A piece still processing, or with its clean picture being drawn. */
const isSettling = (piece: Piece) => piece.status === 'processing' || piece.picture?.state === 'drawing'

/** The pieces are asked for again while one is settling; the app runs this only on pages that show them. */
export const subscriptions = Subscription.make<Model, Message>()(() => ({
  piecesWhileSettling: pollWhilePending<Model, Message>({
    pendingIds: (model) =>
      readPieces(model.pieces)
        .filter(isSettling)
        .map((piece) => piece.id),
    misses: (model) => model.misses,
    tick: Message.TickedPiecesRefresh(),
  }),
}))
