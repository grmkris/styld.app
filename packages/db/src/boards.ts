import { BoardTemplate, OutfitLayout, OutfitMode, Paper, Season, TextStyle, Visibility } from '@styld/protocol'
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
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { jsonArray, oneOf } from './checks.ts'
import { accounts } from './identity.ts'
import { looks } from './looks.ts'
import { pieces } from './wardrobe.ts'

// Boards: a table the person lays their pieces, labels and pictures on, and the pins its grid shows.

/** A board. `version` counts saves of the table, so an editor that loaded an older table cannot overwrite a newer
 * one. */
export const boards = sqliteTable(
  'boards',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    paper: text('paper', { enum: Paper.literals }).notNull(),
    version: integer('version').notNull(),
    /** Private boards are the owner's; a public one is on their profile once its check lets it. */
    visibility: text('visibility', { enum: Visibility.literals }).notNull(),
    /** Up to three moods from the fixed list, for Explore (read with `json_each`). */
    moods: text('moods', { mode: 'json' }).notNull().$type<ReadonlyArray<string>>(),
    /** When the board last went public: the feed and Explore sort by it. */
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    /** When an admin featured it in Explore. */
    featuredAt: integer('featured_at', { mode: 'timestamp_ms' }),
    /** The name, folded the way search folds what people type. */
    searchText: text('search_text').notNull(),
    /** What the board was started from (T-10), none for a blank one. Read through the protocol's schema: a CHECK
     * added to this table would make drizzle rebuild it, which D1 cascades into its children. */
    template: text('template', { enum: BoardTemplate.literals }),
    /** The piece a template board was built around; it stays when the piece goes, without it. */
    anchorPieceId: text('anchor_piece_id').references(() => pieces.id, { onDelete: 'set null' }),
    /** How a template board lays its outfits out (Eva, 4 November 2026); none on a blank board, and on a template board
     * made before layouts, which reads as six flanking. Read through the protocol's schema, without a CHECK, as
     * `template` is. */
    layout: text('layout', { enum: OutfitLayout.literals }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('boards_account_updated').on(table.accountId, table.updatedAt),
    index('boards_public').on(table.visibility, table.publishedAt),
    oneOf('boards_paper', table.paper, Paper.literals),
    oneOf('boards_visibility', table.visibility, Visibility.literals),
    jsonArray('boards_moods', table.moods),
  ],
)

/** A row of an account's board: its own id, and the account and board it goes with. */
export const boardOwned = () => ({
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  boardId: text('board_id')
    .notNull()
    .references(() => boards.id, { onDelete: 'cascade' }),
})

const imageOrigins = ['upload', 'generated', 'photo'] as const

/** A picture put on a board. Its bytes stay where the photo upload left them, under the account's prefix. */
export const boardImages = sqliteTable(
  'board_images',
  {
    ...boardOwned(),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    /** A photo the person or an assistant put there, a picture Styld generated (marked Generated), or one of the
     * person's outfit photos from My Gallery, which visitors never see. */
    origin: text('origin', { enum: imageOrigins }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('board_images_board').on(table.boardId), oneOf('board_images_origin', table.origin, imageOrigins)],
)

const itemKinds = ['piece', 'text', 'image'] as const

/** What lies on a board's table: one of the person's pieces, a text label or a picture, and where; each kind uses its
 * one column. Deleting a piece takes it off its boards. */
export const boardItems = sqliteTable(
  'board_items',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    kind: text('kind', { enum: itemKinds }).notNull(),
    pieceId: text('piece_id').references(() => pieces.id, { onDelete: 'cascade' }),
    imageId: text('image_id').references(() => boardImages.id, { onDelete: 'cascade' }),
    text: text('text'),
    textStyle: text('text_style', { enum: TextStyle.literals }),
    x: real('x').notNull(),
    y: real('y').notNull(),
    size: real('size').notNull(),
    turn: real('turn').notNull(),
    z: integer('z').notNull(),
    flipped: integer('flipped', { mode: 'boolean' }).notNull(),
    /** The outfit of a template board this item shows (T-10), so another outfit replaces exactly its cluster. */
    outfitId: text('outfit_id').references((): AnySQLiteColumn => boardOutfits.id, { onDelete: 'set null' }),
  },
  (table) => [
    primaryKey({ columns: [table.boardId, table.id] }),
    index('board_items_piece').on(table.pieceId),
    index('board_items_image').on(table.imageId),
    oneOf('board_items_kind', table.kind, itemKinds),
    oneOf('board_items_text_style', table.textStyle, TextStyle.literals),
    check(
      'board_items_target',
      sql`(${table.kind} = 'piece') = (${table.pieceId} IS NOT NULL) AND (${table.kind} = 'image') = (${table.imageId} IS NOT NULL) AND (${table.kind} = 'text') = (${table.text} IS NOT NULL AND ${table.textStyle} IS NOT NULL)`,
    ),
  ],
)

const pinKinds = ['piece', 'picture', 'look'] as const

/** What is pinned on a board: a piece, a look or a picture put on it. The board's grid shows its pins, newest
 * first; its table places some of them. A piece or look is pinned once per board, and deleting it unpins it. */
export const boardPins = sqliteTable(
  'board_pins',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: pinKinds }).notNull(),
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
    oneOf('board_pins_kind', table.kind, pinKinds),
    check(
      'board_pins_target',
      sql`(${table.kind} = 'piece') = (${table.pieceId} IS NOT NULL) AND (${table.kind} = 'picture') = (${table.imageId} IS NOT NULL) AND (${table.kind} = 'look') = (${table.lookId} IS NOT NULL)`,
    ),
  ],
)

/** An outfit of a template board (T-10): one of the complete outfits made around its anchor, in its place on the board,
 * the run and way that made it and for which season, and the look it became when the person kept it. */
export const boardOutfits = sqliteTable(
  'board_outfits',
  {
    ...boardOwned(),
    position: integer('position').notNull(),
    mode: text('mode', { enum: OutfitMode.literals }).notNull(),
    session: text('session').notNull(),
    /** The season it was made for, if one was asked: another outfit in its place keeps to it. */
    season: text('season', { enum: Season.literals }),
    lookId: text('look_id').references(() => looks.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('board_outfits_board_position').on(table.boardId, table.position),
    index('board_outfits_look').on(table.lookId),
    oneOf('board_outfits_mode', table.mode, OutfitMode.literals),
    oneOf('board_outfits_season', table.season, Season.literals),
  ],
)

/** The pieces of a board's outfit, in wearing order. Deleting a piece takes it out of the outfit. */
export const boardOutfitPieces = sqliteTable(
  'board_outfit_pieces',
  {
    outfitId: text('outfit_id')
      .notNull()
      .references(() => boardOutfits.id, { onDelete: 'cascade' }),
    pieceId: text('piece_id')
      .notNull()
      .references(() => pieces.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.outfitId, table.pieceId] }),
    index('board_outfit_pieces_piece').on(table.pieceId),
  ],
)
