import { detections } from '@styld/db'
import { and, eq, type SQL } from 'drizzle-orm'
import type { Database as Db } from '../kernel/Db.ts'
import { lifecycle } from '../kernel/Lifecycle.ts'

// A garment found in a capture (`detections.status`), and the one writer of it: it waits in the review tray until the
// person keeps it (it becomes a piece) or discards it, or its back shot is folded into its front. Both moves are
// written inside the review's or the fold's batch, only from the tray, so a replay never decides a garment twice.

type Database = Db['Service']
export type DetectionState = (typeof detections.$inferSelect)['status']

/** @internal Exported for its tests. */
export const detectionLifecycle = lifecycle<DetectionState>('detection', {
  review: ['kept', 'discarded'],
  kept: [],
  discarded: [],
})

/** The state a garment is found in: waiting in the tray. */
export const foundDetectionState = 'review' as const satisfies DetectionState

/** Detections within `scope` still in the tray, decided `to`, as a statement for a batch. */
export const decideDetections = (db: Database, scope: SQL | undefined, to: 'kept' | 'discarded') =>
  db
    .update(detections)
    .set({ status: to })
    .where(and(scope, eq(detections.status, foundDetectionState)))
