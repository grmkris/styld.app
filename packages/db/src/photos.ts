import { GarmentMatch, PhotoStatus, PieceType } from '@styld/protocol'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { jsonArray, oneOf } from './checks.ts'
import { accounts } from './identity.ts'
import { looks } from './looks.ts'
import { pieces, uploads } from './wardrobe.ts'

// My Gallery (owner, 2026-10-31): the person's own outfit photos, private, never a capture. Styld finds the garments
// in each (1 credit) and matches them to the person's pieces; the person confirms or corrects each match. A photo and
// its garments go with the account; a deleted piece leaves the photo, unmatched.

/** One outfit photo: the upload it came from, how far finding its garments got, whether it is a favourite, the look
 * "Wear it again" saved from it, and the person cut out of it for collages. */
export const outfitPhotos = sqliteTable(
  'outfit_photos',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    uploadId: text('upload_id')
      .notNull()
      .references(() => uploads.id),
    originalKey: text('original_key').notNull(),
    contentType: text('content_type').notNull(),
    status: text('status', { enum: PhotoStatus.literals }).notNull(),
    favourite: integer('favourite', { mode: 'boolean' }).notNull(),
    lookId: text('look_id').references(() => looks.id, { onDelete: 'set null' }),
    cutoutKey: text('cutout_key'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('outfit_photos_upload').on(table.uploadId),
    index('outfit_photos_account_created').on(table.accountId, table.createdAt),
    index('outfit_photos_status_updated').on(table.status, table.updatedAt),
    index('outfit_photos_look').on(table.lookId),
    oneOf('outfit_photos_status', table.status, PhotoStatus.literals),
  ],
)

/** A garment found in an outfit photo: its cut-out, what Styld took it for, and the piece it is. `suggested` until the
 * person confirms a match; `unmatched` when nothing in the wardrobe is it; `offered` once sent to the review tray, as
 * the capture that names it (`captures.garment_id`). */
export const photoGarments = sqliteTable(
  'photo_garments',
  {
    id: text('id').primaryKey(),
    photoId: text('photo_id')
      .notNull()
      .references(() => outfitPhotos.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    cutoutKey: text('cutout_key').notNull(),
    type: text('type', { enum: PieceType.literals }),
    colours: text('colours', { mode: 'json' }).notNull().$type<ReadonlyArray<string>>(),
    pieceId: text('piece_id').references(() => pieces.id, { onDelete: 'set null' }),
    state: text('state', { enum: GarmentMatch.literals }).notNull(),
  },
  (table) => [
    uniqueIndex('photo_garments_position').on(table.photoId, table.position),
    index('photo_garments_piece').on(table.pieceId),
    oneOf('photo_garments_type', table.type, PieceType.literals),
    oneOf('photo_garments_state', table.state, GarmentMatch.literals),
    jsonArray('photo_garments_colours', table.colours),
  ],
)
