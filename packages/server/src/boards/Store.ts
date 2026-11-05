import {
  boardImages,
  boardItems,
  boardOutfitPieces,
  boardOutfits,
  boardPins,
  boards,
  operationReceipts,
  piecePictures,
  pieces,
} from '@styld/db'
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lte, or, type SQL, sql } from 'drizzle-orm'
import { Context, Effect, Layer, Option } from 'effect'
import { receiptRows, recordedWrites } from '../kernel/Receipts.ts'
import { forgetCheck } from '../safety/Checks.ts'
import { receivedUploadKey, spendUpload } from '../wardrobe/Store.ts'
import { Database as Db, fenced, first, inChunks, query } from '../kernel/Db.ts'

export type BoardRow = typeof boards.$inferSelect
export type BoardItemRow = typeof boardItems.$inferSelect
export type BoardImageRow = typeof boardImages.$inferSelect
export type BoardPinRow = typeof boardPins.$inferSelect
export type BoardOutfitRow = typeof boardOutfits.$inferSelect
type ReceiptRow = typeof operationReceipts.$inferSelect

/** The most boards a list shows. */
const listLimit = 100

/** A save of a board's table, from the version its editor loaded, with the pins the table needs that the
 * board does not hold yet. An item keeps the outfit it showed (`saveItems`). */
export interface TableSave {
  readonly accountId: string
  readonly boardId: string
  readonly version: number
  readonly items: ReadonlyArray<Omit<BoardItemRow, 'boardId' | 'outfitId'>>
  readonly pins: ReadonlyArray<BoardPinRow>
  readonly receipt: ReceiptRow
  readonly at: Date
}

/** Pins taken off a board, with the pieces and pictures they held, which leave its table too. */
export interface PinRemoval {
  readonly accountId: string
  readonly boardId: string
  readonly pinIds: ReadonlyArray<string>
  readonly pieceIds: ReadonlyArray<string>
  readonly imageIds: ReadonlyArray<string>
  readonly receipt: ReceiptRow
  readonly at: Date
}

/** A board started from "One piece, six outfits" (T-10): the board, its outfits with their pieces, its table and pins,
 * and the operation's receipt. */
export interface OutfitBoard {
  readonly board: BoardRow
  readonly outfits: ReadonlyArray<{ readonly row: BoardOutfitRow; readonly pieceIds: ReadonlyArray<string> }>
  readonly items: ReadonlyArray<Omit<BoardItemRow, 'boardId'>>
  readonly pins: ReadonlyArray<BoardPinRow>
  readonly receipt: ReceiptRow
}

/** Another outfit in place of one (T-10): its run, way and pieces, its cluster's items, the pins they need, the
 * receipt; from the board's version, which it moves on so an open editor reloads. */
export interface OutfitReplacement {
  readonly accountId: string
  readonly boardId: string
  readonly version: number
  readonly outfit: Pick<BoardOutfitRow, 'id' | 'session' | 'mode'>
  readonly pieceIds: ReadonlyArray<string>
  readonly items: ReadonlyArray<Omit<BoardItemRow, 'boardId'>>
  readonly pins: ReadonlyArray<BoardPinRow>
  readonly receipt: ReceiptRow
  readonly at: Date
}

/** A template board laid out again (Eva's layouts, 4 November 2026): the outfits that stay in their new places, those
 * that leave, new ones with their pieces, the anchor's and the clusters' items in the new layout, the pins they need
 * and the receipt; from the board's version, which it moves on. */
export interface Relayout {
  readonly accountId: string
  readonly boardId: string
  readonly version: number
  readonly layout: NonNullable<BoardRow['layout']>
  readonly anchorPieceId: string
  /** Every outfit that stays, in its new place, the lowest first. */
  readonly staying: ReadonlyArray<{ readonly id: string; readonly position: number }>
  readonly leaving: ReadonlyArray<string>
  readonly added: ReadonlyArray<{ readonly row: BoardOutfitRow; readonly pieceIds: ReadonlyArray<string> }>
  readonly items: ReadonlyArray<Omit<BoardItemRow, 'boardId'>>
  readonly pins: ReadonlyArray<BoardPinRow>
  readonly receipt: ReceiptRow
  readonly at: Date
}

