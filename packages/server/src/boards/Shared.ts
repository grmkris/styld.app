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
import { imageAddresses, type SignedMedia } from '../kernel/SignedMedia.ts'
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
type ImageAddresses = { readonly thumb: string; readonly full: string }
type PictureAddresses = ReadonlyMap<string, ImageAddresses>

/** Resolve picture rows in bounded batches, including table pictures outside the four cover pins. */
const picturesOf = Effect.fnUntraced(function* (items: ReadonlyArray<BoardItemRow>, pins: ReadonlyArray<PinRow>) {
  const ids = [
    ...new Set(
      [...items.map(({ imageId }) => imageId), ...pins.map(({ pin }) => pin.imageId)].filter(
        (id): id is string => id !== null,
      ),
    ),
  ]
  const images = yield* stored((yield* BoardStore).imagesById(ids))
  const addresses = yield* Effect.forEach(images, (row) =>
    Effect.map(
      imageAddresses({
        entityId: row.id,
        key: row.objectKey,
        contentType: row.contentType,
        version: String(row.createdAt.getTime()),
      }),
      (image) => Option.map(image, (value) => [row.id, value] as const),
    ),
  )
  return new Map(addresses.flatMap(Option.toArray))
})

export const shownItem = (row: BoardItemRow, pictures: PictureAddresses = new Map()) => {
  const placement = { id: row.id, x: row.x, y: row.y, size: row.size, turn: row.turn, z: row.z, flipped: row.flipped }
  return Match.value(row.kind).pipe(
    Match.when('piece', () => ({ _tag: 'PieceItem', ...placement, pieceId: row.pieceId })),
    Match.when('text', () => ({ _tag: 'TextItem', ...placement, text: row.text, style: row.textStyle })),
    Match.when('image', () => ({
      _tag: 'ImageItem',
      ...placement,
      imageId: row.imageId,
      ...(row.imageId !== null && pictures.has(row.imageId) ? { image: pictures.get(row.imageId) } : {}),
    })),
    Match.exhaustive,
  )
}

