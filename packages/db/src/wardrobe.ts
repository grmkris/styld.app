import { ImageType, Pattern, PieceRotation, PieceSource, PieceStatus, PieceType, VideoType } from '@styld/protocol'
import { sql } from 'drizzle-orm'
import { type AnySQLiteColumn, check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { jsonArray, oneOf } from './checks.ts'
import { detections } from './capture.ts'
import { accounts } from './identity.ts'

// The wardrobe: the pieces someone owns, and the photos on their way in. A piece's photo lives in R2 under
// `accounts/<accountId>/`, so deleting an account removes its photos with one prefix sweep.

const uploadStatuses = ['pending', 'received', 'used'] as const

/** A photo or video on its way in. The token that authorises the `PUT` is stored only as its digest. `used` once a
 * piece, a capture or an outfit photo took it; the sweep forgets the rest. */
export const uploads = sqliteTable(
  'uploads',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    tokenDigest: text('token_digest').notNull(),
    contentType: text('content_type', { enum: [...ImageType.literals, ...VideoType.literals] }).notNull(),
    bytes: integer('bytes').notNull(),
    objectKey: text('object_key').notNull(),
    status: text('status', { enum: uploadStatuses }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('uploads_account').on(table.accountId),
    index('uploads_status_expiry').on(table.status, table.expiresAt),
    oneOf('uploads_content_type', table.contentType, [...ImageType.literals, ...VideoType.literals]),
    oneOf('uploads_status', table.status, uploadStatuses),
  ],
)

/** A piece of clothing someone owns: its garment type (`@styld/protocol` › Garment; its group and outfit place follow
 * from it), its details, and its photo. */
export const pieces = sqliteTable(
  'pieces',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name'),
    notes: text('notes'),
    type: text('type', { enum: PieceType.literals }).notNull(),
    /** Distinct colours, at most six; matching reads them with `instr`. */
    colours: text('colours', { mode: 'json' }).notNull().$type<ReadonlyArray<string>>(),
    /** The seasons it is worn in, none for all year (T-12). */
    seasons: text('seasons', { mode: 'json' })
      .notNull()
      .default(sql`'[]'`)
      .$type<ReadonlyArray<string>>(),
    rainproof: integer('rainproof', { mode: 'boolean' }).notNull().default(false),
    /** The person's own category under its type, such as Ski pants under sportswear (T-12). */
    category: text('category'),
    occasions: text('occasions', { mode: 'json' }).notNull().$type<ReadonlyArray<string>>(),
    pattern: text('pattern', { enum: Pattern.literals }),
    brand: text('brand'),
    shopUrl: text('shop_url'),
    status: text('status', { enum: PieceStatus.literals }).notNull(),
    source: text('source', { enum: PieceSource.literals }).notNull(),
    /** The photo an added piece came from; none for a piece kept from the review tray, whose photo can hold several. */
    uploadId: text('upload_id')
      .unique()
      .references(() => uploads.id, { onDelete: 'set null' }),
    /** The detection a reviewed piece came from. The one copy of that link: its uniqueness is what keeps two reviews
     * of one detection from making two pieces. */
    detectionId: text('detection_id')
      .unique()
      .references((): AnySQLiteColumn => detections.id, { onDelete: 'set null' }),
    /** The back of the garment, when the camera saw it. */
    backImageKey: text('back_image_key'),
    /** A durable clockwise quarter-turn for legacy photos whose orientation is wrong. */
    rotation: integer('rotation').$type<PieceRotation>().notNull().default(0),
    /** The photo as it arrived; the shown image once the cut-out step has run. */
    originalKey: text('original_key').notNull(),
    imageKey: text('image_key'),
    contentType: text('content_type').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('pieces_account_created').on(table.accountId, table.createdAt),
    index('pieces_status_updated').on(table.status, table.updatedAt),
    oneOf('pieces_type', table.type, PieceType.literals),
    jsonArray('pieces_seasons', table.seasons),
    oneOf('pieces_pattern', table.pattern, Pattern.literals),
    oneOf('pieces_status', table.status, PieceStatus.literals),
    oneOf('pieces_source', table.source, PieceSource.literals),
    check('pieces_rotation', sql`${table.rotation} IN (0, 90, 180, 270)`),
    jsonArray('pieces_colours', table.colours),
    jsonArray('pieces_occasions', table.occasions),
  ],
)