type Database = Db['Service']

const outfitPieceRows = (db: Database, outfitId: string | SQL<string>, pieceIds: ReadonlyArray<string>) =>
  pieceIds.map((pieceId, position) => db.insert(boardOutfitPieces).values({ outfitId, pieceId, position }))

const outfitRows = (db: Database) => ({
  /** The outfits of these boards, in their places. */
  outfitsOf: (boardIds: ReadonlyArray<string>) =>
    inChunks(boardIds, (chunk) =>
      db.select().from(boardOutfits).where(inArray(boardOutfits.boardId, chunk)).orderBy(asc(boardOutfits.position)),
    ),
  /** The pieces of these outfits still in the wardrobe, in wearing order, each with its picture. */
  outfitPiecesOf: (outfitIds: ReadonlyArray<string>) =>
    inChunks(outfitIds, (chunk) =>
      db
        .select({ outfitId: boardOutfitPieces.outfitId, piece: pieces, picture: piecePictures })
        .from(boardOutfitPieces)
        .innerJoin(pieces, eq(pieces.id, boardOutfitPieces.pieceId))
        .leftJoin(piecePictures, eq(piecePictures.pieceId, pieces.id))
        .where(inArray(boardOutfitPieces.outfitId, chunk))
        .orderBy(asc(boardOutfitPieces.position)),
    ),
  /** These pieces with their pictures, whoever's: the anchors of boards being shown. */
  piecesById: (pieceIds: ReadonlyArray<string>) =>
    inChunks(pieceIds, (chunk) =>
      db
        .select({ piece: pieces, picture: piecePictures })
        .from(pieces)
        .leftJoin(piecePictures, eq(piecePictures.pieceId, pieces.id))
        .where(inArray(pieces.id, chunk)),
    ),
  findOutfit: (boardId: string, outfitId: string) =>
    query(() =>
      db
        .select()
        .from(boardOutfits)
        .where(and(eq(boardOutfits.id, outfitId), eq(boardOutfits.boardId, boardId)))
        .limit(1),
    ).pipe(Effect.map(first)),
})

const outfitWrites = (db: Database) => ({
  /** The statement that marks an outfit kept as a look, for the keep's batch. */
  outfitKept: (boardId: string, outfitId: string, lookId: string) =>
    db
      .update(boardOutfits)
      .set({ lookId })
      .where(and(eq(boardOutfits.id, outfitId), eq(boardOutfits.boardId, boardId))),
  /** The board, its outfits, table, pins and receipt, as one atomic batch. */
  createOutfitBoard: (made: OutfitBoard) =>
    fenced(() =>
      db.batch([
        db.insert(boards).values(made.board),
        ...made.outfits.flatMap(({ row, pieceIds }) => [
          db.insert(boardOutfits).values(row),
          ...outfitPieceRows(db, row.id, pieceIds),
        ]),
        ...made.items.map((item) => db.insert(boardItems).values({ ...item, boardId: made.board.id })),
        ...made.pins.map((pin) => db.insert(boardPins).values(pin)),
        db.insert(operationReceipts).values(made.receipt),
      ]),
    ).pipe(Effect.asVoid),
  /** Another outfit in its place: its pieces and run, its cluster's items, the pins they need and the receipt, as one
   * atomic batch, only while the board and the outfit are as they were read: still at the version, still not kept. The
   * outfit's pieces and the items name them by reading them so, and a replacement that lost the race writes a null
   * into a column that refuses one, which fails the whole batch. */
  replaceOutfit: (change: OutfitReplacement) => {
    const loaded = and(
      eq(boards.id, change.boardId),
      eq(boards.accountId, change.accountId),
      eq(boards.version, change.version),
    )
    const boardAtVersion = sql<string>`${db.select({ id: boards.id }).from(boards).where(loaded)}`
    const notKept = and(eq(boardOutfits.id, change.outfit.id), isNull(boardOutfits.lookId))
    const outfitNotKept = sql<string>`${db
      .select({ id: boardOutfits.id })
      .from(boardOutfits)
      .where(and(notKept, eq(boardOutfits.boardId, boardAtVersion)))}`
    return fenced(() =>
      db.batch([
        db.insert(operationReceipts).values(change.receipt),
        db.delete(boardOutfitPieces).where(eq(boardOutfitPieces.outfitId, change.outfit.id)),
        ...outfitPieceRows(db, outfitNotKept, change.pieceIds),
        db
          .update(boardOutfits)
          .set({ session: change.outfit.session, mode: change.outfit.mode })
          .where(eq(boardOutfits.id, change.outfit.id)),
        db
          .delete(boardItems)
          .where(and(eq(boardItems.boardId, change.boardId), eq(boardItems.outfitId, change.outfit.id))),
        ...change.items.map((item) => db.insert(boardItems).values({ ...item, boardId: boardAtVersion })),
        ...change.pins.map((pin) => db.insert(boardPins).values(pin).onConflictDoNothing()),
        db
          .update(boards)
          .set({ version: change.version + 1, updatedAt: change.at })
          .where(loaded),
      ]),
    ).pipe(Effect.asVoid)
  },
})

