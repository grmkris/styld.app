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

/** Every job the piece queue runs, and what giving each up does. A deletion given up is left to the account sweep. */
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
  >
  readonly photos: Pick<Photos['Service'], 'findGarments' | 'failFinding' | 'refindGarments'>
}): JobsOf<typeof WorkMessage.Type> => ({
  ProcessPiece: {
    run: ({ pieceId }) => services.wardrobe.processPiece(pieceId),
    giveUp: ({ pieceId }) => services.wardrobe.failPiece(pieceId),
  },
  FinishDeletion: {
    run: ({ accountId }) => services.lifecycle.finishDeletion(accountId),
    // The deletion stays recorded until it is purged: the account sweep finishes what the queue gave up on.
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
  FindGarments: {
    run: ({ photoId }) => services.photos.findGarments(photoId),
    giveUp: ({ photoId }) => services.photos.failFinding(photoId),
  },
  RefindGarments: {
    run: ({ photoId, round }) => services.photos.refindGarments(photoId, round),
    // The photo keeps what it had: a re-find that never went through changes nothing.
    giveUp: () => Effect.void,
  },
})
