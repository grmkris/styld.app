import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './identity.ts'
import { pieces } from './wardrobe.ts'

// Looks: outfits kept from the person's own pieces.

/** An outfit the person or an assistant put together from the person's pieces. */
export const looks = sqliteTable(
  'looks',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    occasion: text('occasion'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    /** When the person shared the look; it is public only while this is set and its check lets it. The feed's cursor. */
    sharedAt: integer('shared_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('looks_account_created').on(table.accountId, table.createdAt),
    index('looks_shared').on(table.sharedAt),
  ],
)

/** The pieces of a look, in the order it shows them. Deleting a piece takes it out of its looks. */
export const lookPieces = sqliteTable(
  'look_pieces',
  {
    lookId: text('look_id')
      .notNull()
      .references(() => looks.id, { onDelete: 'cascade' }),
    pieceId: text('piece_id')
      .notNull()
      .references(() => pieces.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (table) => [primaryKey({ columns: [table.lookId, table.pieceId] }), index('look_pieces_piece').on(table.pieceId)],
)