const relayoutWrites = (db: Database) => ({
  /** The board in another layout, as one atomic batch, only while it is still at the version read: the outfits that
   * leave go (their pieces with them), those that stay move to their new places in order (each to a place at or before
   * its own, so no two meet), new ones join, and the anchor's and every cluster's items are laid out again; what the
   * person added stays where it is. A relayout that lost the race writes a null board id, which fails the batch. */
  relayOut: (change: Relayout) => {
    const loaded = and(
      eq(boards.id, change.boardId),
      eq(boards.accountId, change.accountId),
      eq(boards.version, change.version),
    )
    const boardAtVersion = sql<string>`${db.select({ id: boards.id }).from(boards).where(loaded)}`
    return fenced(() =>
      db.batch([
        db.insert(operationReceipts).values(change.receipt),
        db
          .delete(boardItems)
          .where(
            and(
              eq(boardItems.boardId, change.boardId),
              or(
                isNotNull(boardItems.outfitId),
                and(isNull(boardItems.outfitId), eq(boardItems.pieceId, change.anchorPieceId)),
              ),
            ),
          ),
        ...change.leaving.map((id) =>
          db.delete(boardOutfits).where(and(eq(boardOutfits.id, id), eq(boardOutfits.boardId, change.boardId))),
        ),
        ...change.staying.map(({ id, position }) =>
          db
            .update(boardOutfits)
            .set({ position })
            .where(and(eq(boardOutfits.id, id), eq(boardOutfits.boardId, change.boardId))),
        ),
        ...change.added.flatMap(({ row, pieceIds }) => [
          db.insert(boardOutfits).values({ ...row, boardId: boardAtVersion }),
          ...outfitPieceRows(db, row.id, pieceIds),
        ]),
        ...change.items.map((item) => db.insert(boardItems).values({ ...item, boardId: boardAtVersion })),
        ...change.pins.map((pin) => db.insert(boardPins).values(pin).onConflictDoNothing()),
        db
          .update(boards)
          .set({ layout: change.layout, version: change.version + 1, updatedAt: change.at })
          .where(loaded),
      ]),
    ).pipe(Effect.asVoid)
  },
})

