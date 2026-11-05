import { format, type MessageKey } from '@styld/i18n'
import {
  type BoardId,
  type BoardItem,
  type Colour,
  CurrentAccount,
  NotFound,
  OperationId,
  type PieceId,
  type PieceType,
  type PlacedThing,
  type PublicBoard,
  type PublicPiece,
  TableLabel,
  TablePiece,
  TriedBoard,
  type TryBoard,
  Unavailable,
  widestLabel,
} from '@styld/protocol'
import { Context, Effect, Layer, Match, Option, Predicate, Schema } from 'effect'
import { Database, stored } from '../kernel/Db.ts'
import { once, receiptRows } from '../kernel/Receipts.ts'
import { wearablesOf } from '../outfits/Wearables.ts'
import { PublicPages } from '../social/Public.ts'
import { ReaderLocale } from '../social/Translated.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { wornStore } from '../worn/Store.ts'
import { Boards } from './Boards.ts'

// Try with my wardrobe (owner, 4 November 2026): a public board that shows generated pieces, laid out again as a new
// private board of the person's, each generated piece where it lay stood in for by one of their own ready pieces, or,
// where none fits, a label saying what is missing. The house's pieces never go on it and nothing is written to the
// person's wardrobe; the board's texts come as the person read them.

/** A piece on the board, to be swapped for one of the person's own. */
interface Wanted {
  readonly id: PieceId
  readonly type: PieceType
  readonly colours: ReadonlyArray<Colour>
}

/** One of the person's ready pieces, the last day they wore it if they did. */
interface Own {
  readonly id: PieceId
  readonly type: PieceType
  readonly colours: ReadonlyArray<Colour>
  readonly lastWorn: string | null
}

/** How well an own piece takes a wanted one's place: the colours they share, whether it has the wanted's first
 * colour, and the last day it was worn. */
const fitOf = (wanted: Wanted, own: Own) =>
  [
    own.colours.filter((colour) => wanted.colours.includes(colour)).length,
    wanted.colours[0] !== undefined && own.colours.includes(wanted.colours[0]) ? 1 : 0,
  ] as const

/** Whether `a` takes the place better than `b`; on a tie the more recently worn, then the newer added (the earlier in the
 * list) is kept. */
const fitsBetter = (wanted: Wanted, a: Own, b: Own) => {
  const [sharedA, firstA] = fitOf(wanted, a)
  const [sharedB, firstB] = fitOf(wanted, b)
  if (sharedA !== sharedB) return sharedA > sharedB
  if (firstA !== firstB) return firstA > firstB
  return (a.lastWorn ?? '') > (b.lastWorn ?? '')
}

/** Each wanted piece's swap among the person's own, newest added first, each used once: one of the same type
 * that shares the most colours, then has the wanted's first colour, then was worn last, then was added last.
 * @internal Exported for its tests. */
export const swapsFor = (wanted: ReadonlyArray<Wanted>, own: ReadonlyArray<Own>): ReadonlyMap<PieceId, PieceId> => {
  const used = new Set<PieceId>()
  const chosen = new Map<PieceId, PieceId>()
  for (const piece of wanted) {
    const best = own
      .filter(({ id, type }) => type === piece.type && !used.has(id))
      .reduce<Own | undefined>(
        (kept, next) => (kept === undefined || fitsBetter(piece, next, kept) ? next : kept),
        undefined,
      )
    if (best === undefined) continue
    used.add(best.id)
    chosen.set(piece.id, best.id)
  }
  return chosen
}

/** What a missing piece's label says: its kind, and its first colour when it has one.
 * @internal Exported for its tests. */
export const missingLabel = (piece: Pick<PublicPiece, 'type' | 'colours'>, locale: 'en' | 'sl') => {
  const type = format(locale, `wardrobe.typeOne.${piece.type}` as const satisfies MessageKey, {}).toLowerCase()
  const [colour] = piece.colours
  return colour === undefined
    ? format(locale, 'tryBoard.missingKind', { type })
    : format(locale, 'tryBoard.missing', {
        type,
        colour: format(locale, `wardrobe.addPieceColor_${colour}` as const satisfies MessageKey, {}).toLowerCase(),
      })
}

/** The board's table as the person's: each of its pieces where it lay, as their own piece or a label saying what is
 * missing; its texts as they read them; pictures stay with their owner. In the board's stacking order. */
const triedTable = (
  items: ReadonlyArray<BoardItem>,
  pieces: ReadonlyMap<string, PublicPiece>,
  chosen: ReadonlyMap<PieceId, PieceId>,
  missing: (piece: PublicPiece) => string,
): ReadonlyArray<PlacedThing> =>
  items
    .toSorted((a, b) => a.z - b.z)
    .flatMap((item) =>
      Match.value(item).pipe(
        Match.tagsExhaustive({
          PieceItem: ({ pieceId, x, y, size, turn, flipped }): ReadonlyArray<PlacedThing> => {
            const piece = pieces.get(pieceId)
            if (piece === undefined) return []
            const own = chosen.get(piece.id)
            return own === undefined
              ? [
                  {
                    thing: TableLabel.make({ text: missing(piece), style: 'label' }),
                    x,
                    y,
                    size: Math.min(size, widestLabel),
                    turn: 0,
                  },
                ]
              : [{ thing: TablePiece.make({ pieceId: own }), x, y, size, turn, flipped }]
          },
          TextItem: ({ text, style, x, y, size, turn }) => [
            { thing: TableLabel.make({ text, style }), x, y, size, turn },
          ],
          ImageItem: () => [],
        }),
      ),
    )

