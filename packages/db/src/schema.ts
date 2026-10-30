import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  securityRevision: text('security_revision').notNull(),
  displayName: text('display_name').notNull(),
  // A runtime default, not a column default: email registration inserts the account through a
  // synchronous Yielded mapping callback that cannot read Effect's Clock.
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const authAttemptBuckets = sqliteTable(
  'auth_attempt_buckets',
  {
    key: text('key').primaryKey().notNull(),
    tokens: real('tokens').notNull(),
    updatedAt: integer('updated_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('auth_attempt_buckets_expiry').on(table.expiresAt)],
)

/** MCP clients registered dynamically (RFC 7591): public clients only, with exact redirect URIs. */
export const oauthClients = sqliteTable('oauth_clients', {
  clientId: text('client_id').primaryKey(),
  name: text('name').notNull(),
  redirectUris: text('redirect_uris', { mode: 'json' }).notNull().$type<ReadonlyArray<string>>(),
  applicationType: text('application_type', { enum: ['web', 'native'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

/** The OAuth server's grant records, compared and replaced by version. */
export const oauthGrants = sqliteTable(
  'oauth_grants',
  {
    namespace: text('namespace').notNull(),
    id: text('id').notNull(),
    version: text('version').notNull(),
    record: text('record').notNull(),
    subjectId: text('subject_id'),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.namespace, table.id] }),
    index('oauth_grants_subject').on(table.subjectId),
    index('oauth_grants_expiry').on(table.expiresAt),
  ],
)

/** Client assertion receipts, each consumable once until it expires. */
export const oauthAssertions = sqliteTable(
  'oauth_assertions',
  {
    namespace: text('namespace').notNull(),
    receipt: text('receipt').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.namespace, table.receipt] })],
)

/** A piece of clothing someone owns. Its photo lives in R2 under `accounts/<accountId>/`, so deleting
 * an account removes its photos with one prefix sweep. */
export const pieces = sqliteTable(
  'pieces',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name'),
    notes: text('notes'),
    category: text('category').notNull(),
    subcategory: text('subcategory'),
    colours: text('colours', { mode: 'json' }).notNull().$type<ReadonlyArray<string>>(),
    status: text('status', { enum: ['processing', 'ready', 'failed'] }).notNull(),
    source: text('source', { enum: ['website', 'assistant'] }).notNull(),
    /** The photo an added piece came from. Pieces from a reviewed capture point at their detection
     * instead, and one photo can hold several of them. */
    uploadId: text('upload_id').unique(),
    /** The detection a reviewed piece came from: one detection makes at most one piece. */
    detectionId: text('detection_id').unique(),
    /** The back of the garment, when the camera saw it. */
    backImageKey: text('back_image_key'),
    /** The photo as it arrived; the shown image once the cutout step has run. */
    originalKey: text('original_key').notNull(),
    imageKey: text('image_key'),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('pieces_account_created').on(table.accountId, table.createdAt)],
)

/** A photo on its way in. The token that authorises the `PUT` is stored only as its digest. */
export const uploads = sqliteTable(
  'uploads',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    tokenDigest: text('token_digest').notNull(),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    objectKey: text('object_key').notNull(),
    status: text('status', { enum: ['pending', 'received', 'used'] }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('uploads_account').on(table.accountId), index('uploads_expiry').on(table.expiresAt)],
)

/** A photo or a video on its way to pieces. Its credits are held in the Wallet until it settles. */
export const captures = sqliteTable(
  'captures',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['photo', 'video'] }).notNull(),
    source: text('source', { enum: ['picker', 'camera', 'video', 'assistant'] }).notNull(),
    status: text('status', { enum: ['processing', 'review', 'done', 'failed', 'unknown'] }).notNull(),
    uploadId: text('upload_id').notNull().unique(),
    originalKey: text('original_key').notNull(),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    side: text('side', { enum: ['front', 'back', 'unclear'] }),
    pairsWith: text('pairs_with'),
    route: text('route'),
    routeConfidence: real('route_confidence'),
    provider: text('provider'),
    providerFileId: text('provider_file_id'),
    frameCount: integer('frame_count'),
    durationMs: integer('duration_ms'),
    width: integer('width'),
    height: integer('height'),
    credits: integer('credits').notNull(),
    settlement: text('settlement', { enum: ['held', 'consumed', 'refunded'] }).notNull(),
    /** The Wallet operation holding this capture's credits: a retry after a refund holds them again
     * under a new one. Captures made before it existed hold under `capture/<id>`. */
    hold: text('hold'),
    /** How many times the person asked to try again; a capture is retried a few times at most. */
    attempt: integer('attempt').notNull().default(0),
    /** When the video was handed to Meta to track. A delivery that finds it set but no result does not
     * track again, which could pay twice; the capture waits as `unknown` instead. */
    trackingStartedAt: integer('tracking_started_at', { mode: 'timestamp_ms' }),
    errorCode: text('error_code'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('captures_account_created').on(table.accountId, table.createdAt)],
)

