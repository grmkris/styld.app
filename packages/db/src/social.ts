import { ReportReason, Tone } from '@styld/protocol'
import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { boards } from './boards.ts'
import { oneOf } from './checks.ts'
import { accounts } from './identity.ts'
import { looks } from './looks.ts'
import { pieces } from './wardrobe.ts'

// What people do with each other (Boards, profiles and social): profiles, saves, follows, blocks and reports.

/** A person's public face: a handle, a name, a city and a bio, published or not. Only an admin marks the house
 * account or features a profile. */
export const profiles = sqliteTable(
  'profiles',
  {
    accountId: text('account_id')
      .primaryKey()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    handle: text('handle').unique(),
    name: text('name').notNull(),
    city: text('city'),
    bio: text('bio'),
    tone: text('tone', { enum: Tone.literals }).notNull(),
    published: integer('published', { mode: 'boolean' }).notNull(),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    featuredAt: integer('featured_at', { mode: 'timestamp_ms' }),
    /** The name and handle, folded the way search folds what people type. */
    searchText: text('search_text').notNull(),
    house: integer('house', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('profiles_published').on(table.published, table.featuredAt),
    oneOf('profiles_tone', table.tone, Tone.literals),
  ],
)

const saveKinds = ['piece', 'look', 'board'] as const

/** What a person saved from others: a public piece, a shared look or a public board, once each. Saving is a
 * bookmark; the thing shows while its owner keeps it public, and goes with it. */
export const saves = sqliteTable(
  'saves',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: saveKinds }).notNull(),
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
    index('saves_piece').on(table.pieceId),
    index('saves_look').on(table.lookId),
    index('saves_board').on(table.boardId),
    oneOf('saves_kind', table.kind, saveKinds),
    check(
      'saves_target',
      sql`(${table.kind} = 'piece') = (${table.pieceId} IS NOT NULL) AND (${table.kind} = 'look') = (${table.lookId} IS NOT NULL) AND (${table.kind} = 'board') = (${table.boardId} IS NOT NULL)`,
    ),
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

const reportTargets = ['profile', 'board', 'look', 'piece'] as const

/** One report per reporter and target: why, in their words, and whose the target is (the report goes with them). */
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
    targetKind: text('target_kind', { enum: reportTargets }).notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason', { enum: ReportReason.literals }).notNull(),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('reports_reporter_target').on(table.reporterId, table.targetKind, table.targetId),
    index('reports_target').on(table.targetKind, table.targetId),
    index('reports_reporter_created').on(table.reporterId, table.createdAt),
    index('reports_owner').on(table.ownerId),
    oneOf('reports_target_kind', table.targetKind, reportTargets),
    oneOf('reports_reason', table.reason, ReportReason.literals),
  ],
)