/** A step of a try, under an operation of its own drawn from the try's. */
const stepOf = (operationId: OperationId, step: string) => OperationId.make(`${operationId.slice(0, 56)}-${step}`)

/** The last day each piece of the account was worn (the days come oldest first). */
const lastWornOf = (db: Database['Service'], accountId: string) =>
  wornStore(db)
    .wornBetween(accountId, '0000-01-01', '9999-12-31')
    .pipe(
      Effect.map((days) => new Map(days.map(({ day, pieceId }) => [pieceId, day]))),
      stored,
    )

/** The board's pieces others may see, by id, and those on its table, each once. */
const piecesOf = (board: PublicBoard) => {
  const pieces = new Map<string, PublicPiece>(
    board.pins.flatMap((pin) =>
      Predicate.isTagged(pin, 'PublicPiecePin') ? [[pin.piece.id, pin.piece] as const] : [],
    ),
  )
  const onTable = board.items.flatMap((item) => {
    const piece = Predicate.isTagged(item, 'PieceItem') ? pieces.get(item.pieceId) : undefined
    return piece === undefined ? [] : [[piece.id, piece] as const]
  })
  return { pieces, wanted: [...new Map(onTable).values()] }
}

/** Who tried it, and the new board and its count as its receipt keeps them. */
const TriedJson = Schema.fromJsonString(TriedBoard)

const make = Effect.gen(function* () {
  const pages = yield* PublicPages
  const boards = yield* Boards
  const wardrobe = yield* WardrobeStore
  const database = yield* Database
  const receipts = receiptRows(database)
  /** The person's ready pieces, newest added first, with the last day each was worn. */
  const ownOf = Effect.fnUntraced(function* (accountId: string) {
    const worn = yield* lastWornOf(database, accountId)
    return (yield* wearablesOf(wardrobe, accountId).pipe(stored)).map(({ wearable }): Own => ({
      ...wearable,
      lastWorn: worn.get(wearable.id) ?? null,
    }))
  })
  /** The try's work, each step under an operation of its own drawn from the try's. */
  const tried = Effect.fnUntraced(function* (board: PublicBoard, operationId: OperationId, accountId: string) {
    const { pieces, wanted } = piecesOf(board)
    const chosen = swapsFor(wanted, yield* ownOf(accountId))
    const locale = yield* ReaderLocale
    const made = yield* boards.createBoard({ operationId: stepOf(operationId, 'board'), name: board.name })
    const styled = yield* boards.updateBoard(made.id, { operationId: stepOf(operationId, 'paper'), paper: board.paper })
    // The board was just made at the version read, and every thing on it is the person's own or a label: a refused
    // table or a moved version means the store did not answer as it should.
    yield* boards
      .setTable(made.id, {
        operationId: stepOf(operationId, 'table'),
        version: styled.version,
        items: triedTable(board.items, pieces, chosen, (piece) => missingLabel(piece, locale)),
      })
      .pipe(
        Effect.catchTags({
          BoardItemRefused: () => Unavailable.make({}),
          BoardVersionConflict: () => Unavailable.make({}),
        }),
      )
    const missing = wanted.filter(({ id }) => !chosen.has(id)).map(({ type, colours }) => ({ type, colours }))
    const answer: TriedBoard = { boardId: made.id, fromWardrobe: chosen.size, of: wanted.length, missing }
    return answer
  })
  return {
    /** Try a public board with the person's own wardrobe, once per operation id: the new board, and how many of its
     * pieces are theirs. A repeat answers the same board and makes nothing. */
    tryBoard: Effect.fn('Styld.Boards.tryBoard')(function* (boardId: BoardId, input: TryBoard) {
      const { accountId } = yield* CurrentAccount
      const board = yield* pages.board(boardId, Option.some(accountId))
      if (!board.generated) return yield* NotFound.make({})
      return yield* once(
        receipts,
        { accountId, operationId: input.operationId, command: 'tryBoard', input: boardId },
        {
          replay: (result) =>
            Schema.decodeUnknownEffect(TriedJson)(result).pipe(Effect.mapError(() => Unavailable.make({}))),
          run: Effect.flatMap(tried(board, input.operationId, accountId), (answer) =>
            Effect.map(
              Schema.encodeEffect(TriedJson)(answer).pipe(Effect.mapError(() => Unavailable.make({}))),
              (result) => [answer, result] as const,
            ),
          ),
        },
      )
    }),
  }
})

/** Trying a board with one's own wardrobe. */
export class TryBoards extends Context.Service<TryBoards, Effect.Success<typeof make>>()(
  '@styld/server/boards/TryBoards',
) {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => TryBoards.of(service)),
  )
}
