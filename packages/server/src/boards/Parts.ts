import {
  Board,
  type BoardId,
  type BoardItem,
  BoardNotFound,
  BoardSummary,
  type Look,
  OperationConflict,
  WardrobeUnavailable,
} from '@styld/protocol'
import { DateTime, Effect, Match, Option, Schema } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import { shownLooks } from '../looks/Looks.ts'
import { type LookStore } from '../looks/Store.ts'
import type { Checks } from '../safety/Checks.ts'
import type { ProfileStore } from '../social/ProfileStore.ts'
import { type ImageBindings } from '../wardrobe/Delivery.ts'
import { type Store } from '../wardrobe/Store.ts'
import { type StoreUnavailable } from '../kernel/Db.ts'
import { toPiece, type WardrobeBindings } from '../wardrobe/Parts.ts'
import { type BoardItemRow, type BoardPinRow, type BoardRow, type BoardStore } from './Store.ts'

// What the board operations share: the bindings, how a board is shown, receipts, ownership and new pins.

/** The bindings boards keep their rows and pictures in. */
export interface BoardBindings extends ImageBindings {
  readonly database: WardrobeBindings['database']
}

export const unavailable = () => WardrobeUnavailable.make({})
export const stored = <A>(effect: Effect.Effect<A, StoreUnavailable>) => Effect.mapError(effect, unavailable)
export const nowDate = Effect.map(DateTime.now, DateTime.toDateUtc)

/** How many of its newest pins a board in a list shows. */
export const coverPins = 4

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

export interface Parts {
  readonly bindings: BoardBindings
  readonly store: BoardStore
  readonly wardrobeStore: Store
  readonly lookStore: LookStore
  readonly profileStore: ProfileStore
  readonly checks: Checks['Service']
  readonly newId: (prefix: 'bd' | 'bm' | 'pn' | 'bi') => Effect.Effect<string, WardrobeUnavailable>
  readonly digest: (text: string) => Effect.Effect<string, WardrobeUnavailable>
}

export type PinWithPiece = Effect.Success<ReturnType<BoardStore['pinsOf']>>[number]

/** The looks these pins hold, by id. */
export const pinnedLooks = (parts: Parts, pins: ReadonlyArray<PinWithPiece>) =>
  Effect.gen(function* () {
    const lookIds = [...new Set(pins.flatMap(({ pin }) => (pin.lookId === null ? [] : [pin.lookId])))]
    if (lookIds.length === 0) return new Map<string, Look>()
    const looks = yield* shownLooks(
      parts.lookStore,
      yield* stored(parts.lookStore.looksById(lookIds)),
      yield* parts.checks.statuses('look', lookIds),
    )
    return new Map(looks.map((look) => [look.id, look]))
  })

/** A stored pin as the protocol shows it, to be decoded with its board; a pin whose piece, look or picture is
 * gone shows nothing. */
export const shownPin = (row: PinWithPiece, looks: ReadonlyMap<string, Look>) =>
  Effect.gen(function* () {
    const base = { id: row.pin.id, addedAt: row.pin.createdAt.toISOString() }
    const look = row.pin.lookId === null ? undefined : looks.get(row.pin.lookId)
    const shownRow: ReadonlyArray<object> =
      row.pin.kind === 'piece' && row.piece !== null
        ? [{ _tag: 'PiecePin', ...base, piece: yield* toPiece(row.piece) }]
        : row.pin.kind === 'picture' && row.pin.imageId !== null
          ? [{ _tag: 'PicturePin', ...base, imageId: row.pin.imageId, generated: row.origin === 'generated' }]
          : row.pin.kind === 'look' && look !== undefined
            ? [{ _tag: 'LookPin', ...base, look }]
            : []
    return shownRow
  })

export const shownPins = (parts: Parts, pins: ReadonlyArray<PinWithPiece>) =>
  Effect.gen(function* () {
    const looks = yield* pinnedLooks(parts, pins)
    const shownRows = yield* Effect.forEach(pins, (row) =>
      Effect.map(shownPin(row, looks), (shownRow) => ({ boardId: row.pin.boardId, pins: shownRow })),
    )
    return (boardId: string) => shownRows.filter((row) => row.boardId === boardId).flatMap((row) => row.pins)
  })

