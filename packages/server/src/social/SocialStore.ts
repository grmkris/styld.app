import { blocks, follows, profiles, reports, saves, wishes } from '@styld/db'
import { and, count, desc, eq, gte, inArray, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Array, Effect, Option } from 'effect'
import { StoreUnavailable } from '../wardrobe/Store.ts'

export type SaveRow = typeof saves.$inferSelect
export type ReportRow = typeof reports.$inferSelect

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => StoreUnavailable.make({}) })

/** The most saves, follows and blocks a list shows. */
const listLimit = 200

/** A save's target column, by kind. */
const savedColumn = (kind: SaveRow['kind']) =>
  kind === 'piece' ? saves.pieceId : kind === 'look' ? saves.lookId : saves.boardId

type Database = ReturnType<typeof drizzle>

const savesAndFollows = (db: Database) => ({
  /** The account's saves, newest first. */
  saves: (accountId: string) =>
    attempt(() =>
      db.select().from(saves).where(eq(saves.accountId, accountId)).orderBy(desc(saves.createdAt)).limit(listLimit),
    ),
  /** Save the target once; saving it again keeps the first save. */
  save: (row: SaveRow) => attempt(() => db.insert(saves).values(row).onConflictDoNothing()).pipe(Effect.asVoid),
  unsave: (accountId: string, kind: SaveRow['kind'], targetId: string) =>
    attempt(() =>
      db
        .delete(saves)
        .where(and(eq(saves.accountId, accountId), eq(saves.kind, kind), eq(savedColumn(kind), targetId))),
    ).pipe(Effect.asVoid),
  /** The account behind a published handle. */
  accountOf: (handle: string) =>
    attempt(() =>
      db
        .select({ accountId: profiles.accountId })
        .from(profiles)
        .where(and(eq(profiles.handle, handle), eq(profiles.published, true)))
        .limit(1),
    ).pipe(Effect.map((rows) => Option.map(Option.fromNullishOr(rows[0]), ({ accountId }) => accountId))),
  /** The account behind a handle, published or not: someone can be blocked, and unblocked, whatever they show. */
  accountOfAnyHandle: (handle: string) =>
    attempt(() =>
      db.select({ accountId: profiles.accountId }).from(profiles).where(eq(profiles.handle, handle)).limit(1),
    ).pipe(Effect.map((rows) => Option.map(Option.fromNullishOr(rows[0]), ({ accountId }) => accountId))),
  isFollowing: (followerId: string, followeeId: string) =>
    attempt(() =>
      db
        .select({ id: follows.followeeId })
        .from(follows)
        .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)))
        .limit(1),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  follow: (followerId: string, followeeId: string, at: Date) =>
    attempt(() => db.insert(follows).values({ followerId, followeeId, createdAt: at }).onConflictDoNothing()).pipe(
      Effect.asVoid,
    ),
  unfollow: (followerId: string, followeeId: string) =>
    attempt(() =>
      db.delete(follows).where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId))),
    ).pipe(Effect.asVoid),
  /** Those the account follows, the most recently followed first. */
  followees: (followerId: string) =>
    attempt(() =>
      db
        .select({ accountId: follows.followeeId })
        .from(follows)
        .where(eq(follows.followerId, followerId))
        .orderBy(desc(follows.createdAt))
        .limit(listLimit),
    ).pipe(Effect.map((rows) => rows.map(({ accountId }) => accountId))),
})

