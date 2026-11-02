import { receiptRows } from '../kernel/Receipts.ts'
import { blocks, follows, reports, saves } from '@styld/db'
import { and, count, desc, eq, gte, inArray, or } from 'drizzle-orm'
import { Array, Context, Effect, Layer } from 'effect'
import { Database, query } from '../kernel/Db.ts'

export type SaveRow = typeof saves.$inferSelect
export type ReportRow = typeof reports.$inferSelect

/** The most saves, follows and blocks a list shows. */
const listLimit = 200

/** A save's target column, by kind. */
const savedColumn = (kind: SaveRow['kind']) =>
  kind === 'piece' ? saves.pieceId : kind === 'look' ? saves.lookId : saves.boardId

type Drizzle = Database['Service']

const savesAndFollows = (db: Drizzle) => ({
  /** The account's saves, newest first. */
  saves: (accountId: string) =>
    query(() =>
      db.select().from(saves).where(eq(saves.accountId, accountId)).orderBy(desc(saves.createdAt)).limit(listLimit),
    ),
  /** Save the target once; saving it again keeps the first save. */
  save: (row: SaveRow) => query(() => db.insert(saves).values(row).onConflictDoNothing()).pipe(Effect.asVoid),
  unsave: (accountId: string, kind: SaveRow['kind'], targetId: string) =>
    query(() =>
      db
        .delete(saves)
        .where(and(eq(saves.accountId, accountId), eq(saves.kind, kind), eq(savedColumn(kind), targetId))),
    ).pipe(Effect.asVoid),
  isFollowing: (followerId: string, followeeId: string) =>
    query(() =>
      db
        .select({ id: follows.followeeId })
        .from(follows)
        .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)))
        .limit(1),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  follow: (followerId: string, followeeId: string, at: Date) =>
    query(() => db.insert(follows).values({ followerId, followeeId, createdAt: at }).onConflictDoNothing()).pipe(
      Effect.asVoid,
    ),
  unfollow: (followerId: string, followeeId: string) =>
    query(() =>
      db.delete(follows).where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId))),
    ).pipe(Effect.asVoid),
  /** Those the account follows, the most recently followed first. */
  followees: (followerId: string) =>
    query(() =>
      db
        .select({ accountId: follows.followeeId })
        .from(follows)
        .where(eq(follows.followerId, followerId))
        .orderBy(desc(follows.createdAt))
        .limit(listLimit),
    ).pipe(Effect.map((rows) => rows.map(({ accountId }) => accountId))),
})

const blockRows = (db: Drizzle) => ({
  /** Whether either account blocked the other. */
  blockedBetween: (left: string, right: string) =>
    query(() =>
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
    query(() =>
      db
        .select({ id: blocks.blockedId })
        .from(blocks)
        .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
        .limit(1),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** A block, and every follow between the two, as one atomic batch. */
  block: (blockerId: string, blockedId: string, at: Date) =>
    query(() =>
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
    query(() => db.delete(blocks).where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))).pipe(
      Effect.asVoid,
    ),
  /** Those the account blocked, the most recent first. */
  blockedBy: (blockerId: string) =>
    query(() =>
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
      query(() =>
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

const reportRows = (db: Drizzle) => ({
  /** How many reports the account filed since `since`. */
  reportsSince: (reporterId: string, since: Date) =>
    query(() =>
      db
        .select({ total: count() })
        .from(reports)
        .where(and(eq(reports.reporterId, reporterId), gte(reports.createdAt, since))),
    ).pipe(Effect.map((rows) => rows[0]?.total ?? 0)),
  /** File the report once per reporter and target; answers whether this one was new, and how many people reported
   * the target. */
  report: (row: ReportRow) =>
    Effect.gen(function* () {
      const filed = yield* query(() =>
        db.insert(reports).values(row).onConflictDoNothing().returning({ id: reports.id }),
      )
      const reporters = yield* query(() =>
        db
          .select({ total: count() })
          .from(reports)
          .where(and(eq(reports.targetKind, row.targetKind), eq(reports.targetId, row.targetId))),
      )
      return { filed: filed.length > 0, reporters: reporters[0]?.total ?? 0 }
    }),
})

/** Saves, follows, blocks and reports in D1. Every read and write names the account it is for. */
const socialStore = (db: Drizzle) => ({
  ...savesAndFollows(db),
  ...blockRows(db),
  ...reportRows(db),
  ...receiptRows(db),
})

/** Saves, follows, blocks and reports over the application's one database. */
export class SocialStore extends Context.Service<SocialStore, ReturnType<typeof socialStore>>()(
  '@styld/server/social/SocialStore',
) {
  static readonly layer = Layer.effect(this, Effect.map(Database, socialStore))
}
