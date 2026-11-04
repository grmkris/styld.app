import {
  type Board,
  BoardId,
  CurrentAccount,
  OperationId,
  outfitsIn,
  PiecePin,
  type PieceId,
  PinId,
  searchText,
  type SeedBoardRequest,
  SeedRefused,
  TextItem,
} from '@styld/protocol'
import { Array, Effect, Option, Schema } from 'effect'
import { Boards } from '../boards/Boards.ts'
import { outfitsOperation } from '../boards/Template.ts'
import { BoardRows } from '../boards/Rows.ts'
import { Database, nowDate, query } from '../kernel/Db.ts'
import { digestOf } from '../kernel/Ids.ts'
import { forgetReceipt } from '../kernel/Receipts.ts'
import type { Wearable } from '../outfits/Rules.ts'
import { boardSourceDigest } from '../social/Translated.ts'
import { type SeededRow, SeedRows } from './Store.ts'
import { type Garment, outfitsOf, tableOf } from './Tables.ts'

// One house board built as the house account, by the app's own board services (owner, 4 November 2026): made private,
// its table laid out and every piece pinned, its tags, Slovenian and search words written, and only then made public,
// so What's new shows it once and never a pin at a time. A changed entry changes the same board in place and leaves it
// public, so it is never bumped to the top again.

const isTextItem = Schema.is(TextItem)
const isPiecePin = Schema.is(PiecePin)

/** What the board shows: its garments in the catalogue's order, and its outfits by the build. */
export interface BoardPlan {
  readonly garments: ReadonlyArray<Garment>
  readonly anchor: Option.Option<Garment>
  readonly outfits: ReadonlyArray<ReadonlyArray<PieceId>>
}

const badEntry = (detail: string) => SeedRefused.make({ reason: 'badEntry', detail: [detail] })

/** The board's plan from its garments (by manifest id, all imported and ready): a one-piece board's or an outfits
 * board's outfits chosen by Fast's rules from the board's own pieces, the same for the same entry. */
export const planOf = Effect.fnUntraced(function* (
  seedId: string,
  request: SeedBoardRequest,
  wearables: ReadonlyMap<string, Wearable>,
) {
  const { board } = request
  const wearing = (id: string) => Option.fromNullishOr(wearables.get(id))
  const garments = board.pieces.flatMap((id) => Option.toArray(wearing(id)))
  const anchor = Option.flatMap(Option.fromUndefinedOr(board.anchor), wearing)
  const plan = (outfits: ReadonlyArray<ReadonlyArray<PieceId>>): BoardPlan => ({ garments, anchor, outfits })
  if (board.build === 'pack' || board.build === 'pieceCollage') return plan([])
  if (board.build === 'look') return plan([garments.map(({ id }) => id)])
  return plan(yield* chosenOutfits(seedId, request, garments, anchor))
})

/** A one-piece board's outfits around its anchor in its layout's number, or an outfits board's number; fewer than
 * asked refuses the entry. */
const chosenOutfits = Effect.fnUntraced(function* (
  seedId: string,
  request: SeedBoardRequest,
  garments: ReadonlyArray<Wearable>,
  anchor: Option.Option<Wearable>,
) {
  const { board } = request
  const seed = seedId
  const season = board.season === undefined ? {} : { season: board.season }
  if (board.build === 'onePiece') {
    if (Option.isNone(anchor) || board.layout === undefined) return yield* badEntry('anchorAndLayoutNeeded')
    if (board.labels.length > 0) return yield* badEntry('textsOnOnePiece')
  }
  const count =
    board.layout !== undefined && board.build === 'onePiece' ? outfitsIn(board.layout) : (board.outfits ?? 0)
  if (count === 0) return yield* badEntry('outfitsNeeded')
  const outfits = Option.match(anchor, {
    onNone: () => outfitsOf(garments, count, seed, season),
    onSome: (fixed) => outfitsOf([fixed, ...garments], count, seed, { ...season, anchor: fixed }),
  })
  if (outfits.length < count) return yield* SeedRefused.make({ reason: 'noOutfits', detail: [seedId] })
  return outfits
})

/** A step's operation id: the same entry and step give the same id, so a retry within the receipts' month answers
 * from its receipt; a changed entry is a new operation. */
export const stepOf = (seedId: string, step: string, version: number, digest: string) =>
  Effect.map(digestOf(`${seedId}:${step}:${String(version)}:${digest}`), (hex) =>
    OperationId.make(`seed-${hex.replaceAll(/[^A-Za-z0-9]/gu, '').slice(0, 40)}`),
  )

/** Every step an entry's board was made or last changed under. */
const boardSteps = ['create', 'details', 'table', 'publish', 'unpin'] as const

/** Forget the receipts of the steps an entry's board was made and last changed under, before the board is removed:
 * the same entry seeded again then makes a new board, where the receipts would answer with the removed one. */
export const forgetSteps = Effect.fnUntraced(function* (prior: SeededRow) {
  const db = yield* Database
  const steps = yield* Effect.forEach(boardSteps, (step) => stepOf(prior.seedId, step, prior.version, prior.digest))
  const [create, ...rest] = steps
  yield* query(() =>
    db.batch([
      forgetReceipt(db, prior.accountId, create),
      forgetReceipt(db, prior.accountId, outfitsOperation(create)),
      ...rest.map((id) => forgetReceipt(db, prior.accountId, id)),
    ]),
  )
})

/** The digest of the table an entry lays out, and of the whole entry: a changed name, tag or translation keeps the
 * table as it is, and a new catalogue version with the entry unchanged changes nothing. */
