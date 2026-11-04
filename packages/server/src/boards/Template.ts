import {
  type AnotherOutfit,
  type BoardId,
  BoardItemId,
  Colours,
  type BoardOutfitId,
  type CreateOutfitBoard,
  CurrentAccount,
  type MakeOutfit,
  mostSeen,
  NotFound,
  OperationConflict,
  OperationId,
  OutfitSession,
  type OutfitPiece,
  OutfitRefused,
  outfitKeyOf,
  outfitsAround,
  paperFor,
  PieceId,
  type PieceType,
  searchText,
} from '@styld/protocol'
import { Array, Effect, Option, Schema } from 'effect'
import { nowDate } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { identify, type Identified, receiptRow } from '../kernel/Receipts.ts'
import { Outfits } from '../outfits/Outfits.ts'
import { newPins, one, ownBoard, pieceTarget, priorOf, stored, unavailable, type BoardServices } from './Shared.ts'
import {
  type BoardItemRow,
  type BoardOutfitRow,
  BoardStore,
  type OutfitBoard,
  type OutfitReplacement,
} from './Store.ts'

// "One piece, six outfits" (T-10, owner 4 November 2026): a board started from one of the person's pieces, with complete
// outfits around it made by the engine's Fast way, free, laid out as clusters on its table. Each outfit can be kept as a
// look (`keepLook`) or replaced by another until it is.

/** How many outfits a board starts with. */
const outfitsPerBoard = 6

/** The engine's own operation id for a board operation's outfits: the request's, so a repeat asks it the same. */
const outfitsOperation = (operationId: string) => OperationId.make(`${operationId.slice(0, 56)}-outfits`)

/** Which arrangement a board's clusters start from: the same board, the same layout every time. */
const shiftOf = (boardId: string) =>
  Array.reduce(
    Array.makeBy(boardId.length, (at) => boardId.charCodeAt(at)),
    0,
    (sum, code) => sum + code,
  )

/** Fast's complete outfits around the anchor, as asked; none is a refusal that says what the wardrobe lacks. */
const madeOutfits = (asked: Omit<MakeOutfit, 'mode' | 'lockedPieceIds' | 'complete'>) =>
  Effect.gen(function* () {
    const batch = yield* (yield* Outfits)
      .make({ ...asked, mode: 'fast', lockedPieceIds: [], complete: true })
      .pipe(Effect.catchTags({ LimitReached: unavailable, ThinkingUnanswered: unavailable }))
    if (Array.isReadonlyArrayEmpty(batch.proposals))
      return yield* OutfitRefused.make({ reason: 'noOutfits', missing: batch.missing })
    return batch
  })

/** What the layout needs of these pieces, by id. */
const typesOf = (pieceIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const rows = yield* stored((yield* BoardStore).piecesById([...new Set(pieceIds)]))
    return new Map(rows.map(({ piece }) => [piece.id, piece] as const))
  })

/** The outfits as the layout reads them, each piece with its type. */
const toLayout = (
  outfits: ReadonlyArray<ReadonlyArray<string>>,
  found: ReadonlyMap<string, { readonly type: PieceType }>,
): ReadonlyArray<ReadonlyArray<OutfitPiece>> =>
  outfits.map((pieceIds) =>
    pieceIds.flatMap((id) =>
      Option.toArray(Option.map(Option.fromNullishOr(found.get(id)), ({ type }) => ({ id: PieceId.make(id), type }))),
    ),
  )

