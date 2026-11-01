import { textLength } from './Text.ts'
import { entityId, OperationId } from './Ids.ts'
import { LimitReached, NotFound, OperationConflict, refusal, SlowDown, Unavailable } from './Errors.ts'
import { SessionHttp } from '@styld/auth/config'
import { SessionAccount } from './Session.ts'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { BoardId, BoardImageId } from './Board.ts'
import { CheckReason } from './Check.ts'

// What Styld makes for a board (owner, 2026-10-31): a small decorative sticker from the person's words, with a
// transparent background, or a mood board of the person's own pieces from one sentence. Each costs a credit from the
// daily allowance. A sticker is marked Generated and checked like any other picture before others see it.

export const GenerationId = entityId('gj').pipe(Schema.brand('GenerationId'))
export type GenerationId = typeof GenerationId.Type

/** What the person asks for, in their own words. */
export const Generate = Schema.Struct({
  operationId: OperationId,
  prompt: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(textLength.prompt)),
})
export type Generate = typeof Generate.Type

export const GenerationKind = Schema.Literals(['sticker', 'moodBoard'])
export type GenerationKind = typeof GenerationKind.Type

/** How far Styld got: planning the mood board, drawing the sticker, laying out the collage, done; or stopped. */
export const GenerationStatus = Schema.Literals(['planning', 'drawing', 'arranging', 'done', 'refused', 'failed'])
export type GenerationStatus = typeof GenerationStatus.Type

/** Why a generation stopped short: the plan found too little in the wardrobe for the words, the image model refused
 * the sticker, or the work could not finish. */
export const GenerationReason = Schema.Literals(['unclear', 'refused', 'unavailable'])
export type GenerationReason = typeof GenerationReason.Type

/** A sticker's outcome: still to come, on its board, refused or lost on the way (its credit given back either way). */
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

/** The board's ask still being made, if there is one: a board opened again picks up following it. */
export const RunningGeneration = Schema.Struct({ generation: Schema.NullOr(Generation) })
export type RunningGeneration = typeof RunningGeneration.Type

/** The words asked for something Styld does not make. */
export class PromptRefused extends Schema.TaggedError<PromptRefused>()(
  'PromptRefused',
  { reason: CheckReason },
  {
    httpApiStatus: 422,
    guide: refusal('prompt_refused', 'Styld does not make that ({reason}).', 'Ask the person for other words.'),
  },
) {}

const generateErrors = [NotFound, PromptRefused, LimitReached, SlowDown, OperationConflict, Unavailable]

export class GenerationApi extends HttpApiGroup.make('generation')
  .add(
    HttpApiEndpoint.post('makeSticker', '/boards/:boardId/stickers', {
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
      error: [NotFound, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('runningGeneration', '/boards/:boardId/generations/running', {
      params: { boardId: BoardId },
      success: RunningGeneration,
      error: Unavailable,
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}
