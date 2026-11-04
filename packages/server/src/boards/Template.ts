import {
  type AnotherLayout,
  type AnotherOutfit,
  type BoardId,
  BoardItemId,
  type BoardOutfitId,
  clusterLaidOut,
  type CreateOutfitBoard,
  CurrentAccount,
  type MakeOutfit,
  mostSeen,
  NotFound,
  OperationConflict,
  OperationId,
  type OutfitProposals,
  OutfitSession,
  type OutfitPiece,
  OutfitRefused,
  outfitKeyOf,
  type OutfitLayout,
  layoutFor,
  outfitsIn,
  outfitsLaidOut,
  PieceId,
  type PieceType,
  type PlacedOutfitPiece,
  searchText,
} from '@styld/protocol'
import { Array, Effect, Option } from 'effect'
import { nowDate } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { identify, type Identified, receiptRow } from '../kernel/Receipts.ts'
import { Outfits } from '../outfits/Outfits.ts'
import { newPins, one, ownBoard, pieceTarget, priorOf, stored, unavailable, type BoardServices } from './Shared.ts'
import {
  type BoardItemRow,
  type BoardOutfitRow,
  type BoardRow,
  BoardStore,
  type OutfitBoard,
  type OutfitReplacement,
  type Relayout,
} from './Store.ts'

// "One piece, many outfits" (T-10, owner 4 November 2026): a board started from one of the person's pieces, with
// complete outfits around it made by the engine's Fast way, free, laid out on warm sand paper in one of the layouts
// after Eva's references (the piece large in the centre, each outfit a flat-lay around it), chosen by chance. Each
// outfit can be kept as a look (`keepLook`) or replaced by another until it is; "Another layout" deals a new layout.

/** The layout a template board's outfits are in: one made before layouts reads as six flanking. */
const layoutOf = (board: Pick<BoardRow, 'layout'>): OutfitLayout => board.layout ?? 'flanking'

/** The engine's own operation id for a board operation's outfits: the request's, so a repeat asks it the same. */
export const outfitsOperation = (operationId: string) => OperationId.make(`${operationId.slice(0, 56)}-outfits`)

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
  placed: ReadonlyArray<PlacedOutfitPiece>,
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
      outfitId: outfit === null ? null : (outfitIds[outfit] ?? null),
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

/** What a new outfit board writes (`createOutfitBoard`): the board on sand paper, as in every one of Eva's references,
 * its outfits in their places, the anchor and their clusters on its table in the layout, every piece pinned, and the
 * operation's receipt. */
