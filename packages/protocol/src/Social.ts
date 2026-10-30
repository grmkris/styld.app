import { Schema } from 'effect'
import { BoardId } from './Board.ts'
import { LookId } from './Look.ts'
import { Handle } from './Profile.ts'
import { Author, PublicBoardSummary, PublicLook, PublicPiece, PublicPin } from './Public.ts'
import { PieceId } from './Wardrobe.ts'

// What people do with each other: save what others made public, follow them, block them and report what should not
// be there. Follows are one-way and private, counts are never shown, and a block is never told.

/** What can be saved from someone else: a public piece, a shared look or a public board. */
export const SaveTarget = Schema.Union([
  Schema.TaggedStruct('SavedPiece', { pieceId: PieceId }),
  Schema.TaggedStruct('SavedLook', { lookId: LookId }),
  Schema.TaggedStruct('SavedBoard', { boardId: BoardId }),
])
export type SaveTarget = typeof SaveTarget.Type

export const SetSaved = Schema.Struct({ target: SaveTarget, saved: Schema.Boolean })
export type SetSaved = typeof SetSaved.Type

/** One thing saved from someone else, while it is still public; whose it is, and when it was saved. */
export const SavedThing = Schema.Union([
  Schema.TaggedStruct('SavedPiece', { piece: PublicPiece, by: Author, savedAt: Schema.String }),
  Schema.TaggedStruct('SavedLook', { look: PublicLook, by: Author, savedAt: Schema.String }),
  Schema.TaggedStruct('SavedBoard', { board: PublicBoardSummary, by: Author, savedAt: Schema.String }),
])
export type SavedThing = typeof SavedThing.Type

/** Saved from others, newest first. */
export const Saved = Schema.Struct({ saved: Schema.Array(SavedThing) })
export type Saved = typeof Saved.Type

/** Whether the thing is saved now. */
export const SavedState = Schema.Struct({ saved: Schema.Boolean })

export const SetFollowing = Schema.Struct({ following: Schema.Boolean })
export type SetFollowing = typeof SetFollowing.Type

export const SetBlocked = Schema.Struct({ blocked: Schema.Boolean })
export type SetBlocked = typeof SetBlocked.Type

/** Where the person stands with someone: following them, or blocking them. */
export const Relation = Schema.Struct({ handle: Handle, following: Schema.Boolean, blocked: Schema.Boolean })
export type Relation = typeof Relation.Type

/** The people the person follows, or has blocked. */
export const People = Schema.Struct({ people: Schema.Array(Author) })
export type People = typeof People.Type

/** v1's reasons for a report, in its order. */
export const ReportReason = Schema.Literals([
  'spam',
  'nudity',
  'harassment',
  'hate',
  'violence',
  'self_harm',
  'ip',
  'other',
])
export type ReportReason = typeof ReportReason.Type

/** What a report is about: a profile by its handle, or a board, look or piece. */
export const ReportTarget = Schema.Union([
  Schema.TaggedStruct('ReportedProfile', { handle: Handle }),
  Schema.TaggedStruct('ReportedBoard', { boardId: BoardId }),
  Schema.TaggedStruct('ReportedLook', { lookId: LookId }),
  Schema.TaggedStruct('ReportedPiece', { pieceId: PieceId }),
])
export type ReportTarget = typeof ReportTarget.Type

/** The most a reporter's own words may run to (v1's limit). */
export const reportNoteLength = 500

export const CreateReport = Schema.Struct({
  target: ReportTarget,
  reason: ReportReason,
  note: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(reportNoteLength))),
})
export type CreateReport = typeof CreateReport.Type

/** Reports one account may file in an hour (v1's limit). */
export const reportsPerHour = 10
/** Distinct reporters that hide what they reported, whatever the check said (v1's rule; a profile only leaves
 * discovery). */
export const reportsToHide = 3

/** Something someone the person follows did, newest first. */
export const FeedItem = Schema.Union([
  Schema.TaggedStruct('BoardWentPublic', { board: PublicBoardSummary, by: Author, at: Schema.String }),
  Schema.TaggedStruct('PinnedOnBoard', {
    pin: PublicPin,
    boardId: BoardId,
    boardName: Schema.String,
    by: Author,
    at: Schema.String,
  }),
  Schema.TaggedStruct('SharedLook', { look: PublicLook, by: Author, at: Schema.String }),
  Schema.TaggedStruct('AddedPiece', { piece: PublicPiece, by: Author, at: Schema.String }),
])
export type FeedItem = typeof FeedItem.Type

export const FeedQuery = Schema.Struct({ cursor: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))) })

/** A page of the feed, and where the next one starts. */
export const Feed = Schema.Struct({ items: Schema.Array(FeedItem), cursor: Schema.NullOr(Schema.String) })
export type Feed = typeof Feed.Type

/** One's own things cannot be saved, followed, blocked or reported. */
export class NotWithYourself extends Schema.TaggedError<NotWithYourself>()(
  'NotWithYourself',
  {},
  { httpApiStatus: 422 },
) {}

/** The account already sent this many reports within the hour. */
export class TooManyReports extends Schema.TaggedError<TooManyReports>()(
  'TooManyReports',
  {},
  { httpApiStatus: 429 },
) {}
