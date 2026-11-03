import {
  Board,
  type BoardId,
  type BoardItem,
  BoardSummary,
  CurrentAccount,
  type Look,
  NotFound,
  Unavailable,
} from '@styld/protocol'
import { Effect, Match, Option, Schema } from 'effect'
import type { WardrobeStore } from '../wardrobe/Store.ts'
import type { Database, StoreUnavailable } from '../kernel/Db.ts'
import type { Media } from '../kernel/Media.ts'
import type { SignedMedia } from '../kernel/SignedMedia.ts'
import { toPiece } from '../wardrobe/Shared.ts'
import { type BoardItemRow, type BoardPinRow, type BoardRow, BoardStore, type PinRow } from './Store.ts'
import { newId } from '../kernel/Ids.ts'
import { madeBefore, type Identified } from '../kernel/Receipts.ts'
import { Checks } from '../safety/Checks.ts'
import { Looks } from '../looks/Looks.ts'
import { PublicPages } from '../social/Public.ts'

// What the board operations share: the services they work through, how a board is shown, receipts, ownership and new
// pins.

export const unavailable = () => Unavailable.make({})
export const stored = <A, R>(effect: Effect.Effect<A, StoreUnavailable, R>) => Effect.mapError(effect, unavailable)
/** How many of its newest pins a board in a list shows. */
const coverPins = 4

/** A stored item as the protocol shows it. */
export const shownItem = (row: BoardItemRow) => {
  const placement = { id: row.id, x: row.x, y: row.y, size: row.size, turn: row.turn, z: row.z, flipped: row.flipped }
  return Match.value(row.kind).pipe(
    Match.when('piece', () => ({ _tag: 'PieceItem', ...placement, pieceId: row.pieceId })),
    Match.when('text', () => ({ _tag: 'TextItem', ...placement, text: row.text, style: row.textStyle })),
    Match.when('image', () => ({ _tag: 'ImageItem', ...placement, imageId: row.imageId })),
    Match.exhaustive,
  )
}

/** An item as a row: its kind and the one column that kind uses. */
export const itemRow = (item: BoardItem): Omit<BoardItemRow, 'boardId'> => {
  const row = {
    id: item.id,
    x: item.x,
    y: item.y,
    size: item.size,
    turn: item.turn,
    z: item.z,
    flipped: item.flipped,
    pieceId: null,
    imageId: null,
    text: null,
    textStyle: null,
  }
  return Match.value(item).pipe(
    Match.tagsExhaustive({
      PieceItem: ({ pieceId }) => ({ ...row, kind: 'piece' as const, pieceId }),
      TextItem: ({ text, style }) => ({ ...row, kind: 'text' as const, text, textStyle: style }),
      ImageItem: ({ imageId }) => ({ ...row, kind: 'image' as const, imageId }),
    }),
  )
}

/** The services the board operations work through, provided once by the `Boards` layer. */
export type BoardServices = Database | Media | SignedMedia | BoardStore | WardrobeStore | Checks | Looks | PublicPages

/** The looks these pins hold, by id. */
const pinnedLooks = (pins: ReadonlyArray<PinRow>) =>
  Effect.gen(function* () {
    const lookIds = [...new Set(pins.flatMap(({ pin }) => (pin.lookId === null ? [] : [pin.lookId])))]
    if (lookIds.length === 0) return new Map<string, Look>()
    const looks = yield* (yield* Looks).looksById(lookIds)
    return new Map(looks.map((look) => [look.id, look]))
  })

/** A stored pin as the protocol shows it, to be decoded with its board; a pin whose piece, look or picture is
 * gone shows nothing. */
const shownPin = (row: PinRow, looks: ReadonlyMap<string, Look>) =>
  Effect.gen(function* () {
    const base = { id: row.pin.id, addedAt: row.pin.createdAt.toISOString() }
    const look = row.pin.lookId === null ? undefined : looks.get(row.pin.lookId)
    const shownRow: ReadonlyArray<object> =
      row.pin.kind === 'piece' && row.piece !== null
        ? [{ _tag: 'PiecePin', ...base, piece: yield* toPiece(row.piece, row.picture ?? undefined) }]
        : row.pin.kind === 'picture' && row.pin.imageId !== null
          ? [{ _tag: 'PicturePin', ...base, imageId: row.pin.imageId, generated: row.origin === 'generated' }]
          : row.pin.kind === 'look' && look !== undefined
            ? [{ _tag: 'LookPin', ...base, look }]
            : []
    return shownRow
  })

const shownPins = (pins: ReadonlyArray<PinRow>) =>
  Effect.gen(function* () {
    const looks = yield* pinnedLooks(pins)
    const shownRows = yield* Effect.forEach(pins, (row) =>
      Effect.map(shownPin(row, looks), (shownRow) => ({ boardId: row.pin.boardId, pins: shownRow })),
    )
    return (boardId: string) => shownRows.filter((row) => row.boardId === boardId).flatMap((row) => row.pins)
  })

/** The pins others see on these boards of one account while they are public, by the public pages' rule. */
const publicPinIds = (rows: ReadonlyArray<BoardRow>, pins: ReadonlyArray<PinRow>) => {
  const publicBoards = new Set(rows.filter(({ visibility }) => visibility === 'public').map(({ id }) => id))
  const [owner] = rows
  if (owner === undefined || publicBoards.size === 0) return Effect.succeed(new Set<string>())
  return Effect.flatMap(PublicPages, (pages) =>
    pages.pinsShown(
      owner.accountId,
      pins.filter(({ pin }) => publicBoards.has(pin.boardId)),
    ),
  )
}

