import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { BoardId, BoardName, LabelText, OutfitLayout, Paper, TextStyle } from './Board.ts'
import { BoardBuild, BoardTag } from './BoardTags.ts'
import { CheckState, Visibility } from './Check.ts'
import { byCase, NotFound, OperationConflict, refusal, Unavailable } from './Errors.ts'
import { PieceType, Season } from './Garment.ts'
import { OperationId } from './Ids.ts'
import { Mood } from './Mood.ts'
import { OperatorAuth } from './Operator.ts'
import { Bio, Handle, ProfileName } from './Profile.ts'
import { ManifestId, PieceOrigin } from './Provenance.ts'
import { ReviewState } from './Translations.ts'
import { PieceId, PieceStatus } from './Wardrobe.ts'

// The house inspiration boards (owner, 4 November 2026), seeded by the operator's seed (`tools/seed/`) into the two
// house accounts, by their emails. Their pieces come first, imported as house garments the seed generated; then each
// house profile; then each board, built by the app's own board services as the house account, with its tags and its
// Slovenian, and kept by its catalogue id for good (`seeded_boards`). Only the operator may call these; to anyone else
// they are not there.

const email = Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(320))

/** A catalogue entry's id, such as `w-lisbon-5d`. */
export const SeedId = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u), Schema.isMaxLength(64))
export type SeedId = typeof SeedId.Type

/** What a seed step did: made it, changed it to the catalogue's entry, or found it as the entry says. */
export const SeedOutcome = Schema.Literals(['created', 'updated', 'unchanged'])
export type SeedOutcome = typeof SeedOutcome.Type

/** A house profile, in English and Slovenian: `PUT /api/operator/seed/profile`. */
export const SeedProfile = Schema.Struct({
  operationId: OperationId,
  email,
  handle: Handle,
  name: ProfileName,
  bio: Bio,
  sl: Schema.Struct({ name: ProfileName, bio: Bio, review: ReviewState }),
})
export type SeedProfile = typeof SeedProfile.Type

export const SeededProfile = Schema.Struct({
  accountId: Schema.String,
  outcome: SeedOutcome,
  check: Schema.NullOr(CheckState),
})
export type SeededProfile = typeof SeededProfile.Type

/** A text on a seeded board's table, with its Slovenian. */
export const SeedLabel = Schema.Struct({ text: LabelText, style: TextStyle, sl: LabelText })
export type SeedLabel = typeof SeedLabel.Type

/** A board as the catalogue says it: what it is built as from which garments (by manifest id), its paper, moods,
 * table texts and tags, and its name in Slovenian. A one-piece board names its anchor and layout; a board of outfits
 * how many and for which season. */
export const SeedBoard = Schema.Struct({
  name: BoardName,
  build: BoardBuild,
  paper: Paper,
  moods: Schema.Array(Mood).check(Schema.isMaxLength(3), Schema.isUnique()),
  labels: Schema.Array(SeedLabel).check(Schema.isMaxLength(4)),
  pieces: Schema.Array(ManifestId).check(Schema.isMinLength(1), Schema.isMaxLength(40), Schema.isUnique()),
  anchor: Schema.optionalKey(ManifestId),
  layout: Schema.optionalKey(OutfitLayout),
  outfits: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 }))),
  season: Schema.optionalKey(Season),
  tags: Schema.Array(BoardTag).check(Schema.isMaxLength(20)),
  sl: Schema.Struct({ name: BoardName, review: ReviewState }),
})
export type SeedBoard = typeof SeedBoard.Type

/** Seed one board: `POST /api/operator/seed/boards/:seedId`. `version` is the catalogue entry's. */
export const SeedBoardRequest = Schema.Struct({
  operationId: OperationId,
  email,
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  board: SeedBoard,
})
export type SeedBoardRequest = typeof SeedBoardRequest.Type

