import { boardImages, boardItems, boardPins, boards, operationReceipts, pieces } from '@styld/db'
import { and, asc, count, desc, eq, inArray, lte, or, type SQL, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Option } from 'effect'
import { receiptQuery } from '../Receipts.ts'
import { chunked, ownPieceIds, receivedUploadKey, spendUpload, StoreUnavailable } from '../wardrobe/Store.ts'

export type BoardRow = typeof boards.$inferSelect
export type BoardItemRow = typeof boardItems.$inferSelect
export type BoardImageRow = typeof boardImages.$inferSelect
export type BoardPinRow = typeof boardPins.$inferSelect
type ReceiptRow = typeof operationReceipts.$inferSelect

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => StoreUnavailable.make({}) })
const first = <A>(rows: ReadonlyArray<A>) => Option.fromNullishOr(rows[0])

/** The most boards a list shows. */
const listLimit = 100

/** A save of a board's table, from the version its editor loaded, with the pins the table needs that the
 * board does not hold yet. */
export interface TableSave {
  readonly accountId: string
  readonly boardId: string
  readonly version: number
  readonly items: ReadonlyArray<Omit<BoardItemRow, 'boardId'>>
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

type Database = ReturnType<typeof drizzle>

const boardRows = (db: Database) => ({
  findReceipt: (accountId: string, operationId: string) =>
    attempt(() => receiptQuery(db, accountId, operationId)).pipe(Effect.map(first)),
  /** The board and the operation's receipt, as one atomic batch. */
  createBoard: (board: BoardRow, receipt: ReceiptRow) =>
    attempt(() => db.batch([db.insert(boards).values(board), db.insert(operationReceipts).values(receipt)])).pipe(
      Effect.asVoid,
    ),
  listBoards: (accountId: string) =>
    attempt(() =>
      db.select().from(boards).where(eq(boards.accountId, accountId)).orderBy(desc(boards.updatedAt)).limit(listLimit),
    ),
  findBoard: (accountId: string, boardId: string) =>
    attempt(() =>
      db
        .select()
        .from(boards)
        .where(and(eq(boards.id, boardId), eq(boards.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  updateBoard: (
    accountId: string,
    boardId: string,
    changes: Partial<Pick<BoardRow, 'name' | 'paper' | 'searchText' | 'visibility' | 'publishedAt' | 'updatedAt'>>,
  ) =>
    attempt(() =>
      db
        .update(boards)
        .set(changes)
        .where(and(eq(boards.id, boardId), eq(boards.accountId, accountId)))
        .returning(),
    ).pipe(Effect.map(first)),
  /** Removes the board; its items and pictures go with it. */
  deleteBoard: (accountId: string, boardId: string) =>
    attempt(() =>
      db
        .delete(boards)
        .where(and(eq(boards.id, boardId), eq(boards.accountId, accountId)))
        .returning({ id: boards.id }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
})

const itemRows = (db: Database) => ({
  /** The items of these boards, bottom of the stack first. */
  itemsOf: (boardIds: ReadonlyArray<string>) =>
    Effect.map(
      Effect.forEach(chunked(boardIds), (chunk) =>
        attempt(() =>
          db
            .select()
            .from(boardItems)
            .where(inArray(boardItems.boardId, chunk))
            .orderBy(asc(boardItems.z), asc(boardItems.id)),
        ),
      ),
      (rows) => rows.flat(),
    ),
  ownPieces: (accountId: string, pieceIds: ReadonlyArray<string>) => ownPieceIds(db, accountId, pieceIds),
  /** Replace the board's items, pin what they need, record the operation and count the save, as one atomic
   * batch, only while the board is still at the version the editor loaded. Each item's board and the
   * receipt's board are read at that version, so a save that lost the race writes a null, which fails the
   * whole batch, an empty table included. */
  saveItems: (save: TableSave) => {
    const loaded = and(
      eq(boards.id, save.boardId),
      eq(boards.accountId, save.accountId),
      eq(boards.version, save.version),
    )
    const boardAtVersion = sql<string>`${db.select({ id: boards.id }).from(boards).where(loaded)}`
    return attempt(() =>
      db.batch([
        db.delete(boardItems).where(eq(boardItems.boardId, boardAtVersion)),
        ...save.items.map((item) => db.insert(boardItems).values({ ...item, boardId: boardAtVersion })),
        ...save.pins.map((pin) => db.insert(boardPins).values(pin).onConflictDoNothing()),
        db.insert(operationReceipts).values({ ...save.receipt, result: boardAtVersion }),
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
  },
})

/** The pin's own columns, with the piece a piece pin holds. */
const pinWithPiece = (db: Database, where: SQL) =>
  db
    .select({ pin: boardPins, piece: pieces })
    .from(boardPins)
    .leftJoin(pieces, eq(pieces.id, boardPins.pieceId))
    .where(where)
    .orderBy(desc(boardPins.createdAt), desc(boardPins.id))

const pinReads = (db: Database) => ({
  /** The pins of these boards, newest first, each piece pin with its piece. */
  pinsOf: (boardIds: ReadonlyArray<string>) =>
    Effect.map(
      Effect.forEach(chunked(boardIds), (chunk) => attempt(() => pinWithPiece(db, inArray(boardPins.boardId, chunk)))),
      (rows) => rows.flat(),
    ),
  /** Each board's newest pins, at most `limit` of them: the cover of a board in a list. */
  coversOf: (boardIds: ReadonlyArray<string>, limit: number) =>
    Effect.map(
      Effect.forEach(chunked(boardIds), (chunk) => {
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
        return attempt(() => pinWithPiece(db, inArray(boardPins.id, newest)))
      }),
      (rows) => rows.flat(),
    ),
  /** How many pins each of these boards holds. */
  pinCounts: (boardIds: ReadonlyArray<string>) =>
    Effect.map(
      Effect.forEach(chunked(boardIds), (chunk) =>
        attempt(() =>
          db
            .select({ boardId: boardPins.boardId, pins: count() })
            .from(boardPins)
            .where(inArray(boardPins.boardId, chunk))
            .groupBy(boardPins.boardId),
        ),
      ),
      (rows) => new Map(rows.flat().map(({ boardId, pins }) => [boardId, pins])),
    ),
  /** Which of these pieces are pinned on the board. */
  piecesPinned: (boardId: string, pieceIds: ReadonlyArray<string>) =>
    Effect.map(
      Effect.forEach(chunked(pieceIds), (chunk) =>
        attempt(() =>
          db
            .select({ id: boardPins.pieceId })
            .from(boardPins)
            .where(and(eq(boardPins.boardId, boardId), inArray(boardPins.pieceId, chunk))),
        ),
      ),
      (rows) => new Set(rows.flat().flatMap(({ id }) => (id === null ? [] : [id]))),
    ),
})

const pinWrites = (db: Database) => ({
  /** These pins of the board, to take off. */
  pinsOn: (boardId: string, pinIds: ReadonlyArray<string>) =>
    attempt(() =>
      db
        .select()
        .from(boardPins)
        .where(and(eq(boardPins.boardId, boardId), inArray(boardPins.id, [...pinIds]))),
    ),
  /** The pins and the operation's receipt, as one atomic batch. What is pinned already stays as it was. */
  addPins: (accountId: string, boardId: string, pins: ReadonlyArray<BoardPinRow>, receipt: ReceiptRow, at: Date) =>
    attempt(() =>
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
    attempt(() =>
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
  /** Which of these pictures are on the board. */
  imagesOn: (boardId: string, imageIds: ReadonlyArray<string>) =>
    Effect.map(
      Effect.forEach(chunked(imageIds), (chunk) =>
        attempt(() =>
          db
            .select({ id: boardImages.id })
            .from(boardImages)
            .where(and(eq(boardImages.boardId, boardId), inArray(boardImages.id, chunk))),
        ),
      ),
      (rows) => new Set(rows.flat().map(({ id }) => id)),
    ),
  /** The keys of the board's pictures, to delete their bytes with it. */
  imageKeys: (boardId: string) =>
    attempt(() =>
      db.select({ key: boardImages.objectKey }).from(boardImages).where(eq(boardImages.boardId, boardId)),
    ).pipe(Effect.map((rows) => rows.map(({ key }) => key))),
  /** The keys of these pictures of the board. */
  imageKeysOf: (boardId: string, imageIds: ReadonlyArray<string>) =>
    imageIds.length === 0
      ? Effect.succeed<ReadonlyArray<string>>([])
      : attempt(() =>
          db
            .select({ key: boardImages.objectKey })
            .from(boardImages)
            .where(and(eq(boardImages.boardId, boardId), inArray(boardImages.id, [...imageIds]))),
        ).pipe(Effect.map((rows) => rows.map(({ key }) => key))),
  findImage: (accountId: string, imageId: string) =>
    attempt(() =>
      db
        .select()
        .from(boardImages)
        .where(and(eq(boardImages.id, imageId), eq(boardImages.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  /** The picture, its pin, its upload spent and the operation's receipt, as one atomic batch. The picture
   * keeps the upload's key, read in the same statement, so an upload spent meanwhile fails the batch. */
  addImage: (image: Omit<BoardImageRow, 'objectKey'>, pinId: string, uploadId: string, receipt: ReceiptRow) =>
    attempt(() =>
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
export const makeBoardStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  return { ...boardRows(db), ...itemRows(db), ...pinReads(db), ...pinWrites(db), ...imageRows(db) }
}

export type BoardStore = ReturnType<typeof makeBoardStore>
