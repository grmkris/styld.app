import { Schema } from 'effect'
import { BoardId, BoardImageId, BoardItem, Paper, PinId } from './Board.ts'
import { LookId } from './Look.ts'
import { Handle, Tone } from './Profile.ts'
import { Category, Colours, PieceId, Subcategory } from './Wardrobe.ts'

// What other people see: published profiles, public boards, shared looks and the pieces they show, each only while
// Styld's check lets others see it. Nothing here carries notes, sources, original photos or check results.

/** Whose public thing it is. */
export const Author = Schema.Struct({ handle: Handle, name: Schema.String, tone: Tone })
export type Author = typeof Author.Type

/** A piece as others see it: what it is, never its notes. Its picture is `/cdn/public/pieces/:id/:size`. */
export const PublicPiece = Schema.Struct({
  id: PieceId,
  name: Schema.NullOr(Schema.String),
  category: Category,
  subcategory: Schema.NullOr(Subcategory),
  colours: Colours,
})
export type PublicPiece = typeof PublicPiece.Type

/** A shared look, with those of its pieces others may see. */
export const PublicLook = Schema.Struct({
  id: LookId,
  name: Schema.String,
  occasion: Schema.NullOr(Schema.String),
  pieces: Schema.Array(PublicPiece),
  sharedAt: Schema.String,
})
export type PublicLook = typeof PublicLook.Type

export const PublicPiecePin = Schema.TaggedStruct('PublicPiecePin', {
  id: PinId,
  piece: PublicPiece,
  addedAt: Schema.String,
})
/** A picture on a public board; its bytes are `/cdn/public/pictures/:imageId/:size`. */
export const PublicPicturePin = Schema.TaggedStruct('PublicPicturePin', {
  id: PinId,
  imageId: BoardImageId,
  addedAt: Schema.String,
})
export const PublicLookPin = Schema.TaggedStruct('PublicLookPin', {
  id: PinId,
  look: PublicLook,
  addedAt: Schema.String,
})
export const PublicPin = Schema.Union([PublicPiecePin, PublicPicturePin, PublicLookPin])
export type PublicPin = typeof PublicPin.Type

/** A public board as others see it: the pins they may see, and its table with only those of them. */
export const PublicBoard = Schema.Struct({
  id: BoardId,
  name: Schema.String,
  paper: Paper,
  items: Schema.Array(BoardItem),
  pins: Schema.Array(PublicPin),
  by: Author,
  publishedAt: Schema.String,
})
export type PublicBoard = typeof PublicBoard.Type

/** A public board in a profile's list: its table, its newest pins and how many others may see. */
export const PublicBoardSummary = Schema.Struct({
  id: BoardId,
  name: Schema.String,
  paper: Paper,
  items: Schema.Array(BoardItem),
  cover: Schema.Array(PublicPin),
  pinCount: Schema.Int,
  publishedAt: Schema.String,
})
export type PublicBoardSummary = typeof PublicBoardSummary.Type

/** A published profile: its public boards, its shared looks and, when its owner shows it, the wardrobe. */
export const PublicProfile = Schema.Struct({
  handle: Handle,
  name: Schema.String,
  city: Schema.NullOr(Schema.String),
  bio: Schema.NullOr(Schema.String),
  tone: Tone,
  boards: Schema.Array(PublicBoardSummary),
  looks: Schema.Array(PublicLook),
  /** Null when the owner keeps the wardrobe off the profile. */
  pieces: Schema.NullOr(Schema.Array(PublicPiece)),
})
export type PublicProfile = typeof PublicProfile.Type

/** A shared look on its own page. */
export const PublicLookPage = Schema.Struct({ look: PublicLook, by: Author })
export type PublicLookPage = typeof PublicLookPage.Type

/** A public piece on its own page. */
export const PublicPiecePage = Schema.Struct({ piece: PublicPiece, by: Author })
export type PublicPiecePage = typeof PublicPiecePage.Type

/** What a link preview shows of a public page, in the reader's language; `image` is a `/cdn/public` path. */
export const PageMeta = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  image: Schema.NullOr(Schema.String),
})
export type PageMeta = typeof PageMeta.Type

/** The page a preview is for: `/@handle`, `/boards/:id`, `/looks/:id` or `/pieces/:id`. */
export const PageMetaQuery = Schema.Struct({ path: Schema.String.check(Schema.isMaxLength(200)) })

/** Nothing public here: missing, private, unpublished, or held back by Styld's check, alike. */
export class PublicNotFound extends Schema.TaggedError<PublicNotFound>()(
  'PublicNotFound',
  {},
  { httpApiStatus: 404 },
) {}

/** Too many public reads from one network in a minute. */
export class PublicSlowDown extends Schema.TaggedError<PublicSlowDown>()(
  'PublicSlowDown',
  {},
  { httpApiStatus: 429 },
) {}