/** An item as a row: its kind and the one column that kind uses. */
export const itemRow = (item: BoardItem): Omit<BoardItemRow, 'boardId' | 'outfitId'> => {
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
const shownPin = (
  row: PinRow,
  looks: ReadonlyMap<string, Look>,
  pictures: PictureAddresses,
): Effect.Effect<ReadonlyArray<object>, never, CurrentAccount | SignedMedia> =>
  Effect.gen(function* () {
    const base = { id: row.pin.id, addedAt: row.pin.createdAt.toISOString() }
    const look = row.pin.lookId === null ? undefined : looks.get(row.pin.lookId)
    if (row.pin.kind === 'piece' && row.piece !== null)
      return [{ _tag: 'PiecePin', ...base, piece: yield* toPiece(row.piece, row.picture ?? undefined) }]
    if (row.pin.kind === 'picture' && row.pin.imageId !== null) {
      const image = pictures.get(row.pin.imageId)
      return [
        {
          _tag: 'PicturePin',
          ...base,
          imageId: row.pin.imageId,
          generated: row.origin === 'generated',
          ...(image === undefined ? {} : { image }),
        },
      ]
    }
    return row.pin.kind === 'look' && look !== undefined ? [{ _tag: 'LookPin', ...base, look }] : []
  })

const shownPins = (pins: ReadonlyArray<PinRow>, pictures: PictureAddresses) =>
  Effect.gen(function* () {
    const looks = yield* pinnedLooks(pins)
    const shownRows = yield* Effect.forEach(pins, (row) =>
      Effect.map(shownPin(row, looks, pictures), (shownRow) => ({ boardId: row.pin.boardId, pins: shownRow })),
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

/** What the template boards among these show besides their table (T-10): each one's anchor and its outfits, with the
 * pieces still in the wardrobe. A blank board has none. */
const outfitsAroundOf = (rows: ReadonlyArray<BoardRow>) =>
  Effect.gen(function* () {
    const templates = rows.filter(({ template }) => template === 'outfitsAround')
    const store = yield* BoardStore
    const outfits = yield* stored(store.outfitsOf(templates.map(({ id }) => id)))
    const worn = yield* stored(store.outfitPiecesOf(outfits.map(({ id }) => id)))
    const anchorIds = templates.flatMap(({ anchorPieceId }) => (anchorPieceId === null ? [] : [anchorPieceId]))
    const anchors = yield* stored(store.piecesById(anchorIds))
    const shownAnchors = new Map(
      yield* Effect.forEach(anchors, ({ piece, picture }) =>
        Effect.map(toPiece(piece, picture ?? undefined), (shownPiece) => [piece.id, shownPiece] as const),
      ),
    )
    const shownOutfits = yield* Effect.forEach(outfits, (outfit) =>
      Effect.map(
        Effect.forEach(
          worn.filter(({ outfitId }) => outfitId === outfit.id),
          ({ piece, picture }) => toPiece(piece, picture ?? undefined),
        ),
        (outfitPieces) => ({
          boardId: outfit.boardId,
          outfit: {
            id: outfit.id,
            pieces: outfitPieces,
            lookId: outfit.lookId,
            session: outfit.session,
            mode: outfit.mode,
          },
        }),
      ),
    )
    return (row: BoardRow) =>
      row.template === 'outfitsAround'
        ? {
            outfitsAround: {
              anchor: row.anchorPieceId === null ? null : (shownAnchors.get(row.anchorPieceId) ?? null),
              outfits: shownOutfits.filter(({ boardId }) => boardId === row.id).map(({ outfit }) => outfit),
            },
          }
        : {}
  })

/** Boards as their owner sees them, each with its table, its pins and which of them others see. */
export const shown = (rows: ReadonlyArray<BoardRow>) =>
  Effect.gen(function* () {
    const ids = rows.map(({ id }) => id)
    const templateOf = yield* outfitsAroundOf(rows)
    const items = yield* stored((yield* BoardStore).itemsOf(ids))
    const pins = yield* stored((yield* BoardStore).pinsOf(ids))
    const pictures = yield* picturesOf(items, pins)
    const pinsOf = yield* shownPins(pins, pictures)
    const seen = yield* publicPinIds(rows, pins)
    const checks = yield* (yield* Checks).statuses('board', ids)
    return yield* Effect.forEach(rows, (row) =>
      // Only the service writes rows, through the same schemas; a row that does not decode is a bug.
      Schema.decodeUnknownEffect(Board)({
        id: row.id,
        name: row.name,
        paper: row.paper,
        version: row.version,
        items: items.filter(({ boardId }) => boardId === row.id).map((item) => shownItem(item, pictures)),
        pins: pinsOf(row.id),
        publicPins: pins.flatMap(({ pin }) => (pin.boardId === row.id && seen.has(pin.id) ? [pin.id] : [])),
        // Only the service writes moods, through the protocol's literals; others were never stored.
        moods: row.moods,
        visibility: row.visibility,
        check: checks.get(row.id) ?? null,
        updatedAt: row.updatedAt.toISOString(),
        ...templateOf(row),
      }).pipe(Effect.orDie),
    )
  })

/** Boards in a list: each with its table, its newest pins and how many it holds. */
export const summaries = (rows: ReadonlyArray<BoardRow>) =>
  Effect.gen(function* () {
    const ids = rows.map(({ id }) => id)
    const items = yield* stored((yield* BoardStore).itemsOf(ids))
    const covers = yield* stored((yield* BoardStore).coversOf(ids, coverPins))
    const pictures = yield* picturesOf(items, covers)
    const coverOf = yield* shownPins(covers, pictures)
    const counts = yield* stored((yield* BoardStore).pinCounts(ids))
    return yield* Effect.forEach(rows, (row) =>
      Schema.decodeUnknownEffect(BoardSummary)({
        id: row.id,
        name: row.name,
        paper: row.paper,
        items: items.filter(({ boardId }) => boardId === row.id).map((item) => shownItem(item, pictures)),
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