/** Boards as their owner sees them, each with its table, its pins and which of them others see. */
export const shown = (rows: ReadonlyArray<BoardRow>) =>
  Effect.gen(function* () {
    const ids = rows.map(({ id }) => id)
    const items = yield* stored((yield* BoardStore).itemsOf(ids))
    const pins = yield* stored((yield* BoardStore).pinsOf(ids))
    const pinsOf = yield* shownPins(pins)
    const seen = yield* publicPinIds(rows, pins)
    const checks = yield* (yield* Checks).statuses('board', ids)
    return yield* Effect.forEach(rows, (row) =>
      // Only the service writes rows, through the same schemas; a row that does not decode is a bug.
      Schema.decodeUnknownEffect(Board)({
        id: row.id,
        name: row.name,
        paper: row.paper,
        version: row.version,
        items: items.filter(({ boardId }) => boardId === row.id).map(shownItem),
        pins: pinsOf(row.id),
        publicPins: pins.flatMap(({ pin }) => (pin.boardId === row.id && seen.has(pin.id) ? [pin.id] : [])),
        // Only the service writes moods, through the protocol's literals; others were never stored.
        moods: row.moods,
        visibility: row.visibility,
        check: checks.get(row.id) ?? null,
        updatedAt: row.updatedAt.toISOString(),
      }).pipe(Effect.orDie),
    )
  })

/** Boards in a list: each with its table, its newest pins and how many it holds. */
export const summaries = (rows: ReadonlyArray<BoardRow>) =>
  Effect.gen(function* () {
    const ids = rows.map(({ id }) => id)
    const items = yield* stored((yield* BoardStore).itemsOf(ids))
    const coverOf = yield* shownPins(yield* stored((yield* BoardStore).coversOf(ids, coverPins)))
    const counts = yield* stored((yield* BoardStore).pinCounts(ids))
    return yield* Effect.forEach(rows, (row) =>
      Schema.decodeUnknownEffect(BoardSummary)({
        id: row.id,
        name: row.name,
        paper: row.paper,
        items: items.filter(({ boardId }) => boardId === row.id).map(shownItem),
        cover: coverOf(row.id),
        pinCount: counts.get(row.id) ?? 0,
        visibility: row.visibility,
        updatedAt: row.updatedAt.toISOString(),
      }).pipe(Effect.orDie),
    )
  })

export const ownBoard = (accountId: string, boardId: string) =>
  Effect.flatMap(stored(Effect.flatMap(BoardStore, (store) => store.findBoard(accountId, boardId))), (row) =>
    Option.match(row, { onNone: () => Effect.fail(NotFound.make({})), onSome: Effect.succeed }),
  )

export const one = (accountId: string, boardId: string) =>
  Effect.gen(function* () {
    const [board] = yield* shown([yield* ownBoard(accountId, boardId)])
    return board ?? (yield* NotFound.make({}))
  })

/** What an operation already made on the boards, by the kernel's receipt rule. */
export const priorOf = (operation: Identified) => Effect.flatMap(BoardStore, (store) => madeBefore(store, operation))

/** New pins for things a board does not hold yet, the first of them newest. */
export const newPins = (
  boardId: string,
  targets: ReadonlyArray<Pick<BoardPinRow, 'kind' | 'pieceId' | 'lookId' | 'imageId'>>,
  at: Date,
) =>
  Effect.forEach(targets, (target, index) =>
    Effect.map(newId('pn'), (id): BoardPinRow => ({
      id,
      boardId,
      ...target,
      createdAt: new Date(at.getTime() + targets.length - index),
    })),
  )

/** The account's pieces pinned on a public board go to the queue: the board puts them in front of others, and a
 * piece changed while it was private must not show under its old check. The queue skips what was checked as it is. */
export const pinnedPiecesChecked = (accountId: string, boardId: string) =>
  Effect.gen(function* () {
    const pieceIds = (yield* stored((yield* BoardStore).pinsOf([boardId]))).flatMap(({ piece }) =>
      piece !== null && piece.accountId === accountId ? [piece.id] : [],
    )
    yield* (yield* Checks).checkLater(pieceIds.map((id) => ({ kind: 'piece' as const, id })))
  })

/** An edit of a board, after which a public board's check is pending again and its new pieces are checked. */
export const rechecked =
  <I, A, E, R>(edit: (boardId: BoardId, input: I) => Effect.Effect<A, E, R>) =>
  (boardId: BoardId, input: I) =>
    Effect.tap(edit(boardId, input), () =>
      Effect.gen(function* () {
        if (!(yield* (yield* Checks).changed({ kind: 'board', id: boardId }))) return
        const { accountId } = yield* CurrentAccount
        yield* pinnedPiecesChecked(accountId, boardId)
      }),
    )

export const pieceTarget = (pieceId: string) => ({ kind: 'piece' as const, pieceId, lookId: null, imageId: null })
export const lookTarget = (lookId: string) => ({ kind: 'look' as const, pieceId: null, lookId, imageId: null })