/** The stills the browser sampled from a video, uploaded beside it. */
export const captureFrames = sqliteTable(
  'capture_frames',
  {
    captureId: text('capture_id')
      .notNull()
      .references(() => captures.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    uploadId: text('upload_id').notNull().unique(),
    objectKey: text('object_key').notNull(),
    atMs: integer('at_ms').notNull(),
    sharpness: text('sharpness', { mode: 'json' }).notNull().$type<ReadonlyArray<number>>(),
  },
  (table) => [primaryKey({ columns: [table.captureId, table.idx] })],
)

/** A piece found in a capture, waiting for the person to keep or discard it. */
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
    status: text('status', { enum: ['review', 'kept', 'discarded'] }).notNull(),
    /** The cut-out; none when the original photo is the only picture. */
    cutoutKey: text('cutout_key'),
    /** The photo or video still the piece was found in. */
    sourceKey: text('source_key').notNull(),
    backCutoutKey: text('back_cutout_key'),
    track: text('track'),
    confidence: real('confidence'),
    preselected: integer('preselected', { mode: 'boolean' }).notNull(),
    suggestedCategory: text('suggested_category'),
    suggestedSubcategory: text('suggested_subcategory'),
    suggestedColours: text('suggested_colours', { mode: 'json' }).notNull().$type<ReadonlyArray<string>>(),
    pieceId: text('piece_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('detections_capture').on(table.captureId), index('detections_account').on(table.accountId)],
)

/** The answer to each operation id, so a repeated request returns it instead of acting twice. */
export const operationReceipts = sqliteTable(
  'operation_receipts',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    operationId: text('operation_id').notNull(),
    command: text('command').notNull(),
    inputDigest: text('input_digest').notNull(),
    result: text('result').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.operationId] })],
)

/** An outfit the assistant put together from the person's pieces. */
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
  },
  (table) => [index('looks_account_created').on(table.accountId, table.createdAt)],
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

/** A board: a table the person lays their pieces, labels and pictures on. `version` counts saves of the
 * table, so an editor that loaded an older table cannot overwrite a newer one. */
export const boards = sqliteTable(
  'boards',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    paper: text('paper', { enum: ['paper', 'stock', 'sand', 'sage', 'slate', 'clay'] }).notNull(),
    version: integer('version').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('boards_account_updated').on(table.accountId, table.updatedAt)],
)

/** A picture put on a board. Its bytes stay where the photo upload left them, under the account's prefix. */
export const boardImages = sqliteTable(
  'board_images',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('board_images_board').on(table.boardId)],
)

/** What lies on a board's table: one of the person's pieces, a text label or a picture, and where. Deleting
 * a piece takes it off its boards. */
export const boardItems = sqliteTable(
  'board_items',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    kind: text('kind', { enum: ['piece', 'text', 'image'] }).notNull(),
    pieceId: text('piece_id').references(() => pieces.id, { onDelete: 'cascade' }),
    imageId: text('image_id').references(() => boardImages.id, { onDelete: 'cascade' }),
    text: text('text'),
    textStyle: text('text_style', { enum: ['label', 'headline'] }),
    x: real('x').notNull(),
    y: real('y').notNull(),
    size: real('size').notNull(),
    turn: real('turn').notNull(),
    z: integer('z').notNull(),
    flipped: integer('flipped', { mode: 'boolean' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.boardId, table.id] }),
    index('board_items_piece').on(table.pieceId),
    index('board_items_image').on(table.imageId),
  ],
)

/** What is pinned on a board: a piece, a look or a picture put on it. The board's grid shows its pins, newest
 * first; its table places some of them. A piece or look is pinned once per board, and deleting it unpins it. */
