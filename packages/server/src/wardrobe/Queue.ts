import { Effect, Option } from 'effect'
import type { AccountLifecycle } from '../AccountLifecycle.ts'
import type { Captures } from '../capture/Service.ts'
import { defineQueue, type JobsOf } from '../jobs/Jobs.ts'
import type { Photos } from '../photos/Photos.ts'
import { pieceAttempts, WorkMessage } from './Processing.ts'
import type { Wardrobe } from './Wardrobe.ts'

/** The piece queue: three tries for each job before it shows as failed, its credits back. */
export const pieceJobQueue = defineQueue({
  name: 'pieces',
  body: WorkMessage,
  attempts: pieceAttempts,
  batchSize: 10,
  retryDelay: '10 seconds',
  // A piece's work keeps the queue's own message id.
  jobOf: () => Option.none(),
})

/** Every job the piece queue runs, and what giving each up does. A deletion is only tried again. */
export const pieceJobs = (services: {
  readonly wardrobe: Pick<Wardrobe['Service'], 'processPiece' | 'failPiece'>
  readonly lifecycle: Pick<AccountLifecycle['Service'], 'finishDeletion'>
  readonly captures: Pick<
    Captures['Service'],
    | 'processCapture'
    | 'failCapture'
    | 'processPicture'
    | 'failPicture'
    | 'processTurn'
    | 'failTurn'
    | 'processMatch'
    | 'failMatch'
    | 'suggestPiece'
    | 'failSuggestion'
  >
  readonly photos: Pick<Photos['Service'], 'findGarments' | 'failFinding'>
}): JobsOf<typeof WorkMessage.Type> => ({
  ProcessPiece: {
    run: ({ pieceId }, attempt) => services.wardrobe.processPiece(pieceId, attempt),
    giveUp: ({ pieceId }) => services.wardrobe.failPiece(pieceId),
  },
  FinishDeletion: {
    run: ({ accountId }) => services.lifecycle.finishDeletion(accountId),
    giveUp: () => Effect.void,
  },
  ProcessCapture: {
    run: ({ captureId }) => services.captures.processCapture(captureId),
    giveUp: ({ captureId }) => services.captures.failCapture(captureId),
  },
  DrawPicture: {
    run: ({ pieceId }) => services.captures.processPicture(pieceId),
    giveUp: ({ pieceId }) => services.captures.failPicture(pieceId),
  },
  MakeTurn: {
    run: ({ pieceId }) => services.captures.processTurn(pieceId),
    giveUp: ({ pieceId }) => services.captures.failTurn(pieceId),
  },
  MatchCapture: {
    run: ({ captureId }) => services.captures.processMatch(captureId),
    giveUp: ({ captureId }) => services.captures.failMatch(captureId),
  },
  SuggestPiece: {
    run: ({ pieceId }) => services.captures.suggestPiece(pieceId),
    giveUp: ({ pieceId }) => services.captures.failSuggestion(pieceId),
  },
  FindGarments: {
    run: ({ photoId }) => services.photos.findGarments(photoId),
    giveUp: ({ photoId }) => services.photos.failFinding(photoId),
  },
})
