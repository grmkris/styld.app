import { GenerationKind, GenerationReason, GenerationStatus, TryOnStatus } from '@styld/protocol'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { boardImages, boardOwned } from './boards.ts'
import { jsonArray, oneOf } from './checks.ts'
import { accounts } from './identity.ts'
import { outfitPhotos } from './photos.ts'
import { pieces } from './wardrobe.ts'

// What Styld makes for a board: a sticker drawn from words, or a mood board of the person's own pieces (owner,
// 2026-10-31). D1 owns the lifecycle; the Wallet holds the ask's one credit from the start, and it settles once, by
// the job's status.

/** One ask: the person's words, how far Styld got, and the moods its plan suggested. */
export const generationJobs = sqliteTable(
  'generation_jobs',
  {
    ...boardOwned(),
    kind: text('kind', { enum: GenerationKind.literals }).notNull(),
    /** The person's own words; never logged. */
    prompt: text('prompt').notNull(),
    status: text('status', { enum: GenerationStatus.literals }).notNull(),
    /** Why it stopped short, when it did. */
    reason: text('reason', { enum: GenerationReason.literals }),
    /** The collage's version when it was asked: a mood board lays the collage out only if nobody changed it since. */
    collageVersion: integer('collage_version').notNull(),
    /** The moods the plan suggested, from the fixed list. */
    moods: text('moods', { mode: 'json' }).$type<ReadonlyArray<string>>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('generation_jobs_account').on(table.accountId, table.createdAt),
    index('generation_jobs_board').on(table.boardId),
    index('generation_jobs_status_updated').on(table.status, table.updatedAt),
    oneOf('generation_jobs_kind', table.kind, GenerationKind.literals),
    oneOf('generation_jobs_status', table.status, GenerationStatus.literals),
    oneOf('generation_jobs_reason', table.reason, GenerationReason.literals),
    jsonArray('generation_jobs_moods', table.moods),
  ],
)

/** The pieces a mood board's plan picked, in its order. A piece deleted before the board is laid out drops out. */
export const generationPicks = sqliteTable(
  'generation_picks',
  {
    jobId: text('job_id')
      .notNull()
      .references(() => generationJobs.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    pieceId: text('piece_id')
      .notNull()
      .references(() => pieces.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.position] }),
    index('generation_picks_piece').on(table.pieceId),
  ],
)

const stickerStatuses = ['waiting', 'drawing', 'drawn', 'refused', 'unknown'] as const

/** A sticker job's one picture: its prompt and its outcome. A picture whose draw started but whose answer was lost is
 * unknown: it is never drawn again on its own. A mood board has none. */
export const generationPictures = sqliteTable(
  'generation_pictures',
  {
    jobId: text('job_id')
      .primaryKey()
      .references(() => generationJobs.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    status: text('status', { enum: stickerStatuses }).notNull(),
    imageId: text('image_id').references(() => boardImages.id, { onDelete: 'set null' }),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('generation_pictures_image').on(table.imageId),
    oneOf('generation_pictures_status', table.status, stickerStatuses),
  ],
)

// Try on (owner, 4 November 2026): one of the person's own My Gallery photos redrawn with them wearing pieces of their
// wardrobe. D1 owns the lifecycle, as for stickers; the Wallet holds its credits from the start and they settle once,
// by its status. A try-on goes with its photo: the rows cascade and its result is stored under the photo's prefix.

/** One try-on: the photo it starts from, when its owner said the photo shows them, how far it got, and its result. A
 * drawing claimed (`startedAt`) whose answer was lost is never drawn again on its own. */
export const tryOns = sqliteTable(
  'try_ons',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    photoId: text('photo_id')
      .notNull()
      .references(() => outfitPhotos.id, { onDelete: 'cascade' }),
    status: text('status', { enum: TryOnStatus.literals }).notNull(),
    /** When a delivery claimed the drawing; none until then. */
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    /** The drawn picture, once there is one. */
    resultKey: text('result_key'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('try_ons_account_created').on(table.accountId, table.createdAt),
    index('try_ons_photo').on(table.photoId),
    index('try_ons_status_updated').on(table.status, table.updatedAt),
    oneOf('try_ons_status', table.status, TryOnStatus.literals),
  ],
)

/** The pieces a try-on wears, in the order chosen. A piece deleted later drops out of the list. */
export const tryOnPieces = sqliteTable(
  'try_on_pieces',
  {
    tryOnId: text('try_on_id')
      .notNull()
      .references(() => tryOns.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    pieceId: text('piece_id')
      .notNull()
      .references(() => pieces.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.tryOnId, table.position] }), index('try_on_pieces_piece').on(table.pieceId)],
)
