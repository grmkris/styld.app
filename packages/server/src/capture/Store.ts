import { captureFrames, captures, detections, operationReceipts, pieces, uploads } from '@styld/db'
import { and, desc, eq, inArray, ne, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Array, Effect, Option } from 'effect'
import { StoreUnavailable } from '../wardrobe/Store.ts'

export type CaptureRow = typeof captures.$inferSelect
export type FrameRow = typeof captureFrames.$inferSelect
export type DetectionRow = typeof detections.$inferSelect
type PieceRow = typeof pieces.$inferSelect
type ReceiptRow = typeof operationReceipts.$inferSelect

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => StoreUnavailable.make({}) })
const first = <A>(rows: ReadonlyArray<A>) => Option.fromNullishOr(rows[0])

type Database = ReturnType<typeof drizzle>

/** D1 binds at most 100 parameters to a statement. Rows are written one statement each, and id lists
 * go in chunks small enough to leave room for the rest of the statement. */
const chunked = (ids: ReadonlyArray<string>) => Array.chunksOf(ids, 90).map((chunk) => [...chunk])

/** A read over many ids: one query per chunk, the rows together. */
const readIn = <A>(ids: ReadonlyArray<string>, query: (chunk: Array<string>) => Promise<ReadonlyArray<A>>) =>
  Effect.map(
    Effect.forEach(chunked(ids), (chunk) => attempt(() => query(chunk))),
    (rows) => rows.flat(),
  )

const captureRows = (db: Database) => ({
  /** The capture, its uploads spent, its stills and the operation's receipt, as one atomic batch. */
  createCapture: (capture: CaptureRow, frames: ReadonlyArray<FrameRow>, receipt: ReceiptRow) =>
    attempt(() =>
      db.batch([
        db.insert(captures).values(capture),
        ...chunked([capture.uploadId, ...frames.map(({ uploadId }) => uploadId)]).map((chunk) =>
          db.update(uploads).set({ status: 'used' }).where(inArray(uploads.id, chunk)),
        ),
        ...frames.map((frame) => db.insert(captureFrames).values(frame)),
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
    readIn(captureIds, (chunk) =>
      db
        .select()
        .from(captures)
        .where(and(eq(captures.accountId, accountId), inArray(captures.id, chunk))),
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
        ...found.map((detection) => db.insert(detections).values(detection)),
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
      const found = yield* readIn(
        open.map(({ id }) => id),
        (chunk) =>
          db
            .select()
            .from(detections)
            .where(
              and(
                eq(detections.accountId, accountId),
                eq(detections.status, 'review'),
                inArray(detections.captureId, chunk),
              ),
            ),
      )
      return { captures: open, detections: found }
    }),
  detections: (accountId: string, ids: ReadonlyArray<string>) =>
    readIn(ids, (chunk) =>
      db
        .select()
        .from(detections)
        .where(and(eq(detections.accountId, accountId), inArray(detections.id, chunk))),
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
        ...input.pieces.map((piece) => db.insert(pieces).values(piece)),
        ...input.kept.map(({ detectionId, pieceId }) =>
          db
            .update(detections)
            .set({ status: 'kept', pieceId })
            .where(and(eq(detections.id, detectionId), eq(detections.status, 'review'))),
        ),
        ...chunked(input.discarded).map((chunk) =>
          db
            .update(detections)
            .set({ status: 'discarded' })
            .where(and(inArray(detections.id, chunk), eq(detections.status, 'review'))),
        ),
        ...chunked(input.finished).map((chunk) =>
          db.update(captures).set({ status: 'done', updatedAt: input.now }).where(inArray(captures.id, chunk)),
        ),
      ]),
    ).pipe(Effect.asVoid),
  /** How many of the capture's detections still wait. */
  openDetections: (captureIds: ReadonlyArray<string>) =>
    readIn(captureIds, (chunk) =>
      db
        .select({ captureId: detections.captureId, id: detections.id })
        .from(detections)
        .where(and(inArray(detections.captureId, chunk), eq(detections.status, 'review'))),
    ),
})

/** Captures and their detections in D1. Reads and writes for a person name their account; the queue's
 * reads name only the capture it was handed. */
export const makeCaptureStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  return { ...captureRows(db), ...trayRows(db), ...reviewRows(db) }
}

export type CaptureStore = ReturnType<typeof makeCaptureStore>
