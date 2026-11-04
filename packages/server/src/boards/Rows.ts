import { boards, boardTags, boardTranslations } from '@styld/db'
import type { BoardTag, ReviewState, TranslatedLocale } from '@styld/protocol'
import { and, eq } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'

type Db = ReturnType<typeof drizzle>

/** A board's text in another language, as the boards' table keeps it. */
export interface BoardTranslationRow {
  readonly boardId: string
  readonly locale: TranslatedLocale
  readonly name: string
  readonly labels: Readonly<Record<string, string>>
  readonly sourceDigest: string
  readonly review: ReviewState
  readonly updatedAt: Date
}

/** The boards' statements for other modules' batches: a board featured in Explore since `featuredAt` (or no longer,
 * `null`), for curation; and a house board's tags, its translation and the words search finds it by, for the seed
 * (owner, 4 November 2026). */
export const BoardRows = {
  feature: (db: Db, boardId: string, featuredAt: Date | null) =>
    db.update(boards).set({ featuredAt }).where(eq(boards.id, boardId)).returning({ id: boards.id }),
  /** The board's tags of these kinds dropped, so `tagged` replaces them. */
  untagged: (db: Db, boardId: string) => db.delete(boardTags).where(eq(boardTags.boardId, boardId)),
  tagged: (db: Db, boardId: string, tags: ReadonlyArray<BoardTag>) =>
    db
      .insert(boardTags)
      .values(tags.map((tag) => ({ boardId, kind: tag.kind, value: tag.value })))
      .onConflictDoNothing(),
  translated: (db: Db, row: BoardTranslationRow) =>
    db
      .insert(boardTranslations)
      .values(row)
      .onConflictDoUpdate({
        target: [boardTranslations.boardId, boardTranslations.locale],
        set: {
          name: row.name,
          labels: row.labels,
          sourceDigest: row.sourceDigest,
          review: row.review,
          updatedAt: row.updatedAt,
        },
      }),
  /** The words search finds the board by: its name's, and its translation's while it has one. */
  searchedAs: (db: Db, boardId: string, accountId: string, words: string) =>
    db
      .update(boards)
      .set({ searchText: words })
      .where(and(eq(boards.id, boardId), eq(boards.accountId, accountId))),
}
