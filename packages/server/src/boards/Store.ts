import { boardImages, boardItems, boards, operationReceipts } from '@styld/db'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Option } from 'effect'
import { receiptQuery } from '../Receipts.ts'
import { chunked, ownPieceIds, receivedUploadKey, spendUpload, StoreUnavailable } from '../wardrobe/Store.ts'

export type BoardRow = typeof boards.$inferSelect
export type BoardItemRow = typeof boardItems.$inferSelect
export type BoardImageRow = typeof boardImages.$inferSelect
type ReceiptRow = typeof operationReceipts.$inferSelect

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => StoreUnavailable.make({}) })
const first = <A>(rows: ReadonlyArray<A>) => Option.fromNullishOr(rows[0])

/** The most boards a list shows. */
const listLimit = 100

/** A save of a board's table, from the version its editor loaded. */
export interface TableSave {
  readonly accountId: string
  readonly boardId: string
  readonly version: number
  readonly items: ReadonlyArray<Omit<BoardItemRow, 'boardId'>>
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
  updateBoard: (accountId: string, boardId: string, changes: Partial<Pick<BoardRow, 'name' | 'paper' | 'updatedAt'>>) =>
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
  /** Replace the board's items and count the save, as one atomic batch, only while the board is still at
   * the version the editor loaded. Each item's board is read at that version, so a save that lost the race
   * writes a null board, which fails the whole batch; an empty table changes nothing then, and the version
   * that comes back is none. */
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
  findImage: (accountId: string, imageId: string) =>
    attempt(() =>
      db
        .select()
        .from(boardImages)
        .where(and(eq(boardImages.id, imageId), eq(boardImages.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  /** The picture, its upload spent and the operation's receipt, as one atomic batch. The picture keeps the
   * upload's key, read in the same statement, so an upload spent meanwhile fails the batch. */
  addImage: (image: Omit<BoardImageRow, 'objectKey'>, uploadId: string, receipt: ReceiptRow) =>
    attempt(() =>
      db.batch([
        db.insert(boardImages).values({ ...image, objectKey: receivedUploadKey(db, image.accountId, uploadId) }),
        spendUpload(db, uploadId),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.asVoid),
})

/** Boards, their items and pictures in D1. Every read and write of a board names its account. */
export const makeBoardStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  return { ...boardRows(db), ...itemRows(db), ...imageRows(db) }
}

export type BoardStore = ReturnType<typeof makeBoardStore>
