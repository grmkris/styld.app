import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { accounts, boards, looks, pieces } from './schema.ts'

// What people do with each other (Boards, profiles and social, M4): saves, follows, blocks and reports.

/** What a person saved from others: a public piece, a shared look or a public board, once each. Saving is a
 * bookmark; the thing shows while its owner keeps it public, and goes with it. */
export const saves = sqliteTable(
  'saves',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['piece', 'look', 'board'] }).notNull(),
    pieceId: text('piece_id').references(() => pieces.id, { onDelete: 'cascade' }),
    lookId: text('look_id').references(() => looks.id, { onDelete: 'cascade' }),
    boardId: text('board_id').references(() => boards.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('saves_account_piece').on(table.accountId, table.pieceId),
    uniqueIndex('saves_account_look').on(table.accountId, table.lookId),
    uniqueIndex('saves_account_board').on(table.accountId, table.boardId),
    index('saves_account_created').on(table.accountId, table.createdAt),
  ],
)

/** Who follows whom: one-way and private; nobody sees counts. */
export const follows = sqliteTable(
  'follows',
  {
    followerId: text('follower_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    followeeId: text('followee_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followeeId] }),
    index('follows_followee').on(table.followeeId),
  ],
)

/** Who blocked whom. A block hides both people from each other and is never told. */
export const blocks = sqliteTable(
  'blocks',
  {
    blockerId: text('blocker_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    blockedId: text('blocked_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.blockerId, table.blockedId] }), index('blocks_blocked').on(table.blockedId)],
)

/** One report per reporter and target: why, in their words, and whose the target is. */
export const reports = sqliteTable(
  'reports',
  {
    id: text('id').primaryKey(),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    targetKind: text('target_kind', { enum: ['profile', 'board', 'look', 'piece'] }).notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason', {
      enum: ['spam', 'nudity', 'harassment', 'hate', 'violence', 'self_harm', 'ip', 'other'],
    }).notNull(),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('reports_reporter_target').on(table.reporterId, table.targetKind, table.targetId),
    index('reports_target').on(table.targetKind, table.targetId),
    index('reports_reporter_created').on(table.reporterId, table.createdAt),
  ],
)
