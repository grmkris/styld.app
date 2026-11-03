import { CaptureSource, CaptureStatus, Pattern, PictureChoice, PieceType, Side } from '@styld/protocol'
import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'
import { jsonArray, oneOf } from './checks.ts'
import { accounts } from './identity.ts'
import { photoGarments } from './photos.ts'
import { pieces, uploads } from './wardrobe.ts'

// Capture: photos and videos on their way to pieces, the garments found in them waiting in the review tray, and the
// work on a kept piece's pictures (its clean drawing and its turn on a hanger). Credits are held in the Wallet, never
// mirrored here: each row's status is what its sweep settles a hold by.

const captureKinds = ['photo', 'video'] as const
/** How a person added something (`CaptureSource`), or `photos`: a garment offered from one of their outfit photos. */
const captureSources = [...CaptureSource.literals, 'photos'] as const
/** How many garments the decision model saw in a photo (`capture/Providers.ts` `Route`). */
const routes = ['none', 'one', 'several'] as const

/** A photo or a video on its way to pieces. Its upload is where it came from; a garment offered from an outfit photo
 * (source `photos`) has none, and names its garment instead. */
export const captures = sqliteTable(
  'captures',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: captureKinds }).notNull(),
    source: text('source', { enum: captureSources }).notNull(),
    status: text('status', { enum: CaptureStatus.literals }).notNull(),
    uploadId: text('upload_id')
      .unique()
      .references(() => uploads.id),
    /** The outfit photo's garment it offers; one capture per garment. */
    garmentId: text('garment_id')
      .unique()
      .references((): AnySQLiteColumn => photoGarments.id, { onDelete: 'set null' }),
    originalKey: text('original_key').notNull(),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    side: text('side', { enum: Side.literals }),
    /** The front capture a back was taken for. */
    pairsWith: text('pairs_with').references((): AnySQLiteColumn => captures.id, { onDelete: 'set null' }),
    route: text('route', { enum: routes }),
    /** Who cut it (`clef`, `cloudflare`, `sam`), for the keep rates' metrics. */
    provider: text('provider'),
    /** The video's file at SAM, so a redelivery does not hand it over twice. */
    providerFileId: text('provider_file_id'),
    frameCount: integer('frame_count'),
    durationMs: integer('duration_ms'),
    width: integer('width'),
    height: integer('height'),
    credits: integer('credits').notNull(),
    /** How many times the person asked to try again; a capture is retried a few times at most. */
    attempt: integer('attempt').notNull(),
    /** One id for every part of a video, and for photos picked together: a garment seen in several of them is one
     * card in the tray (2026-10-31). None for a capture on its own. */
    importId: text('import_id'),
    /** When the video was handed to Meta to track. A delivery that finds it set but no result does not
     * track again, which could pay twice; the capture waits as `unknown` instead. */
    trackingStartedAt: integer('tracking_started_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('captures_account_created').on(table.accountId, table.createdAt),
    index('captures_status_updated').on(table.status, table.updatedAt),
    index('captures_account_import').on(table.accountId, table.importId),
    index('captures_pairs_with').on(table.pairsWith),
    oneOf('captures_kind', table.kind, captureKinds),
    oneOf('captures_source', table.source, captureSources),
    oneOf('captures_status', table.status, CaptureStatus.literals),
    oneOf('captures_side', table.side, Side.literals),
    oneOf('captures_route', table.route, routes),
    check('captures_origin', sql`(${table.source} = 'photos') = (${table.uploadId} IS NULL)`),
  ],
)