const boardRows = (db: Database) => ({
  ...receiptRows(db),
  ...recordedWrites(db),
  /** The board and the operation's receipt, as one atomic batch. */
  createBoard: (board: BoardRow, receipt: ReceiptRow) =>
    fenced(() => db.batch([db.insert(boards).values(board), db.insert(operationReceipts).values(receipt)])).pipe(
      Effect.asVoid,
    ),
  listBoards: (accountId: string) =>
    query(() =>
      db.select().from(boards).where(eq(boards.accountId, accountId)).orderBy(desc(boards.updatedAt)).limit(listLimit),
    ),
  findBoard: (accountId: string, boardId: string) =>
    query(() =>
      db
        .select()
        .from(boards)
        .where(and(eq(boards.id, boardId), eq(boards.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  /** The statement that changes the account's board, for its operation's batch (`recorded`). */
  updateBoard: (
    accountId: string,
    boardId: string,
    changes: Partial<
      Pick<BoardRow, 'name' | 'paper' | 'searchText' | 'moods' | 'visibility' | 'publishedAt' | 'updatedAt'>
    >,
  ) =>
    db
      .update(boards)
      .set(changes)
      .where(and(eq(boards.id, boardId), eq(boards.accountId, accountId))),
  /** Removes the board and its check, with the delete's receipt; its items, pins and pictures' rows go with it. */
  deleteBoard: (accountId: string, boardId: string, receipt: ReceiptRow) =>
    fenced(() =>
      db.batch([
        db
          .delete(boards)
          .where(and(eq(boards.id, boardId), eq(boards.accountId, accountId)))
          .returning({ id: boards.id }),
        forgetCheck(db, accountId, { kind: 'board', id: boardId }),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.map(([deleted]) => deleted.length > 0)),
})

/** The batch of a table save (`saveItems`), each item with its outfit. */
const writeItems = (db: Database, save: TableSave, outfitOf: ReadonlyMap<string, string | null>) => {
  const loaded = and(
    eq(boards.id, save.boardId),
    eq(boards.accountId, save.accountId),
    eq(boards.version, save.version),
  )
  const boardAtVersion = sql<string>`${db.select({ id: boards.id }).from(boards).where(loaded)}`
  return fenced(() =>
    db.batch([
      db.delete(boardItems).where(eq(boardItems.boardId, boardAtVersion)),
      ...save.items.map((item) =>
        db.insert(boardItems).values({ ...item, outfitId: outfitOf.get(item.id) ?? null, boardId: boardAtVersion }),
      ),
      ...save.pins.map((pin) => db.insert(boardPins).values(pin).onConflictDoNothing()),
      // The receipt is written only while the board is at the loaded version: receipts may be pending (a null
      // result), so a null no longer fails the batch, and an empty table that lost would leave a pending receipt.
      db.insert(operationReceipts).select(
        db
          .select({
            accountId: boards.accountId,
            operationId: sql`${save.receipt.operationId}`.as('operation_id'),
            command: sql`${save.receipt.command}`.as('command'),
            inputDigest: sql`${save.receipt.inputDigest}`.as('input_digest'),
            result: boards.id,
            createdAt: sql`${save.receipt.createdAt.getTime()}`.as('created_at'),
          })
          .from(boards)
          .where(loaded),
      ),
      db
        .update(boards)
        .set({ version: save.version + 1, updatedAt: save.at })
        .where(loaded)
        .returning({ version: boards.version }),
    ]),
  ).pipe(
    Effect.map((results) => {
      const counted = results.at(-1)
      return Option.fromNullishOr(Array.isArray(counted) ? counted[0] : undefined)
    }),
  )
}

const itemRows = (db: Database) => ({
  /** The items of these boards, bottom of the stack first. */
  itemsOf: (boardIds: ReadonlyArray<string>) =>
    inChunks(boardIds, (chunk) =>
      db
        .select()
        .from(boardItems)
        .where(inArray(boardItems.boardId, chunk))
        .orderBy(asc(boardItems.z), asc(boardItems.id)),
    ),
  /** Replace the board's items, pin what they need, record the operation and count the save, as one atomic
   * batch, only while the board is still at the version the editor loaded. Each item's board and the
   * receipt's board are read at that version, so a save that lost the race writes a null, which fails the
   * whole batch, an empty table included. An item keeps the template outfit it showed (T-10), by its id: one moved by
   * hand still belongs to its cluster. They are read first; a save in between moves the version, and the batch fails. */
  saveItems: (save: TableSave) =>
    Effect.flatMap(
      query(() =>
        db
          .select({ id: boardItems.id, outfitId: boardItems.outfitId })
          .from(boardItems)
          .where(eq(boardItems.boardId, save.boardId)),
      ),
      (held) => writeItems(db, save, new Map(held.map(({ id, outfitId }) => [id, outfitId]))),
    ),
})

/** The pin's own columns, with the piece a piece pin holds and where a picture pin's picture came from. */
const pinWithPiece = (db: Database, where: SQL) =>
  db
    .select({ pin: boardPins, piece: pieces, picture: piecePictures, origin: boardImages.origin })
    .from(boardPins)
    .leftJoin(pieces, eq(pieces.id, boardPins.pieceId))
    .leftJoin(piecePictures, eq(piecePictures.pieceId, boardPins.pieceId))
    .leftJoin(boardImages, eq(boardImages.id, boardPins.imageId))
    .where(where)
    .orderBy(desc(boardPins.createdAt), desc(boardPins.id))

const pinReads = (db: Database) => ({
  /** The pins of these boards, newest first, each piece pin with its piece. */
  pinsOf: (boardIds: ReadonlyArray<string>) =>
    inChunks(boardIds, (chunk) => pinWithPiece(db, inArray(boardPins.boardId, chunk))),
  /** Each board's newest pins, at most `limit` of them: the cover of a board in a list. */
  coversOf: (boardIds: ReadonlyArray<string>, limit: number) =>
    inChunks(boardIds, (chunk) => {
      const ranked = db
        .select({
          id: boardPins.id,
          rank: sql<number>`row_number() over (partition by ${boardPins.boardId} order by ${boardPins.createdAt} desc, ${boardPins.id} desc)`.as(
            'rank',
          ),
        })
        .from(boardPins)
        .where(inArray(boardPins.boardId, chunk))
        .as('ranked')
      const newest = db.select({ id: ranked.id }).from(ranked).where(lte(ranked.rank, limit))
      return pinWithPiece(db, inArray(boardPins.id, newest))
    }),
  /** How many pins each of these boards holds. */
  pinCounts: (boardIds: ReadonlyArray<string>) =>
    Effect.map(
      inChunks(boardIds, (chunk) =>
        db
          .select({ boardId: boardPins.boardId, pins: count() })
          .from(boardPins)
          .where(inArray(boardPins.boardId, chunk))
          .groupBy(boardPins.boardId),
      ),
      (rows) => new Map(rows.map(({ boardId, pins }) => [boardId, pins])),
    ),
  /** Which of these pieces are pinned on the board. */
  piecesPinned: (boardId: string, pieceIds: ReadonlyArray<string>) =>
    Effect.map(
      inChunks(pieceIds, (chunk) =>
        db
          .select({ id: boardPins.pieceId })
          .from(boardPins)
          .where(and(eq(boardPins.boardId, boardId), inArray(boardPins.pieceId, chunk))),
      ),
      (rows) => new Set(rows.flatMap(({ id }) => (id === null ? [] : [id]))),
    ),
})

const pinWrites = (db: Database) => ({
  /** The statement that pins something new on a board, for its operation's batch (`recorded`). */
  pinRow: (pin: BoardPinRow) => db.insert(boardPins).values(pin),
  /** These pins of the board, to take off. */
  pinsOn: (boardId: string, pinIds: ReadonlyArray<string>) =>
    query(() =>
      db
        .select()
        .from(boardPins)
        .where(and(eq(boardPins.boardId, boardId), inArray(boardPins.id, [...pinIds]))),
    ),
  /** The pins and the operation's receipt, as one atomic batch. What is pinned already stays as it was. */
  addPins: (accountId: string, boardId: string, pins: ReadonlyArray<BoardPinRow>, receipt: ReceiptRow, at: Date) =>
    fenced(() =>
      db.batch([
        db
          .update(boards)
          .set({ updatedAt: at })
          .where(and(eq(boards.id, boardId), eq(boards.accountId, accountId))),
        ...pins.map((pin) => db.insert(boardPins).values(pin).onConflictDoNothing()),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.asVoid),
  /** Take the pins off and their pieces and pictures off the table, delete the pictures' rows and count the
   * change as a save, so an editor holding the old table reloads, as one atomic batch. */
  removePins: (removal: PinRemoval) =>
    fenced(() =>
      db.batch([
        db
          .delete(boardItems)
          .where(
            and(
              eq(boardItems.boardId, removal.boardId),
              or(
                inArray(boardItems.pieceId, [...removal.pieceIds]),
                inArray(boardItems.imageId, [...removal.imageIds]),
              ),
            ),
          ),
        db
          .delete(boardImages)
          .where(and(eq(boardImages.boardId, removal.boardId), inArray(boardImages.id, [...removal.imageIds]))),
        db
          .delete(boardPins)
          .where(and(eq(boardPins.boardId, removal.boardId), inArray(boardPins.id, [...removal.pinIds]))),
        db
          .update(boards)
          .set({ version: sql`${boards.version} + 1`, updatedAt: removal.at })
          .where(and(eq(boards.id, removal.boardId), eq(boards.accountId, removal.accountId))),
        db.insert(operationReceipts).values(removal.receipt),
      ]),
    ).pipe(Effect.asVoid),
})

const imageRows = (db: Database) => ({
  imagesById: (imageIds: ReadonlyArray<string>) =>
    inChunks(imageIds, (chunk) => db.select().from(boardImages).where(inArray(boardImages.id, chunk))),
  /** Which of these pictures are on the board. */
  imagesOn: (boardId: string, imageIds: ReadonlyArray<string>) =>
    Effect.map(
      inChunks(imageIds, (chunk) =>
        db
          .select({ id: boardImages.id })
          .from(boardImages)
          .where(and(eq(boardImages.boardId, boardId), inArray(boardImages.id, chunk))),
      ),
      (rows) => new Set(rows.map(({ id }) => id)),
    ),
  /** The keys of the board's pictures, to delete their bytes with it. */
  imageKeys: (boardId: string) =>
    query(() =>
      db.select({ key: boardImages.objectKey }).from(boardImages).where(eq(boardImages.boardId, boardId)),
    ).pipe(Effect.map((rows) => rows.map(({ key }) => key))),
  /** The keys of these pictures of the board. */
  imageKeysOf: (boardId: string, imageIds: ReadonlyArray<string>) =>
    imageIds.length === 0
      ? Effect.succeed<ReadonlyArray<string>>([])
      : query(() =>
          db
            .select({ key: boardImages.objectKey })
            .from(boardImages)
            .where(and(eq(boardImages.boardId, boardId), inArray(boardImages.id, [...imageIds]))),
        ).pipe(Effect.map((rows) => rows.map(({ key }) => key))),
  findImage: (accountId: string, imageId: string) =>
    query(() =>
      db
        .select()
        .from(boardImages)
        .where(and(eq(boardImages.id, imageId), eq(boardImages.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  /** The picture, its pin, its upload spent and the operation's receipt, as one atomic batch. The picture
   * keeps the upload's key, read in the same statement, so an upload spent meanwhile fails the batch. */
  addImage: (
    image: Omit<BoardImageRow, 'objectKey' | 'jobId' | 'model'>,
    pinId: string,
    uploadId: string,
    receipt: ReceiptRow,
  ) =>
    fenced(() =>
      db.batch([
        db.insert(boardImages).values({ ...image, objectKey: receivedUploadKey(db, image.accountId, uploadId) }),
        db.insert(boardPins).values({
          id: pinId,
          boardId: image.boardId,
          kind: 'picture',
          pieceId: null,
          imageId: image.id,
          lookId: null,
          createdAt: image.createdAt,
        }),
        spendUpload(db, uploadId),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.asVoid),
})

/** Boards, their pins, items and pictures in D1. Every read and write of a board names its account; the pins
 * and items of a board are read by the board's id once the board is known. */
export const boardStore = (db: Database) => ({
  ...boardRows(db),
  ...outfitRows(db),
  ...outfitWrites(db),
  ...relayoutWrites(db),
  ...itemRows(db),
  ...pinReads(db),
  ...pinWrites(db),
  ...imageRows(db),
})

/** The boards' store over the application's one database. */
export class BoardStore extends Context.Service<BoardStore, ReturnType<typeof boardStore>>()(
  '@styld/server/boards/BoardStore',
) {
  static readonly layer = Layer.effect(this, Effect.map(Db, boardStore))
}

/** A pin with the piece it holds and where its picture came from, as the board's reads find it. */
export type PinRow = Effect.Success<ReturnType<BoardStore['Service']['pinsOf']>>[number]