const blockRows = (db: Database) => ({
  /** Whether either account blocked the other. */
  blockedBetween: (left: string, right: string) =>
    attempt(() =>
      db
        .select({ id: blocks.blockerId })
        .from(blocks)
        .where(
          or(
            and(eq(blocks.blockerId, left), eq(blocks.blockedId, right)),
            and(eq(blocks.blockerId, right), eq(blocks.blockedId, left)),
          ),
        )
        .limit(1),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  hasBlocked: (blockerId: string, blockedId: string) =>
    attempt(() =>
      db
        .select({ id: blocks.blockedId })
        .from(blocks)
        .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
        .limit(1),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** A block, and every follow between the two, as one atomic batch. */
  block: (blockerId: string, blockedId: string, at: Date) =>
    attempt(() =>
      db.batch([
        db.insert(blocks).values({ blockerId, blockedId, createdAt: at }).onConflictDoNothing(),
        db
          .delete(follows)
          .where(
            or(
              and(eq(follows.followerId, blockerId), eq(follows.followeeId, blockedId)),
              and(eq(follows.followerId, blockedId), eq(follows.followeeId, blockerId)),
            ),
          ),
      ]),
    ).pipe(Effect.asVoid),
  unblock: (blockerId: string, blockedId: string) =>
    attempt(() => db.delete(blocks).where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))).pipe(
      Effect.asVoid,
    ),
  /** Those the account blocked, the most recent first. */
  blockedBy: (blockerId: string) =>
    attempt(() =>
      db
        .select({ accountId: blocks.blockedId })
        .from(blocks)
        .where(eq(blocks.blockerId, blockerId))
        .orderBy(desc(blocks.createdAt))
        .limit(listLimit),
    ).pipe(Effect.map((rows) => rows.map(({ accountId }) => accountId))),
  /** Of these accounts, those either side of a block with the account. Each group binds its ids twice, so groups
   * stay under D1's 100 parameters. */
  blockedAmong: (accountId: string, others: ReadonlyArray<string>) =>
    Effect.forEach(Array.chunksOf(others, 45), (group) =>
      attempt(() =>
        db
          .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
          .from(blocks)
          .where(
            or(
              and(eq(blocks.blockerId, accountId), inArray(blocks.blockedId, [...group])),
              and(eq(blocks.blockedId, accountId), inArray(blocks.blockerId, [...group])),
            ),
          ),
      ),
    ).pipe(
      Effect.map(
        (groups) =>
          new Set(groups.flat().map(({ blockerId, blockedId }) => (blockerId === accountId ? blockedId : blockerId))),
      ),
    ),
})

const reportRows = (db: Database) => ({
  /** How many reports the account filed since `since`. */
  reportsSince: (reporterId: string, since: Date) =>
    attempt(() =>
      db
        .select({ total: count() })
        .from(reports)
        .where(and(eq(reports.reporterId, reporterId), gte(reports.createdAt, since))),
    ).pipe(Effect.map((rows) => rows[0]?.total ?? 0)),
  /** File the report once per reporter and target; answers whether this one was new, and how many people reported
   * the target. */
  report: (row: ReportRow) =>
    Effect.gen(function* () {
      const filed = yield* attempt(() =>
        db.insert(reports).values(row).onConflictDoNothing().returning({ id: reports.id }),
      )
      const reporters = yield* attempt(() =>
        db
          .select({ total: count() })
          .from(reports)
          .where(and(eq(reports.targetKind, row.targetKind), eq(reports.targetId, row.targetId))),
      )
      return { filed: filed.length > 0, reporters: reporters[0]?.total ?? 0 }
    }),
})

export type WishRow = typeof wishes.$inferSelect

const wishRows = (db: Database) => ({
  /** The account's wishes, newest first. */
  wishes: (accountId: string) =>
    attempt(() =>
      db.select().from(wishes).where(eq(wishes.accountId, accountId)).orderBy(desc(wishes.createdAt)).limit(listLimit),
    ),
  /** Wish for the piece once; wishing again keeps the first wish, which answers. */
  wish: (row: WishRow) =>
    Effect.gen(function* () {
      yield* attempt(() => db.insert(wishes).values(row).onConflictDoNothing())
      const kept = yield* attempt(() =>
        db
          .select()
          .from(wishes)
          .where(and(eq(wishes.accountId, row.accountId), eq(wishes.sourcePieceId, row.sourcePieceId ?? '')))
          .limit(1),
      )
      return kept[0] ?? row
    }),
  unwish: (accountId: string, wishId: string) =>
    attempt(() => db.delete(wishes).where(and(eq(wishes.accountId, accountId), eq(wishes.id, wishId)))).pipe(
      Effect.asVoid,
    ),
})

/** Saves, follows, blocks and reports in D1. Every read and write names the account it is for. */
export const makeSocialStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  return { ...savesAndFollows(db), ...blockRows(db), ...reportRows(db), ...wishRows(db) }
}

export type SocialStore = ReturnType<typeof makeSocialStore>