/** Boards as the protocol shows them, each with its table and pins. */
export const shown = (parts: Parts, rows: ReadonlyArray<BoardRow>) =>
  Effect.gen(function* () {
    const ids = rows.map(({ id }) => id)
    const items = yield* stored(parts.store.itemsOf(ids))
    const pinsOf = yield* shownPins(parts, yield* stored(parts.store.pinsOf(ids)))
    const checks = yield* parts.checks.statuses('board', ids)
    return yield* Effect.forEach(rows, (row) =>
      // Only the service writes rows, through the same schemas; a row that does not decode is a bug.
      Schema.decodeUnknownEffect(Board)({
        id: row.id,
        name: row.name,
        paper: row.paper,
        version: row.version,
        items: items.filter(({ boardId }) => boardId === row.id).map(shownItem),
        pins: pinsOf(row.id),
        // Only the service writes moods, through the protocol's literals; others were never stored.
        moods: row.moods,
        visibility: row.visibility,
        check: checks.get(row.id) ?? null,
        updatedAt: row.updatedAt.toISOString(),
      }).pipe(Effect.orDie),
    )
  })

/** Boards in a list: each with its table, its newest pins and how many it holds. */
export const summaries = (parts: Parts, rows: ReadonlyArray<BoardRow>) =>
  Effect.gen(function* () {
    const ids = rows.map(({ id }) => id)
    const items = yield* stored(parts.store.itemsOf(ids))
    const coverOf = yield* shownPins(parts, yield* stored(parts.store.coversOf(ids, coverPins)))
    const counts = yield* stored(parts.store.pinCounts(ids))
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

export const ownBoard = (parts: Parts, accountId: string, boardId: string) =>
  Effect.flatMap(stored(parts.store.findBoard(accountId, boardId)), (row) =>
    Option.match(row, { onNone: () => Effect.fail(BoardNotFound.make({})), onSome: Effect.succeed }),
  )

export const one = (parts: Parts, accountId: string, boardId: string) =>
  Effect.gen(function* () {
    const [board] = yield* shown(parts, [yield* ownBoard(parts, accountId, boardId)])
    return board ?? (yield* BoardNotFound.make({}))
  })

/** What an operation id already did, if anything: its result for the same command and input; anything else
 * under that id is a conflict. */
export const receiptFor = (
  parts: Parts,
  accountId: string,
  operationId: string,
  command: string,
  inputDigest: string,
) =>
  Effect.gen(function* () {
    const receipt = yield* stored(parts.store.findReceipt(accountId, operationId))
    if (Option.isNone(receipt)) return Option.none<string>()
    if (receipt.value.inputDigest !== inputDigest || receipt.value.command !== command)
      return yield* OperationConflict.make({})
    return Option.some(receipt.value.result)
  })

/** A receipt for an operation the account is about to commit. */
export const receiptRow = (
  accountId: string,
  operationId: string,
  command: string,
  inputDigest: string,
  result: string,
) => Effect.map(nowDate, (createdAt) => ({ accountId, operationId, command, inputDigest, result, createdAt }))

/** New pins for things a board does not hold yet, the first of them newest. */
export const newPins = (
  parts: Parts,
  boardId: string,
  targets: ReadonlyArray<Pick<BoardPinRow, 'kind' | 'pieceId' | 'lookId' | 'imageId'>>,
  at: Date,
) =>
  Effect.forEach(targets, (target, index) =>
    Effect.map(parts.newId('pn'), (id): BoardPinRow => ({
      id,
      boardId,
      ...target,
      createdAt: new Date(at.getTime() + targets.length - index),
    })),
  )

/** The account's pieces pinned on a public board go to the queue: the board puts them in front of others, and a
 * piece changed while it was private must not show under its old check. The queue skips what was checked as it is. */
export const pinnedPiecesChecked = (parts: Parts, accountId: string, boardId: string) =>
  Effect.gen(function* () {
    const pieceIds = (yield* stored(parts.store.pinsOf([boardId]))).flatMap(({ piece }) =>
      piece !== null && piece.accountId === accountId ? [piece.id] : [],
    )
    yield* parts.checks.checkLater(pieceIds.map((id) => ({ kind: 'piece' as const, id })))
  })

/** An edit of a board, after which a public board's check is pending again and its new pieces are checked. */
export const rechecked =
  <I, A, E, R>(parts: Parts, edit: (boardId: BoardId, input: I) => Effect.Effect<A, E, R>) =>
  (boardId: BoardId, input: I) =>
    Effect.tap(edit(boardId, input), () =>
      Effect.gen(function* () {
        if (!(yield* parts.checks.changed({ kind: 'board', id: boardId }))) return
        const { accountId } = yield* CurrentAccount
        yield* pinnedPiecesChecked(parts, accountId, boardId)
      }),
    )

export const pieceTarget = (pieceId: string) => ({ kind: 'piece' as const, pieceId, lookId: null, imageId: null })
export const lookTarget = (lookId: string) => ({ kind: 'look' as const, pieceId: null, lookId, imageId: null })
