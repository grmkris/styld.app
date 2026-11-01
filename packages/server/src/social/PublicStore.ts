import {
  boardImages,
  boardPins,
  boards,
  contentChecks,
  lookPieces,
  looks,
  piecePictures,
  pieces,
  profiles,
} from '@styld/db'
import { and, desc, eq, exists, inArray, isNotNull, type SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Array, Effect } from 'effect'
import { chunked, first, query } from '../kernel/Db.ts'
import { checkLets } from './Visibility.ts'

/** The most boards and looks a profile shows. */
const boardLimit = 60
const lookLimit = 60

export type Database = ReturnType<typeof drizzle>

/** With `checked`, a condition that the board's or look's check lets others see it; otherwise none. */
const lets = (db: Database, checked: boolean, kind: 'board' | 'look', id: typeof boards.id | typeof looks.id) =>
  checked
    ? exists(
        db
          .select({ id: contentChecks.targetId })
          .from(contentChecks)
          .where(checkLets('link', kind, id)),
      )
    : undefined

/** Whether the piece is on one of its owner's public boards or in one of their shared looks; `checked` asks only
 * for those others may see past their check. Someone else's board never counts. */
export const reachedThrough = (db: Database, accountId: string, pieceId: string, checked: boolean) =>
  Effect.gen(function* () {
    const onBoard = yield* query(() =>
      db
        .select({ id: boardPins.id })
        .from(boardPins)
        .innerJoin(boards, eq(boards.id, boardPins.boardId))
        .where(
          and(
            eq(boardPins.pieceId, pieceId),
            eq(boards.accountId, accountId),
            eq(boards.visibility, 'public'),
            lets(db, checked, 'board', boards.id),
          ),
        )
        .limit(1),
    )
    if (onBoard.length > 0) return true
    const inLook = yield* query(() =>
      db
        .select({ id: looks.id })
        .from(lookPieces)
        .innerJoin(looks, eq(looks.id, lookPieces.lookId))
        .where(
          and(
            eq(lookPieces.pieceId, pieceId),
            eq(looks.accountId, accountId),
            isNotNull(looks.sharedAt),
            lets(db, checked, 'look', looks.id),
          ),
        )
        .limit(1),
    )
    return inLook.length > 0
  })

/** What public pages read in D1. Visibility is decided by `Public.ts`; this only finds rows. */
export const makePublicStore = (database: Parameters<typeof drizzle>[0]) => {
  const db: Database = drizzle(database)
  const piecesWith = (where: SQL | undefined) =>
    db
      .select({ piece: pieces, picture: piecePictures })
      .from(pieces)
      .leftJoin(piecePictures, eq(piecePictures.pieceId, pieces.id))
      .where(where)
      .orderBy(desc(pieces.createdAt))
  return {
    /** A published profile by its handle. */
    publishedProfile: (handle: string) =>
      query(() =>
        db
          .select()
          .from(profiles)
          .where(and(eq(profiles.handle, handle), eq(profiles.published, true)))
          .limit(1),
      ).pipe(Effect.map(first)),
    profileOf: (accountId: string) =>
      query(() => db.select().from(profiles).where(eq(profiles.accountId, accountId)).limit(1)).pipe(Effect.map(first)),
    board: (boardId: string) =>
      query(() => db.select().from(boards).where(eq(boards.id, boardId)).limit(1)).pipe(Effect.map(first)),
    /** The account's public boards, the most recently published first. */
    publicBoards: (accountId: string) =>
      query(() =>
        db
          .select()
          .from(boards)
          .where(and(eq(boards.accountId, accountId), eq(boards.visibility, 'public')))
          .orderBy(desc(boards.publishedAt))
          .limit(boardLimit),
      ),
    look: (lookId: string) =>
      query(() => db.select().from(looks).where(eq(looks.id, lookId)).limit(1)).pipe(Effect.map(first)),
    /** The account's shared looks, the most recently shared first. */
    sharedLooks: (accountId: string) =>
      query(() =>
        db
          .select()
          .from(looks)
          .where(and(eq(looks.accountId, accountId), isNotNull(looks.sharedAt)))
          .orderBy(desc(looks.sharedAt))
          .limit(lookLimit),
      ),
    /** These pieces with the picture each shows. */
    pieces: (pieceIds: ReadonlyArray<string>) =>
      Effect.map(
        Effect.forEach(chunked(pieceIds), (chunk) => query(() => piecesWith(inArray(pieces.id, chunk)))),
        Array.flatten,
      ),
    image: (imageId: string) =>
      query(() => db.select().from(boardImages).where(eq(boardImages.id, imageId)).limit(1)).pipe(Effect.map(first)),
    /** Whether the piece is on its owner's public boards or shared looks that others may see. */
    onShownBoardOrLook: (accountId: string, pieceId: string) => reachedThrough(db, accountId, pieceId, true),
  }
}

export type PublicStore = ReturnType<typeof makePublicStore>