/** Table rows for the placed pieces of these outfits, each with a fresh id and its outfit's. */
const placedRows = (
  placed: ReturnType<typeof outfitsAround>,
  outfitIds: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<Omit<BoardItemRow, 'boardId'>>> =>
  Effect.forEach(placed, ({ outfit, pieceId, ...spot }) =>
    Effect.map(newId('bi'), (id) => ({
      ...spot,
      id: BoardItemId.make(id),
      kind: 'piece' as const,
      pieceId,
      imageId: null,
      text: null,
      textStyle: null,
      outfitId: outfitIds[outfit] ?? null,
    })),
  )

/** The board an operation id already made, if any; a repeat after it was deleted is a conflict. */
const madeBefore = (operation: Identified) =>
  Effect.flatMap(priorOf(operation), (prior) =>
    Option.match(prior, {
      onNone: () => Effect.succeed(Option.none()),
      onSome: (boardId) =>
        one(operation.accountId, boardId).pipe(
          Effect.map(Option.some),
          Effect.catchTag('NotFound', () => Effect.fail(OperationConflict.make({}))),
        ),
    }),
  )

/** What a new outfit board writes (`createOutfitBoard`): the board on a paper from its anchor's colour, its outfits in
 * their places, their clusters on its table, every piece pinned, and the operation's receipt. */
const outfitBoardOf = Effect.fnUntraced(function* (
  operation: Identified,
  input: CreateOutfitBoard,
  batch: Effect.Success<ReturnType<typeof madeOutfits>>,
) {
  const { accountId } = operation
  const pieceIds = batch.proposals.map(({ pieceIds: worn }) => worn)
  const found = yield* typesOf([input.anchorPieceId, ...pieceIds.flat()])
  const anchor = found.get(input.anchorPieceId)
  if (anchor === undefined) return yield* NotFound.make({})
  const boardId = yield* newId('bd')
  const at = yield* nowDate
  const outfitIds = yield* Effect.forEach(pieceIds, () => newId('bo'))
  const placed = outfitsAround(input.anchorPieceId, toLayout(pieceIds, found), shiftOf(boardId))
  const outfits = Array.zipWith(
    outfitIds,
    pieceIds,
    (id, worn): { readonly row: BoardOutfitRow; readonly pieceIds: ReadonlyArray<string> } => ({
      row: {
        id,
        accountId,
        boardId,
        position: outfitIds.indexOf(id),
        mode: batch.mode,
        session: batch.session,
        season: input.season ?? null,
        lookId: null,
        createdAt: at,
      },
      pieceIds: worn,
    }),
  )
  const made: OutfitBoard = {
    board: {
      id: boardId,
      accountId,
      name: input.name,
      // Only the service writes rows, through the same schemas; a row that does not decode is a bug.
      paper: paperFor(yield* Schema.decodeUnknownEffect(Colours)(anchor.colours).pipe(Effect.orDie)),
      version: 0,
      visibility: 'private',
      moods: [],
      publishedAt: null,
      featuredAt: null,
      searchText: searchText(input.name),
      template: 'outfitsAround',
      anchorPieceId: input.anchorPieceId,
      createdAt: at,
      updatedAt: at,
    },
    outfits,
    items: yield* placedRows(placed, outfitIds),
    pins: yield* newPins(boardId, [...new Set(pieceIds.flat())].map(pieceTarget), at),
    receipt: yield* receiptRow(operation, boardId),
  }
  return made
})

/** The outfit to replace, with its board and the board's other outfits: not found unless it is on a template board of
 * the account's, refused once kept or once the board's anchor is gone. */
const replaceable = Effect.fnUntraced(function* (accountId: string, boardId: string, outfitId: string) {
  const store = yield* BoardStore
  const board = yield* ownBoard(accountId, boardId)
  const found = yield* stored(store.findOutfit(boardId, outfitId))
  if (board.template !== 'outfitsAround' || Option.isNone(found)) return yield* NotFound.make({})
  if (found.value.lookId !== null) return yield* OutfitRefused.make({ reason: 'kept', missing: [] })
  if (board.anchorPieceId === null) return yield* OutfitRefused.make({ reason: 'anchorGone', missing: [] })
  const outfits = yield* stored(store.outfitsOf([boardId]))
  const worn = yield* stored(store.outfitPiecesOf(outfits.map(({ id }) => id)))
  const piecesOf = (id: string) => worn.filter((row) => row.outfitId === id).map(({ piece }) => piece.id)
  return { board, anchorId: PieceId.make(board.anchorPieceId), outfit: found.value, outfits, piecesOf }
})

/** What another outfit in a place writes (`anotherOutfit`): its pieces and run, its cluster laid out where it was among
 * the board's others, the pins it needs and the receipt. */
const replacementOf = Effect.fnUntraced(function* (
  operation: Identified,
  target: Effect.Success<ReturnType<typeof replaceable>>,
  batch: Effect.Success<ReturnType<typeof madeOutfits>>,
  proposal: { readonly pieceIds: ReadonlyArray<PieceId> },
) {
  const { board, anchorId, outfit, outfits, piecesOf } = target
  const place = outfits.findIndex(({ id }) => id === outfit.id)
  const layout = outfits.map(({ id }) => (id === outfit.id ? proposal.pieceIds : piecesOf(id)))
  const found = yield* typesOf([anchorId, ...layout.flat()])
  const placed = outfitsAround(anchorId, toLayout(layout, found), shiftOf(board.id)).filter(
    (piece) => piece.outfit === place,
  )
  const at = yield* nowDate
  const change: OutfitReplacement = {
    accountId: operation.accountId,
    boardId: board.id,
    version: board.version,
    outfit: { id: outfit.id, session: batch.session, mode: batch.mode },
    pieceIds: proposal.pieceIds,
    items: yield* placedRows(
      placed,
      outfits.map(({ id }) => id),
    ),
    pins: yield* newPins(board.id, proposal.pieceIds.map(pieceTarget), at),
    receipt: yield* receiptRow(operation, board.id),
    at,
  }
  return change
})

export const template = Effect.map(Effect.context<BoardServices | Outfits>(), (context) => ({
  /** Start a "One piece, six outfits" board around one of the account's ready pieces, once per operation id: up to
   * six complete outfits by Fast, laid out as clusters on a paper chosen from the piece's colour, every piece pinned.
   * With no complete outfit around the piece, no board is made and the refusal says what the wardrobe lacks. */
  createOutfitBoard: Effect.fn('Styld.Boards.createOutfitBoard')(function* (input: CreateOutfitBoard) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'createOutfitBoard',
      input: [input.name, input.anchorPieceId, input.season ?? null],
    })
    const earlier = yield* madeBefore(operation)
    if (Option.isSome(earlier)) return earlier.value
    const batch = yield* madeOutfits({
      operationId: outfitsOperation(input.operationId),
      brief: input.season === undefined ? {} : { season: input.season },
      anchorPieceId: input.anchorPieceId,
      seen: [],
      count: outfitsPerBoard,
    })
    const made = yield* outfitBoardOf(operation, input, batch)
    const committed = yield* Effect.option((yield* BoardStore).createOutfitBoard(made))
    if (Option.isSome(committed)) return yield* one(accountId, made.board.id)
    // A concurrent repeat of the operation may have committed first; its board answers.
    const repeat = yield* madeBefore(operation)
    return Option.isSome(repeat) ? repeat.value : yield* unavailable()
  }, Effect.provide(context)),
  /** Another complete outfit in place of one not kept yet, none of those shown, laid out where its cluster was; the
   * board's version moves on, so an editor open on it reloads. Once per operation id. */
  anotherOutfit: Effect.fn('Styld.Boards.anotherOutfit')(function* (
    boardId: BoardId,
    outfitId: BoardOutfitId,
    input: AnotherOutfit,
  ) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'anotherOutfit',
      input: [boardId, outfitId, input.seen],
    })
    if (Option.isSome(yield* priorOf(operation))) return yield* one(accountId, boardId)
    const target = yield* replaceable(accountId, boardId, outfitId)
    const shown = [...input.seen, ...target.outfits.map(({ id }) => outfitKeyOf(target.piecesOf(id)))]
    const batch = yield* madeOutfits({
      operationId: outfitsOperation(input.operationId),
      session: OutfitSession.make(target.outfit.session),
      brief: target.outfit.season === null ? {} : { season: target.outfit.season },
      anchorPieceId: target.anchorId,
      seen: shown.slice(-mostSeen),
      count: 1,
    })
    const [proposal] = batch.proposals
    if (proposal === undefined) return yield* OutfitRefused.make({ reason: 'noOutfits', missing: batch.missing })
    const change = yield* replacementOf(operation, target, batch, proposal)
    const committed = yield* Effect.option((yield* BoardStore).replaceOutfit(change))
    if (Option.isSome(committed) || Option.isSome(yield* priorOf(operation))) return yield* one(accountId, boardId)
    // The board was saved or the outfit kept meanwhile; asked again, it is read as it is now.
    return yield* unavailable()
  }, Effect.provide(context)),
}))
