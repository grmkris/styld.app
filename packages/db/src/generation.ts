import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { boardImages, boardOwned } from './schema.ts'

// What Styld makes for a board: a sticker drawn from words, or a mood board of the person's own pieces (owner,
// 2026-10-31). D1 owns the lifecycle; the Wallet holds the ask's one credit from the start, and it settles once.

/** One ask: the person's words, how far Styld got, and what its plan picked. */
export const generationJobs = sqliteTable(
  'generation_jobs',
  {
    ...boardOwned(),
    kind: text('kind', { enum: ['sticker', 'moodBoard'] }).notNull(),
    /** The person's own words; never logged. */
    prompt: text('prompt').notNull(),
    status: text('status', { enum: ['planning', 'drawing', 'arranging', 'done', 'refused', 'failed'] }).notNull(),
    /** Why it stopped short, when it did. */
    reason: text('reason'),
    /** How many credits are held: one. */
    held: integer('held').notNull(),
    /** The collage's version when it was asked: a mood board lays the collage out only if nobody changed it since. */
    collageVersion: integer('collage_version').notNull(),
    /** The pieces the plan picked, by id, and the moods it suggested. */
    picks: text('picks', { mode: 'json' }).$type<ReadonlyArray<string>>().notNull(),
    moods: text('moods', { mode: 'json' }).$type<ReadonlyArray<string>>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('generation_jobs_account').on(table.accountId, table.createdAt),
    index('generation_jobs_status_updated').on(table.status, table.updatedAt),
  ],
)

/** A sticker job's picture: its prompt and its outcome. A picture whose draw started but whose answer was lost is
 * unknown: it is never drawn again on its own. */
export const generationPictures = sqliteTable(
  'generation_pictures',
  {
    jobId: text('job_id')
      .notNull()
      .references(() => generationJobs.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    prompt: text('prompt').notNull(),
    status: text('status', { enum: ['waiting', 'drawing', 'drawn', 'refused', 'unknown'] }).notNull(),
    imageId: text('image_id').references(() => boardImages.id, { onDelete: 'set null' }),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  },
  (table) => [primaryKey({ columns: [table.jobId, table.index] })],
)
