import { captureFrames, captures, detections, operationReceipts, pieces, uploads } from '@styld/db'
import { and, desc, eq, inArray, ne, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Option } from 'effect'
import { StoreUnavailable } from '../wardrobe/Store.ts'

export type CaptureRow = typeof captures.$inferSelect
export type FrameRow = typeof captureFrames.$inferSelect
export type DetectionRow = typeof detections.$inferSelect
type PieceRow = typeof pieces.$inferSelect
type ReceiptRow = typeof operationReceipts.$inferSelect

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => StoreUnavailable.make({}) })
const first = <A>(rows: ReadonlyArray<A>) => Option.fromNullishOr(rows[0])

type Database = ReturnType<typeof drizzle>

const captureRows = (db: Database) => ({
  /** The capture, its uploads spent, its stills and the operation's receipt, as one atomic batch. */
  createCapture: (capture: CaptureRow, frames: ReadonlyArray<FrameRow>, receipt: ReceiptRow) =>
    attempt(() =>
      db.batch([
        db.insert(captures).values(capture),
        db
          .update(uploads)
          .set({ status: 'used' })
          .where(inArray(uploads.id, [capture.uploadId, ...frames.map(({ uploadId }) => uploadId)])),
        ...(frames.length === 0 ? [] : [db.insert(captureFrames).values([...frames])]),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.asVoid),
  findCapture: (accountId: string, captureId: string) =>
    attempt(() =>
      db
        .select()
        .from(captures)
        .where(and(eq(captures.id, captureId), eq(captures.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  /** For the processing queue, which acts for no one in particular. */
  captureForProcessing: (captureId: string) =>
    attempt(() => db.select().from(captures).where(eq(captures.id, captureId)).limit(1)).pipe(Effect.map(first)),
  capturesOf: (accountId: string, captureIds: ReadonlyArray<string>) =>
    captureIds.length === 0
      ? Effect.succeed([])
      : attempt(() =>
          db
            .select()
            .from(captures)
            .where(and(eq(captures.accountId, accountId), inArray(captures.id, [...captureIds]))),
        ),
  frames: (captureId: string) =>
    attempt(() => db.select().from(captureFrames).where(eq(captureFrames.captureId, captureId))),
  updateCapture: (captureId: string, changes: Partial<CaptureRow>) =>
    attempt(() => db.update(captures).set(changes).where(eq(captures.id, captureId))).pipe(Effect.asVoid),
  /** The capture's detections and its new status, together. Detections from an earlier attempt are
   * replaced, so a retried capture never shows a piece twice. */
  finishCapture: (captureId: string, found: ReadonlyArray<DetectionRow>, changes: Partial<CaptureRow>) =>
    attempt(() =>
      db.batch([
        db.delete(detections).where(and(eq(detections.captureId, captureId), eq(detections.status, 'review'))),
        ...(found.length === 0 ? [] : [db.insert(detections).values([...found])]),
        db.update(captures).set(changes).where(eq(captures.id, captureId)),
      ]),
    ).pipe(Effect.asVoid),
  deleteCapture: (accountId: string, captureId: string) =>
    attempt(() =>
      db
        .delete(captures)
        .where(and(eq(captures.id, captureId), eq(captures.accountId, accountId)))
        .returning(),
    ).pipe(Effect.map(first)),
  /** Whether any piece still shows this stored photo. */
  sourceInUse: (accountId: string, key: string) =>
    attempt(() =>
      db
        .select({ id: pieces.id })
        .from(pieces)
        .where(and(eq(pieces.accountId, accountId), or(eq(pieces.originalKey, key), eq(pieces.imageKey, key))))
        .limit(1),
    ).pipe(Effect.map((rows) => rows.length > 0)),
})

/** What the review tray reads: open captures and the detections waiting in them. */
const trayRows = (db: Database) => ({
  /** Captures still waiting for the person (not `done`), newest first, with their open detections. */
  tray: (accountId: string) =>
    Effect.gen(function* () {
      const open = yield* attempt(() =>
        db
          .select()
          .from(captures)
          .where(and(eq(captures.accountId, accountId), ne(captures.status, 'done')))
          .orderBy(desc(captures.createdAt))
          .limit(200),
      )
      const found =
        open.length === 0
          ? []
          : yield* attempt(() =>
              db
                .select()
                .from(detections)
                .where(
                  and(
                    eq(detections.accountId, accountId),
                    eq(detections.status, 'review'),
                    inArray(
                      detections.captureId,
                      open.map(({ id }) => id),
                    ),
                  ),
                ),
            )
      return { captures: open, detections: found }
    }),
  detections: (accountId: string, ids: ReadonlyArray<string>) =>
    ids.length === 0
      ? Effect.succeed([])
      : attempt(() =>
          db
            .select()
            .from(detections)
            .where(and(eq(detections.accountId, accountId), inArray(detections.id, [...ids]))),
        ),
  findDetection: (accountId: string, detectionId: string) =>
    attempt(() =>
      db
        .select()
        .from(detections)
        .where(and(eq(detections.id, detectionId), eq(detections.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  /** The front detection a back shot pairs with, if it is still open. */
  attachBack: (accountId: string, captureId: string, backKey: string) =>
    attempt(() =>
      db
        .update(detections)
        .set({ backCutoutKey: backKey })
        .where(
          and(
            eq(detections.accountId, accountId),
            eq(detections.captureId, captureId),
            eq(detections.status, 'review'),
            eq(detections.preselected, true),
          ),
        ),
    ).pipe(Effect.asVoid),
})

const reviewRows = (db: Database) => ({
  /** Kept pieces, decided detections, finished captures and the receipt, as one atomic batch. */
  review: (input: {
    readonly pieces: ReadonlyArray<PieceRow>
    readonly kept: ReadonlyArray<{ readonly detectionId: string; readonly pieceId: string }>
    readonly discarded: ReadonlyArray<string>
    readonly finished: ReadonlyArray<string>
    readonly receipt: ReceiptRow
    readonly now: Date
  }) =>
    attempt(() =>
      db.batch([
        db.insert(operationReceipts).values(input.receipt),
        ...(input.pieces.length === 0 ? [] : [db.insert(pieces).values([...input.pieces])]),
        ...input.kept.map(({ detectionId, pieceId }) =>
          db
            .update(detections)
            .set({ status: 'kept', pieceId })
            .where(and(eq(detections.id, detectionId), eq(detections.status, 'review'))),
        ),
        ...(input.discarded.length === 0
          ? []
          : [
              db
                .update(detections)
                .set({ status: 'discarded' })
                .where(and(inArray(detections.id, [...input.discarded]), eq(detections.status, 'review'))),
            ]),
        ...(input.finished.length === 0
          ? []
          : [
              db
                .update(captures)
                .set({ status: 'done', updatedAt: input.now })
                .where(inArray(captures.id, [...input.finished])),
            ]),
      ]),
    ).pipe(Effect.asVoid),
  /** How many of the capture's detections still wait. */
  openDetections: (captureIds: ReadonlyArray<string>) =>
    captureIds.length === 0
      ? Effect.succeed([])
      : attempt(() =>
          db
            .select({ captureId: detections.captureId, id: detections.id })
            .from(detections)
            .where(and(inArray(detections.captureId, [...captureIds]), eq(detections.status, 'review'))),
        ),
})

/** Captures and their detections in D1. Reads and writes for a person name their account; the queue's
 * reads name only the capture it was handed. */
export const makeCaptureStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  return { ...captureRows(db), ...trayRows(db), ...reviewRows(db) }
}

export type CaptureStore = ReturnType<typeof makeCaptureStore>