export const boardPins = sqliteTable(
  'board_pins',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['piece', 'picture', 'look'] }).notNull(),
    pieceId: text('piece_id').references(() => pieces.id, { onDelete: 'cascade' }),
    imageId: text('image_id').references(() => boardImages.id, { onDelete: 'cascade' }),
    lookId: text('look_id').references(() => looks.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('board_pins_board').on(table.boardId, table.createdAt),
    uniqueIndex('board_pins_board_piece').on(table.boardId, table.pieceId),
    uniqueIndex('board_pins_board_look').on(table.boardId, table.lookId),
    uniqueIndex('board_pins_image').on(table.imageId),
    index('board_pins_piece').on(table.pieceId),
    index('board_pins_look').on(table.lookId),
  ],
)

/** What the person wore on a day (their own calendar day, `2026-10-30`), in the outfit's order. Deleting a
 * piece takes it out of the days it was worn. The key's prefix serves reads by account and day. */
export const wornPieces = sqliteTable(
  'worn_pieces',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    pieceId: text('piece_id')
      .notNull()
      .references(() => pieces.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.day, table.pieceId] }),
    index('worn_pieces_piece').on(table.pieceId),
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

/** A piece's clean picture: an image model's drawing of the garment from its kept cut-out, checked against it
 * (owner, 2026-10-30). One row per piece, written only by the picture job and the person's choice; the real
 * photo on the piece is never replaced. `state` moves only from the state it was read in. */
export const piecePictures = sqliteTable(
  'piece_pictures',
  {
    ...pieceOwned(),
    state: text('state', {
      enum: ['queued', 'generating', 'checking', 'ready', 'proposed', 'rejected', 'retake', 'kept-real', 'failed'],
    }).notNull(),
    /** What the person chose to show; none follows the state (ready shows the drawing, proposed the photo). */
    shown: text('shown', { enum: ['clean', 'photo'] }),
    /** The keyed drawing, `accounts/<a>/pieces/<id>/clean-<version>.png`. */
    cleanKey: text('clean_key'),
    /** Counts drawings: each redraw is the next version, and image URLs carry it. */
    version: integer('version').notNull(),
    keyColour: text('key_colour', { enum: ['green', 'magenta'] }),
    provider: text('provider'),
    model: text('model'),
    /** The decision model's verdict on the cut-out, and its answers about the drawing (0–1). */
    judge: text('judge', { enum: ['ready', 'improve', 'repair', 'fragment'] }),
    judgeConfidence: real('judge_confidence'),
    face: real('face'),
    same: real('same'),
    faithful: real('faithful'),
    /** The person's own words on a redraw, sent with the prompt; never logged. */
    hint: text('hint'),
    /** A redraw's credit reservation, settled when the drawing ends. */
    hold: text('hold'),
    /** When a delivery claimed the drawing; a claim older than the queue's patience is an unknown outcome. */
    claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }),
    errorCode: text('error_code'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('piece_pictures_account').on(table.accountId)],
)

/** A piece's turn: its clean picture on a hanger turning a quarter-turn, made on request for credits (owner,
 * 2026-10-30). The video model's job is kept as `operation` before polling; the phone packs the video's frames
 * into `sheetKey`, laid out as `layout` says. */
export const pieceTurns = sqliteTable(
  'piece_turns',
  {
    ...pieceOwned(),
    state: text('state', {
      enum: ['requested', 'anchoring', 'generating', 'video-ready', 'ready', 'rejected', 'failed'],
    }).notNull(),
    hold: text('hold'),
    provider: text('provider'),
    model: text('model'),
    operation: text('operation', { mode: 'json' }),
    videoKey: text('video_key'),
    sheetKey: text('sheet_key'),
    layout: text('layout', { mode: 'json' }).$type<{
      readonly frames: number
      readonly columns: number
      readonly width: number
      readonly height: number
      readonly pivot: readonly [number, number]
    }>(),
    colour: real('colour'),
    print: real('print'),
    same: real('same'),
    errorCode: text('error_code'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('piece_turns_account').on(table.accountId)],
)

export const appSchema = {
  accounts,
  authAttemptBuckets,
  oauthClients,
  oauthGrants,
  oauthAssertions,
  pieces,
  uploads,
  operationReceipts,
  captures,
  captureFrames,
  detections,
  looks,
  lookPieces,
  boards,
  boardImages,
  boardItems,
  boardPins,
  wornPieces,
  piecePictures,
  pieceTurns,
}
