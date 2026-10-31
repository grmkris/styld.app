import { SessionHttp } from '@styld/auth/config'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { RequestRefused } from './Account.ts'
import { BoardId, BoardImageId, BoardNotFound } from './Board.ts'
import { CaptureUnavailable, DailyLimitReached } from './Capture.ts'
import { CheckReason } from './Check.ts'
import { OperationConflict, OperationId } from './Wardrobe.ts'

// Pictures Styld makes for a board (Boards, profiles and social, M7): one from a sentence, or a mood board of two to
// four with matching pieces. Each picture costs a credit from the daily allowance, is marked Generated, and is checked
// like any other picture before others see it.

export const GenerationId = Schema.String.check(Schema.isPattern(/^gj_[A-Za-z0-9_-]{22}$/)).pipe(
  Schema.brand('GenerationId'),
)
export type GenerationId = typeof GenerationId.Type

/** The most pictures one mood board makes, and the fewest worth making. */
export const mostMoodPictures = 4
export const fewestMoodPictures = 2

/** What the person asks for, in their own words. */
export const Generate = Schema.Struct({
  operationId: OperationId,
  prompt: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(280)),
})
export type Generate = typeof Generate.Type

export const GenerationKind = Schema.Literals(['picture', 'moodBoard'])
export type GenerationKind = typeof GenerationKind.Type

/** How far Styld got: planning the mood board, drawing, laying out the collage, done; or stopped. */
export const GenerationStatus = Schema.Literals(['planning', 'drawing', 'arranging', 'done', 'refused', 'failed'])
export type GenerationStatus = typeof GenerationStatus.Type

/** Why a generation stopped short: the plan found nothing it could make, the image model refused every picture, or
 * the work could not finish. */
export const GenerationReason = Schema.Literals(['unclear', 'refused', 'unavailable'])
export type GenerationReason = typeof GenerationReason.Type

/** One picture's outcome: still to come, on its board, refused (its credit given back), or lost on the way (its credit
 * kept, since the model may have drawn it). */
export const GeneratedPicture = Schema.Struct({
  index: Schema.Int,
  status: Schema.Literals(['waiting', 'drawing', 'drawn', 'refused', 'unknown']),
  imageId: Schema.NullOr(BoardImageId),
})
export type GeneratedPicture = typeof GeneratedPicture.Type

export const Generation = Schema.Struct({
  id: GenerationId,
  boardId: BoardId,
  kind: GenerationKind,
  status: GenerationStatus,
  reason: Schema.NullOr(GenerationReason),
  pictures: Schema.Array(GeneratedPicture),
  createdAt: Schema.String,
})
export type Generation = typeof Generation.Type

/** The words asked for something Styld does not make. */
export class PromptRefused extends Schema.TaggedError<PromptRefused>()(
  'PromptRefused',
  { reason: CheckReason },
  { httpApiStatus: 422 },
) {}

export class GenerationNotFound extends Schema.TaggedError<GenerationNotFound>()(
  'GenerationNotFound',
  {},
  { httpApiStatus: 404 },
) {}

/** Too many asked for in a minute. */
export class GenerateSlowDown extends Schema.TaggedError<GenerateSlowDown>()(
  'GenerateSlowDown',
  {},
  { httpApiStatus: 429 },
) {}

const generateErrors = [
  BoardNotFound,
  PromptRefused,
  DailyLimitReached,
  GenerateSlowDown,
  OperationConflict,
  CaptureUnavailable,
  RequestRefused,
]

export class GenerationApi extends HttpApiGroup.make('generation')
  .add(
    HttpApiEndpoint.post('generatePicture', '/boards/:boardId/generated', {
      params: { boardId: BoardId },
      payload: Generate,
      success: Generation,
      error: generateErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post('makeMoodBoard', '/boards/:boardId/mood', {
      params: { boardId: BoardId },
      payload: Generate,
      success: Generation,
      error: generateErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get('generation', '/generations/:generationId', {
      params: { generationId: GenerationId },
      success: Generation,
      error: [GenerationNotFound, CaptureUnavailable],
    }),
  )
  .middleware(SessionHttp.RequireSession)
  .prefix('/api') {}