/** The stills the browser sampled from a video, uploaded beside it. */
export const captureFrames = sqliteTable(
  'capture_frames',
  {
    captureId: text('capture_id')
      .notNull()
      .references(() => captures.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    uploadId: text('upload_id')
      .notNull()
      .unique()
      .references(() => uploads.id),
    objectKey: text('object_key').notNull(),
    atMs: integer('at_ms').notNull(),
    sharpness: text('sharpness', { mode: 'json' }).notNull().$type<ReadonlyArray<number>>(),
  },
  (table) => [
    primaryKey({ columns: [table.captureId, table.idx] }),
    jsonArray('capture_frames_sharpness', table.sharpness),
  ],
)

const detectionStatuses = ['review', 'kept', 'discarded'] as const
const matchingStates = ['waiting', 'claimed', 'done'] as const

/** A garment found in a capture, waiting for the person to keep or discard it. A kept one names its piece through
 * `pieces.detection_id`. */
export const detections = sqliteTable(
  'detections',
  {
    id: text('id').primaryKey(),
    captureId: text('capture_id')
      .notNull()
      .references(() => captures.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    status: text('status', { enum: detectionStatuses }).notNull(),
    /** The cut-out; none when the original photo is the only picture. */
    cutoutKey: text('cutout_key'),
    /** The photo or video still the piece was found in. */
    sourceKey: text('source_key').notNull(),
    backCutoutKey: text('back_cutout_key'),
    /** How sure SAM was of the cut-out; none for a garment offered from an outfit photo. */
    confidence: real('confidence'),
    preselected: integer('preselected', { mode: 'boolean' }).notNull(),
    suggestedType: text('suggested_type', { enum: PieceType.literals }),
    suggestedColours: text('suggested_colours', { mode: 'json' }).notNull().$type<ReadonlyArray<string>>(),
    suggestedSeasons: text('suggested_seasons', { mode: 'json' })
      .notNull()
      .default(sql`'[]'`)
      .$type<ReadonlyArray<string>>(),
    suggestedRainproof: integer('suggested_rainproof', { mode: 'boolean' }).notNull().default(false),
    suggestedOccasions: text('suggested_occasions', { mode: 'json' }).notNull().$type<ReadonlyArray<string>>(),
    suggestedPattern: text('suggested_pattern', { enum: Pattern.literals }),
    /** How likely the decision model thinks the cut-out shows one whole garment (0–1); under 0.5 the tray lists it
     * as needing a better look. None for a garment offered from an outfit photo. */
    whole: real('whole'),
    /** The sighting a garment is shown by when this one is another sighting of it, in another part or photo of the
     * same import: the tray shows one card for them. */
    groupOf: text('group_of').references((): AnySQLiteColumn => detections.id, { onDelete: 'set null' }),
    /** The account's piece the decision model took this garment for: "Already in your wardrobe?". */
    duplicateOf: text('duplicate_of').references(() => pieces.id, { onDelete: 'set null' }),
    /** Where the garment is in being compared with the import's other sightings and the wardrobe. The import's
     * detections are compared one at a time, oldest first, each claimed before it is, so two parts finishing
     * together still compare with each other. None for one that is never compared (no cut-out or no type). */
    matching: text('matching', { enum: matchingStates }),
    matchClaimedAt: integer('match_claimed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('detections_capture').on(table.captureId),
    index('detections_account').on(table.accountId),
    index('detections_group').on(table.groupOf),
    index('detections_duplicate').on(table.duplicateOf),
    oneOf('detections_status', table.status, detectionStatuses),
    oneOf('detections_suggested_type', table.suggestedType, PieceType.literals),
    jsonArray('detections_suggested_seasons', table.suggestedSeasons),
    oneOf('detections_suggested_pattern', table.suggestedPattern, Pattern.literals),
    oneOf('detections_matching', table.matching, matchingStates),
    jsonArray('detections_suggested_colours', table.suggestedColours),
    jsonArray('detections_suggested_occasions', table.suggestedOccasions),
  ],
)

/** The key of a row that belongs to one piece, and its owner's account: it goes with either. */
const pieceOwned = () => ({
  pieceId: text('piece_id')
    .primaryKey()
    .references(() => pieces.id, { onDelete: 'cascade' }),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
})

const pictureStates = [
  'queued',
  'generating',
  'checking',
  'ready',
  'proposed',
  'rejected',
  'retake',
  'kept-real',
  'failed',
] as const
const keyColours = ['green', 'magenta'] as const

/** A piece's clean picture: an image model's drawing of the garment from its kept cut-out, checked against it
 * (owner, 2026-10-30). One row per piece, written only by the picture job and the person's choice; the real
 * photo on the piece is never replaced. `state` moves only from the state it was read in. */
export const piecePictures = sqliteTable(
  'piece_pictures',
  {
    ...pieceOwned(),
    state: text('state', { enum: pictureStates }).notNull(),
    /** What the person chose to show; none follows the state (ready shows the drawing, proposed the photo). */
    shown: text('shown', { enum: PictureChoice.literals }),
    /** The keyed drawing, `accounts/<a>/pieces/<id>/clean-<version>.png`. */
    cleanKey: text('clean_key'),
    /** Counts drawings: each redraw is the next version, and image URLs carry it. */
    version: integer('version').notNull(),
    keyColour: text('key_colour', { enum: keyColours }),
    /** Who drew it, for the pictures' metrics. */
    provider: text('provider'),
    /** How likely a face shows in the cut-out (0–1): a redraw is refused when one does. */
    face: real('face'),
    /** The person's own words on a redraw, sent with the prompt; never logged. */
    hint: text('hint'),
    /** How many redraws the owner paid for; the latest is held as `picture/<piece>/<redraws>` (usage/Holds.ts). */
    redraws: integer('redraws').notNull(),
    /** Whether the drawing being made or last made is a paid redraw: drawn whatever the verdict, and settled. */
    paid: integer('paid', { mode: 'boolean' }).notNull(),
    /** When a delivery claimed the drawing; a claim older than the queue's patience is an unknown outcome. */
    claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('piece_pictures_account').on(table.accountId),
    index('piece_pictures_state_updated').on(table.state, table.updatedAt),
    oneOf('piece_pictures_state', table.state, pictureStates),
    oneOf('piece_pictures_shown', table.shown, PictureChoice.literals),
    oneOf('piece_pictures_key_colour', table.keyColour, keyColours),
  ],
)

const turnStates = ['requested', 'anchoring', 'generating', 'video-ready', 'ready', 'rejected', 'failed'] as const

/** A piece's turn: its clean picture on a hanger turning a quarter-turn, made on request for credits (owner,
 * 2026-10-30). The video model's job is kept as `operation` before polling; the phone packs the video's frames into a
 * sheet under the piece's prefix, laid out as `layout` says. */
export const pieceTurns = sqliteTable(
  'piece_turns',
  {
    ...pieceOwned(),
    state: text('state', { enum: turnStates }).notNull(),
    /** Counts the turns asked for this piece; each holds its credits as `turn/<piece>/<attempt>` (usage/Holds.ts). */
    attempt: integer('attempt').notNull(),
    operation: text('operation', { mode: 'json' }),
    layout: text('layout', { mode: 'json' }).$type<{
      readonly frames: number
      readonly columns: number
      readonly width: number
      readonly height: number
      readonly pivot: readonly [number, number]
    }>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('piece_turns_account').on(table.accountId),
    index('piece_turns_state_updated').on(table.state, table.updatedAt),
    oneOf('piece_turns_state', table.state, turnStates),
  ],
)

const fileProviders = ['meta-sam'] as const

/** A video handed to a provider (Meta's Files API), written with the capture that holds its id and kept until the
 * provider confirms it deleted the file; a sweep deletes what tracking could not. No foreign key: a file outlives its
 * capture and its account until the provider has let it go. */
export const providerFiles = sqliteTable(
  'provider_files',
  {
    fileId: text('file_id').primaryKey(),
    provider: text('provider', { enum: fileProviders }).notNull(),
    accountId: text('account_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('provider_files_created').on(table.createdAt),
    index('provider_files_account').on(table.accountId),
    oneOf('provider_files_provider', table.provider, fileProviders),
  ],
)
