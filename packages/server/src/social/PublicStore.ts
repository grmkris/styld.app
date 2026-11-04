import { boardImages, boardPins, boards, contentChecks, lookPieces, looks, pieces, profiles } from '@styld/db'
import { and, desc, eq, exists, inArray, isNotNull } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { Database, first, inChunks, query } from '../kernel/Db.ts'
import { generatedAmong } from '../wardrobe/Store.ts'
import { shownToOthers } from './ProfileStore.ts'
import { checkLets, piecesWithPictures } from './Visibility.ts'

/** The most boards and looks a profile shows. */
const boardLimit = 60
const lookLimit = 60

type Drizzle = Database['Service']

/** With `checked`, a condition that the board's or look's check lets others see it; otherwise none. */
const lets = (db: Drizzle, checked: boolean, kind: 'board' | 'look', id: typeof boards.id | typeof looks.id) =>
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
export const reachedThrough = (db: Drizzle, accountId: string, pieceId: string, checked: boolean) =>
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
const publicStore = (db: Drizzle) => ({
  /** Which of these pieces are house garments Styld generated: shown marked Generated. */
  generatedAmong: (pieceIds: ReadonlyArray<string>) => generatedAmong(db, pieceIds),
  /** A published profile by its handle. */
  publishedProfile: (handle: string) =>
    query(() =>
      db
        .select()
        .from(profiles)
        .where(and(eq(profiles.handle, handle), shownToOthers(db)))
        .limit(1),
    ).pipe(Effect.map(first)),
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
    inChunks(pieceIds, (chunk) => piecesWithPictures(db, inArray(pieces.id, chunk))),
  image: (imageId: string) =>
    query(() => db.select().from(boardImages).where(eq(boardImages.id, imageId)).limit(1)).pipe(Effect.map(first)),
  /** Whether the piece is on its owner's public boards or shared looks that others may see. */
  onShownBoardOrLook: (accountId: string, pieceId: string) => reachedThrough(db, accountId, pieceId, true),
})

/** The public pages' store over the application's one database. */
export class PublicStore extends Context.Service<PublicStore, ReturnType<typeof publicStore>>()(
  '@styld/server/social/PublicStore',
) {
  static readonly layer = Layer.effect(this, Effect.map(Database, publicStore))
}