const outfitBoardOf = Effect.fnUntraced(function* (
  operation: Identified,
  input: CreateOutfitBoard,
  layout: OutfitLayout,
  batch: Pick<OutfitProposals, 'session' | 'mode'> & {
    readonly proposals: ReadonlyArray<Pick<OutfitProposals['proposals'][number], 'pieceIds'>>
  },
) {
  const { accountId } = operation
  const pieceIds = batch.proposals.map(({ pieceIds: worn }) => worn)
  const found = yield* typesOf([input.anchorPieceId, ...pieceIds.flat()])
  const anchor = found.get(input.anchorPieceId)
  if (anchor === undefined) return yield* NotFound.make({})
  const boardId = yield* newId('bd')
  const at = yield* nowDate
  const outfitIds = yield* Effect.forEach(pieceIds, () => newId('bo'))
  const placed = outfitsLaidOut(layout, input.anchorPieceId, toLayout(pieceIds, found), shiftOf(boardId))
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
      paper: 'sand',
      version: 0,
      visibility: 'private',
      moods: [],
      publishedAt: null,
      featuredAt: null,
      searchText: searchText(input.name),
      template: 'outfitsAround',
      anchorPieceId: input.anchorPieceId,
      layout,
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

/** A new outfit board saved, as the account reads it; a concurrent repeat of the operation may have committed first,
 * and its board answers. */
const savedOutfitBoard = Effect.fnUntraced(function* (operation: Identified, made: OutfitBoard) {
  const committed = yield* Effect.option((yield* BoardStore).createOutfitBoard(made))
  if (Option.isSome(committed)) return yield* one(operation.accountId, made.board.id)
  const repeat = yield* madeBefore(operation)
  return Option.isSome(repeat) ? repeat.value : yield* unavailable()
})

/** The account's template board with its anchor and outfits: not found unless it is one, refused once its anchor is
 * gone. */
const templateBoard = Effect.fnUntraced(function* (accountId: string, boardId: string) {
  const store = yield* BoardStore
  const board = yield* ownBoard(accountId, boardId)
  if (board.template !== 'outfitsAround') return yield* NotFound.make({})
  if (board.anchorPieceId === null) return yield* OutfitRefused.make({ reason: 'anchorGone', missing: [] })
  const outfits = yield* stored(store.outfitsOf([boardId]))
  const worn = yield* stored(store.outfitPiecesOf(outfits.map(({ id }) => id)))
  const piecesOf = (id: string) => worn.filter((row) => row.outfitId === id).map(({ piece }) => piece.id)
  return { board, anchorId: PieceId.make(board.anchorPieceId), outfits, piecesOf }
})

/** The outfit to replace, with its board and the board's other outfits: not found unless it is on a template board of
 * the account's, refused once kept or once the board's anchor is gone. */
const replaceable = Effect.fnUntraced(function* (accountId: string, boardId: string, outfitId: string) {
  const found = yield* stored((yield* BoardStore).findOutfit(boardId, outfitId))
  if (Option.isNone(found)) return yield* NotFound.make({})
  const target = yield* templateBoard(accountId, boardId)
  if (found.value.lookId !== null) return yield* OutfitRefused.make({ reason: 'kept', missing: [] })
  return { ...target, outfit: found.value }
})

/** Which outfits stay in a layout holding `holds`: every kept one, and the first others in their places while there
 * is room; the rest leave. */
const stayingIn = (outfits: ReadonlyArray<BoardOutfitRow>, holds: number) => {
  const kept = outfits.filter(({ lookId }) => lookId !== null).length
  const room = new Set(outfits.filter(({ lookId }) => lookId === null).slice(0, Math.max(0, holds - kept)))
  const staying = outfits.filter((outfit) => outfit.lookId !== null || room.has(outfit))
  return { staying, leaving: outfits.filter((outfit) => !staying.includes(outfit)) }
}

/** What another layout writes (`anotherLayout`): the outfits that stay in their new places, those that leave, the new
 * ones the engine made for the room left, the anchor and every cluster laid out again, the pins and the receipt. */
const relayoutOf = Effect.fnUntraced(function* (
  operation: Identified,
  target: Effect.Success<ReturnType<typeof templateBoard>>,
  layout: OutfitLayout,
  more: Option.Option<Effect.Success<ReturnType<typeof madeOutfits>>>,
) {
  const { board, anchorId, outfits, piecesOf } = target
  const { staying, leaving } = stayingIn(outfits, outfitsIn(layout))
  const at = yield* nowDate
  const season = outfits[0]?.season ?? null
  const added = yield* Option.match(more, {
    onNone: () => Effect.succeed([]),
    onSome: (batch) =>
      Effect.forEach(batch.proposals, (proposal, index) =>
        Effect.map(newId('bo'), (id) => ({
          row: {
            id,
            accountId: operation.accountId,
            boardId: board.id,
            position: staying.length + index,
            mode: batch.mode,
            session: batch.session,
            season,
            lookId: null,
            createdAt: at,
          },
          pieceIds: proposal.pieceIds,
        })),
      ),
  })
  const order: ReadonlyArray<{ readonly id: string; readonly pieceIds: ReadonlyArray<string> }> = [
    ...staying.map(({ id }) => ({ id, pieceIds: piecesOf(id) })),
    ...added.map(({ row, pieceIds }) => ({ id: row.id, pieceIds })),
  ]
  const found = yield* typesOf([anchorId, ...order.flatMap(({ pieceIds }) => pieceIds)])
  const placed = outfitsLaidOut(
    layout,
    anchorId,
    toLayout(
      order.map(({ pieceIds }) => pieceIds),
      found,
    ),
    shiftOf(board.id),
  )
  const change: Relayout = {
    accountId: operation.accountId,
    boardId: board.id,
    version: board.version,
    layout,
    anchorPieceId: anchorId,
    staying: staying.map(({ id }, position) => ({ id, position })),
    leaving: leaving.map(({ id }) => id),
    added,
    items: yield* placedRows(
      placed,
      order.map(({ id }) => id),
    ),
    pins: yield* newPins(board.id, [...new Set(added.flatMap(({ pieceIds }) => pieceIds))].map(pieceTarget), at),
    receipt: yield* receiptRow(operation, board.id),
    at,
  }
  return change
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
  const placed = clusterLaidOut(layoutOf(board), anchorId, toLayout(layout, found), place, shiftOf(board.id))
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

/** The board's outfits laid out in another layout than the one they are in, chosen by chance among those that hold
 * every kept outfit; as many outfits as it holds: the engine makes more for the room left (none it can make leaves
 * the room empty), and the last ones not kept leave when it holds fewer. Once per operation id. */
const anotherLayout = Effect.fn('Styld.Boards.anotherLayout')(function* (boardId: BoardId, input: AnotherLayout) {
  const { accountId } = yield* CurrentAccount
  const operation = yield* identify({
    accountId,
    operationId: input.operationId,
    command: 'anotherLayout',
    input: [boardId],
  })
  if (Option.isSome(yield* priorOf(operation))) return yield* one(accountId, boardId)
  const target = yield* templateBoard(accountId, boardId)
  const kept = target.outfits.filter(({ lookId }) => lookId !== null).length
  const layout = layoutFor(input.operationId, { other: layoutOf(target.board), fewest: kept })
  const room = outfitsIn(layout) - stayingIn(target.outfits, outfitsIn(layout)).staying.length
  const [first] = target.outfits
  const more =
    room <= 0
      ? Option.none()
      : yield* madeOutfits({
          operationId: outfitsOperation(input.operationId),
          ...(first === undefined ? {} : { session: OutfitSession.make(first.session) }),
          brief: first?.season == null ? {} : { season: first.season },
          anchorPieceId: target.anchorId,
          seen: target.outfits.map(({ id }) => outfitKeyOf(target.piecesOf(id))).slice(-mostSeen),
          count: room,
        }).pipe(
          Effect.map(Option.some),
          Effect.catchTag('OutfitRefused', () => Effect.succeed(Option.none())),
        )
  const change = yield* relayoutOf(operation, target, layout, more)
  const committed = yield* Effect.option((yield* BoardStore).relayOut(change))
  if (Option.isSome(committed) || Option.isSome(yield* priorOf(operation))) return yield* one(accountId, boardId)
  // The board was saved meanwhile; asked again, it is laid out from how it is now.
  return yield* unavailable()
})

/** Every "One piece, many outfits" board of the account laid out again in its own layout, its outfits kept and
 * centred in their places (Eva's report of 4 November 2026: holes in the table), for the operator's backfill
 * (`tools/relayout-boards.ts`). Once per board: its receipt is kept, so a repeat lays out nothing twice. A board saved
 * meanwhile or whose anchor is gone is skipped and counted. */
const relayoutCentred = Effect.fn('Styld.Boards.relayoutCentred')(function* () {
  const { accountId } = yield* CurrentAccount
  const store = yield* BoardStore
  const boards = (yield* stored(store.listBoards(accountId))).filter(
    (board) => board.template === 'outfitsAround' && board.anchorPieceId !== null,
  )
  const outcomes = yield* Effect.forEach(boards, (board) =>
    Effect.gen(function* () {
      const operation = yield* identify({
        accountId,
        operationId: `relayout-${board.id}`,
        command: 'relayoutCentred',
        input: [board.id],
      })
      if (Option.isSome(yield* priorOf(operation))) return false
      const target = yield* templateBoard(accountId, board.id)
      const change = yield* relayoutOf(operation, target, layoutOf(target.board), Option.none())
      return Option.isSome(yield* Effect.option(store.relayOut(change)))
    }).pipe(
      Effect.catchTags({
        NotFound: () => Effect.succeed(false),
        OutfitRefused: () => Effect.succeed(false),
        OperationConflict: () => Effect.succeed(false),
      }),
    ),
  )
  const relaid = outcomes.filter(Boolean).length
  return { boards: boards.length, relaid, skipped: boards.length - relaid }
})

export const template = Effect.map(Effect.context<BoardServices | Outfits>(), (context) => ({
  /** Start a "One piece, many outfits" board around one of the account's ready pieces, once per operation id: a layout
   * by chance, as many complete outfits by Fast as it holds, laid out around the piece on sand paper, every piece pinned.
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
    const layout = layoutFor(input.operationId)
    const batch = yield* madeOutfits({
      operationId: outfitsOperation(input.operationId),
      brief: input.season === undefined ? {} : { season: input.season },
      anchorPieceId: input.anchorPieceId,
      seen: [],
      count: outfitsIn(layout),
    })
    return yield* savedOutfitBoard(operation, yield* outfitBoardOf(operation, input, layout, batch))
  }, Effect.provide(context)),
  /** A "One piece, many outfits" board whose layout and outfits were chosen already: the house boards' seed (owner,
   * 4 November 2026) picks them from the board's own pieces by Fast's rules, so the board shows the catalogue's
   * pieces only. Laid out, pinned and answered as `createOutfitBoard`'s, once per operation id. */
  seededOutfitBoard: Effect.fn('Styld.Boards.seededOutfitBoard')(function* (
    input: CreateOutfitBoard,
    layout: OutfitLayout,
    outfits: ReadonlyArray<ReadonlyArray<PieceId>>,
  ) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'seededOutfitBoard',
      input: [input.name, input.anchorPieceId, layout, outfits],
    })
    const earlier = yield* madeBefore(operation)
    if (Option.isSome(earlier)) return earlier.value
    const session = OutfitSession.make(yield* newId('os'))
    const proposals = outfits.map((pieceIds) => ({ pieceIds }))
    return yield* savedOutfitBoard(
      operation,
      yield* outfitBoardOf(operation, input, layout, { session, mode: 'fast', proposals }),
    )
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
  /** The board's outfits laid out in another layout (`anotherLayout`). */
  anotherLayout: (boardId: BoardId, input: AnotherLayout) =>
    anotherLayout(boardId, input).pipe(Effect.provide(context)),
  /** Every "One piece, many outfits" board of the account laid out again (`relayoutCentred`). */
  relayoutCentred: () => relayoutCentred().pipe(Effect.provide(context)),
}))