export const digestsOf = (request: SeedBoardRequest) =>
  Effect.all({
    table: digestOf(
      JSON.stringify([
        request.board.build,
        request.board.pieces,
        request.board.anchor ?? null,
        request.board.layout ?? null,
        request.board.outfits ?? null,
        request.board.season ?? null,
        request.board.labels.map(({ text, style }) => [text, style]),
      ]),
    ),
    whole: digestOf(JSON.stringify(request.board)),
  }).pipe(Effect.map(({ table, whole }) => `${table}.${whole}`))

/** The table digest part of a stored digest.
 * @internal Exported for its tests. */
export const tablePart = (digest: string) => digest.split('.')[0] ?? ''

const labelsOf = (board: Board) => board.items.filter(isTextItem).toSorted((a, b) => a.z - b.z)

/** The board's tags, its Slovenian (labels by the items that hold them), the words search finds it by, and the seed's
 * receipt, as one batch. */
const finished = Effect.fnUntraced(function* (
  accountId: string,
  seedId: string,
  request: SeedBoardRequest,
  digest: string,
  board: Board,
) {
  const db = yield* Database
  const at = yield* nowDate
  const texts = labelsOf(board)
  const sl = request.board.sl
  const labels = Object.fromEntries(
    Array.zip(texts, request.board.labels).map(([item, label]) => [item.id, label.sl] as const),
  )
  const sourceDigest = yield* boardSourceDigest(
    board.name,
    texts.map(({ id, text }) => ({ id, text })),
  )
  const row: SeededRow = { accountId, seedId, boardId: board.id, version: request.version, digest }
  const tags = request.board.tags
  yield* query(() =>
    db.batch([
      BoardRows.untagged(db, board.id),
      ...(tags.length === 0 ? [] : [BoardRows.tagged(db, board.id, tags)]),
      BoardRows.translated(db, {
        boardId: board.id,
        locale: 'sl',
        name: sl.name,
        labels,
        sourceDigest,
        review: sl.review,
        updatedAt: at,
      }),
      BoardRows.searchedAs(db, board.id, accountId, searchText(board.name, sl.name)),
      SeedRows.recorded(db, row),
    ]),
  )
})

/** The house board of a new entry: made private, laid out, pinned, tagged and translated, then public. */
export const createdBoard = Effect.fnUntraced(function* (
  seedId: string,
  request: SeedBoardRequest,
  digest: string,
  plan: BoardPlan,
) {
  const { accountId } = yield* CurrentAccount
  const boards = yield* Boards
  const op = (step: string) => stepOf(seedId, step, request.version, digest)
  const { board } = request
  const made =
    board.build === 'onePiece' && Option.isSome(plan.anchor) && board.layout !== undefined
      ? yield* boards.seededOutfitBoard(
          {
            operationId: yield* op('create'),
            name: board.name,
            anchorPieceId: plan.anchor.value.id,
            ...(board.season === undefined ? {} : { season: board.season }),
          },
          board.layout,
          plan.outfits,
        )
      : yield* boards.createBoard({ operationId: yield* op('create'), name: board.name })
  const styled = yield* boards.updateBoard(made.id, {
    operationId: yield* op('details'),
    paper: board.paper,
    moods: board.moods,
  })
  const laid = board.build === 'onePiece' ? styled : yield* laidOut(seedId, request, digest, plan, styled)
  yield* finished(accountId, seedId, request, digest, laid)
  return yield* boards.setBoardVisibility(laid.id, { operationId: yield* op('publish'), visibility: 'public' })
})

/** The table set as the entry lays it out, from the board's current version; it pins what it places. */
const laidOut = Effect.fnUntraced(function* (
  seedId: string,
  request: SeedBoardRequest,
  digest: string,
  plan: BoardPlan,
  board: Board,
) {
  if (request.board.build === 'onePiece') return board
  const byId = new Map(plan.garments.map((garment) => [garment.id, garment]))
  const outfits = plan.outfits.map((outfit) =>
    outfit.flatMap((id) => Option.toArray(Option.fromNullishOr(byId.get(id)))),
  )
  const items = tableOf(request.board.build, plan.garments, outfits, request.board.labels)
  return yield* (yield* Boards).setTable(board.id, {
    operationId: yield* stepOf(seedId, 'table', request.version, digest),
    version: board.version,
    items,
  })
})

/** An entry that changed: the same board renamed and restyled, its table laid out again when that changed, pins it no
 * longer shows removed, its tags and Slovenian replaced. It stays public, so it is not bumped. A one-piece board's
 * outfits are not changed in place: remove it and seed it again. */
export const updatedBoard = Effect.fnUntraced(function* (
  seedId: string,
  request: SeedBoardRequest,
  digest: string,
  prior: SeededRow,
  plan: BoardPlan,
) {
  const { accountId } = yield* CurrentAccount
  const boards = yield* Boards
  const tableChanged = tablePart(prior.digest) !== tablePart(digest)
  if (tableChanged && request.board.build === 'onePiece') return yield* badEntry('onePieceOutfitsChanged')
  const boardId = BoardId.make(prior.boardId)
  const styled = yield* boards.updateBoard(boardId, {
    operationId: yield* stepOf(seedId, 'details', request.version, digest),
    name: request.board.name,
    paper: request.board.paper,
    moods: request.board.moods,
  })
  const laid = tableChanged ? yield* laidOut(seedId, request, digest, plan, styled) : styled
  const shown = new Set<string>(plan.garments.map(({ id }) => id))
  const stale = laid.pins.flatMap((pin) => (isPiecePin(pin) && !shown.has(pin.piece.id) ? [PinId.make(pin.id)] : []))
  const kept = Array.isArrayNonEmpty(stale)
    ? yield* boards.removePins(boardId, {
        operationId: yield* stepOf(seedId, 'unpin', request.version, digest),
        pinIds: stale,
      })
    : laid
  yield* finished(accountId, seedId, request, digest, kept)
  return kept
})