/** A seeded board as it stands: whether others may see it and what its check says. */
export const SeedBoardStatus = Schema.Struct({
  seedId: SeedId,
  boardId: BoardId,
  version: Schema.Int,
  visibility: Visibility,
  check: Schema.NullOr(CheckState),
})
export type SeedBoardStatus = typeof SeedBoardStatus.Type

export const SeededBoard = Schema.Struct({ ...SeedBoardStatus.fields, outcome: SeedOutcome })
export type SeededBoard = typeof SeededBoard.Type

/** Remove a seeded board: `DELETE /api/operator/seed/boards/:seedId`. */
export const RemoveSeededBoard = Schema.Struct({ operationId: OperationId, email })
export type RemoveSeededBoard = typeof RemoveSeededBoard.Type

/** A house garment as it stands in its account: its piece, how processing went, whether it was cut out, where its
 * picture came from, and what Clef read from it on import. */
export const SeedPiece = Schema.Struct({
  manifestId: ManifestId,
  pieceId: PieceId,
  status: PieceStatus,
  cutOut: Schema.Boolean,
  type: PieceType,
  origin: Schema.NullOr(PieceOrigin),
  describedType: Schema.NullOr(PieceType),
  describedWhole: Schema.NullOr(Schema.Number),
})
export type SeedPiece = typeof SeedPiece.Type

export const SeedPieces = Schema.Struct({ accountId: Schema.String, pieces: Schema.Array(SeedPiece) })
export type SeedPieces = typeof SeedPieces.Type

const SeedRefusal = Schema.Literals(['notHouse', 'piecesMissing', 'noOutfits', 'badEntry'])

/** Why a seed step was refused: the email is not a house account's, a garment it names is not imported (or not ready),
 * the board's pieces make fewer outfits than it asks, or the entry contradicts itself. `detail` names the ids. */
export class SeedRefused extends Schema.TaggedError<SeedRefused>()(
  'SeedRefused',
  { reason: SeedRefusal, detail: Schema.Array(Schema.String) },
  {
    httpApiStatus: 422,
    guide: byCase<typeof SeedRefusal.Type>('reason', {
      notHouse: refusal('not_house', 'That email is not a house account’s.', 'Seed only the configured house emails.'),
      piecesMissing: refusal(
        'pieces_missing',
        'Some of the board’s garments are not imported and ready.',
        'Import them first (detail).',
      ),
      noOutfits: refusal(
        'no_outfits',
        'The board’s pieces make fewer outfits than it asks for.',
        'Change the catalogue entry.',
      ),
      badEntry: refusal('bad_entry', 'The catalogue entry contradicts itself.', 'Fix the entry (detail).'),
    }),
  },
) {}

/** The house boards, for the operator. */
export class SeedApi extends HttpApiGroup.make('seed')
  .add(
    HttpApiEndpoint.put('seedProfile', '/operator/seed/profile', {
      payload: SeedProfile,
      success: SeededProfile,
      error: [NotFound, OperationConflict, SeedRefused, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('seedBoard', '/operator/seed/boards/:seedId', {
      params: { seedId: SeedId },
      payload: SeedBoardRequest,
      success: SeededBoard,
      error: [NotFound, OperationConflict, SeedRefused, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('seededBoard', '/operator/seed/boards/:seedId', {
      params: { seedId: SeedId },
      query: { email },
      success: SeedBoardStatus,
      error: [NotFound, OperationConflict, SeedRefused, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.delete('removeSeededBoard', '/operator/seed/boards/:seedId', {
      params: { seedId: SeedId },
      payload: RemoveSeededBoard,
      success: HttpApiSchema.NoContent,
      error: [NotFound, OperationConflict, SeedRefused, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('seedPieces', '/operator/seed/pieces', {
      query: { email },
      success: SeedPieces,
      error: [NotFound, OperationConflict, SeedRefused, Unavailable],
    }),
  )
  .middleware(OperatorAuth) {}
