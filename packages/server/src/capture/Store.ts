import {
  captureFrames,
  captures,
  detections,
  operationReceipts,
  piecePictures,
  pieceTurns,
  pieces,
  uploads,
} from '@styld/db'
import { and, desc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Array, Effect, Option } from 'effect'
import { StoreUnavailable } from '../wardrobe/Store.ts'

export type CaptureRow = typeof captures.$inferSelect
export type FrameRow = typeof captureFrames.$inferSelect
export type DetectionRow = typeof detections.$inferSelect
type PieceRow = typeof pieces.$inferSelect
type ReceiptRow = typeof operationReceipts.$inferSelect
export type PictureRow = typeof piecePictures.$inferSelect
export type PictureState = PictureRow['state']
type NewPicture = typeof piecePictures.$inferInsert
export type TurnRow = typeof pieceTurns.$inferSelect
export type TurnState = TurnRow['state']

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
   * replaced, so a retried capture never shows a piece twice; a capture no longer processing keeps its
   * status. */
  finishCapture: (captureId: string, found: ReadonlyArray<DetectionRow>, changes: Partial<CaptureRow>) =>
    attempt(() =>
      db.batch([
        db.delete(detections).where(and(eq(detections.captureId, captureId), eq(detections.status, 'review'))),
        ...found.map((detection) => db.insert(detections).values(detection)),
        db
          .update(captures)
          .set(changes)
          .where(and(eq(captures.id, captureId), eq(captures.status, 'processing'))),
      ]),
    ).pipe(Effect.asVoid),
  deleteCapture: (accountId: string, captureId: string) =>
    attempt(() =>
      db
        .delete(captures)
        .where(and(eq(captures.id, captureId), eq(captures.accountId, accountId)))
        .returning(),
    ).pipe(Effect.map(first)),
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
})

/** Front and back camera shots of one garment, paired once both are stored. */
const pairRows = (db: Database) => {
  /** The back shots of `frontCaptureId` in `status`: waiting in the tray, or folded into it. */
  const backsOf = (accountId: string, frontCaptureId: string, status: 'review' | 'done') =>
    attempt(() =>
      db
        .select()
        .from(captures)
        .where(
          and(
            eq(captures.accountId, accountId),
            eq(captures.pairsWith, frontCaptureId),
            eq(captures.side, 'back'),
            eq(captures.status, status),
          ),
        ),
    )
  return {
    /** Give the front shot's piece its back, if it is still open; whether it was. The piece is the ticked one,
     * or else the surest: a front whose only cut-out came out unticked still gets its back. */
    attachBack: (accountId: string, captureId: string, backKey: string) =>
      Effect.gen(function* () {
        const front = first(
          yield* attempt(() =>
            db
              .select({ id: detections.id })
              .from(detections)
              .where(
                and(
                  eq(detections.accountId, accountId),
                  eq(detections.captureId, captureId),
                  eq(detections.status, 'review'),
                ),
              )
              .orderBy(desc(detections.preselected), desc(detections.confidence))
              .limit(1),
          ),
        )
        if (Option.isNone(front)) return false
        const rows = yield* attempt(() =>
          db
            .update(detections)
            .set({ backCutoutKey: backKey })
            .where(and(eq(detections.id, front.value.id), eq(detections.status, 'review')))
            .returning({ id: detections.id }),
        )
        return rows.length > 0
      }),
    /** A back shot of `frontCaptureId` that finished before its front and waits in the tray on its own, with
     * its open detections. */
    waitingBack: (accountId: string, frontCaptureId: string) =>
      Effect.gen(function* () {
        const back = first(yield* backsOf(accountId, frontCaptureId, 'review'))
        if (Option.isNone(back)) return Option.none()
        const found = yield* attempt(() =>
          db
            .select()
            .from(detections)
            .where(and(eq(detections.captureId, back.value.id), eq(detections.status, 'review'))),
        )
        return Option.some({ capture: back.value, detections: found })
      }),
    /** The back shots folded into `frontCaptureId`, which leave with it. */
    foldedBacks: (accountId: string, frontCaptureId: string) => backsOf(accountId, frontCaptureId, 'done'),
    /** A back shot folded into its front: its own detections leave the tray and the capture is done. */
    foldBack: (captureId: string, updatedAt: Date) =>
      attempt(() =>
        db.batch([
          db
            .update(detections)
            .set({ status: 'discarded' })
            .where(and(eq(detections.captureId, captureId), eq(detections.status, 'review'))),
          db
            .update(captures)
            .set({ status: 'done', updatedAt })
            .where(and(eq(captures.id, captureId), eq(captures.status, 'review'))),
        ]),
      ).pipe(Effect.asVoid),
  }
}

/** Moving a capture between states only from the state it was read in, so two requests or two queue
 * deliveries never both act on it. Each answers whether it moved the capture. */
const transitionRows = (db: Database) => ({
  /** Move a capture the person asked to try again, if it is still as they saw it. */
  retryCapture: (
    accountId: string,
    captureId: string,
    seen: { readonly status: CaptureRow['status']; readonly attempt: number; readonly updatedAt: Date },
    changes: Partial<CaptureRow>,
  ) =>
    attempt(() =>
      db
        .update(captures)
        .set(changes)
        .where(
          and(
            eq(captures.id, captureId),
            eq(captures.accountId, accountId),
            eq(captures.status, seen.status),
            eq(captures.attempt, seen.attempt),
            eq(captures.updatedAt, seen.updatedAt),
          ),
        )
        .returning({ id: captures.id }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Mark a video as handed to Meta, unless a delivery already did. */
  claimTracking: (captureId: string, at: Date) =>
    attempt(() =>
      db
        .update(captures)
        .set({ trackingStartedAt: at })
        .where(and(eq(captures.id, captureId), eq(captures.status, 'processing'), isNull(captures.trackingStartedAt)))
        .returning({ id: captures.id }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Whether any of the capture's detections became a piece. */
  hasKept: (captureId: string) =>
    attempt(() =>
      db
        .select({ id: detections.id })
        .from(detections)
        .where(and(eq(detections.captureId, captureId), eq(detections.status, 'kept')))
        .limit(1),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Which of these stored objects a piece of the account still shows, as its photo, image or back. */
  keysInUse: (accountId: string, keys: ReadonlyArray<string>) =>
    Effect.map(
      // Each key is bound three times, so a chunk holds 30 of them.
      Effect.forEach(Array.chunksOf(keys, 30), (chunk) =>
        attempt(() =>
          db
            .select({ originalKey: pieces.originalKey, imageKey: pieces.imageKey, backImageKey: pieces.backImageKey })
            .from(pieces)
            .where(
              and(
                eq(pieces.accountId, accountId),
                or(
                  inArray(pieces.originalKey, [...chunk]),
                  inArray(pieces.imageKey, [...chunk]),
                  inArray(pieces.backImageKey, [...chunk]),
                ),
              ),
            ),
        ),
      ),
      (rows) => new Set(rows.flat().flatMap((row) => [row.originalKey, row.imageKey, row.backImageKey])),
    ),
})

const reviewRows = (db: Database) => ({
  /** Kept pieces, decided detections, finished captures and the receipt, as one atomic batch. */
  review: (input: {
    readonly pieces: ReadonlyArray<PieceRow>
    readonly kept: ReadonlyArray<{ readonly detectionId: string; readonly pieceId: string }>
    readonly discarded: ReadonlyArray<string>
    readonly finished: ReadonlyArray<string>
    /** Clean pictures to draw for the kept pieces, queued with them. */
    readonly pictures: ReadonlyArray<NewPicture>
    readonly receipt: ReceiptRow
    readonly now: Date
  }) =>
    attempt(() =>
      db.batch([
        db.insert(operationReceipts).values(input.receipt),
        ...input.pieces.map((piece) => db.insert(pieces).values(piece)),
        ...input.pictures.map((picture) => db.insert(piecePictures).values(picture)),
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
/** Pieces' clean pictures. Only the picture job and the person's choice write them, and every write moves a picture
 * on only from a state it was read in, so two deliveries of one message never both draw it. */
const pictureRows = (db: Database) => ({
  findPicture: (pieceId: string) =>
    attempt(() => db.select().from(piecePictures).where(eq(piecePictures.pieceId, pieceId)).limit(1)).pipe(
      Effect.map(first),
    ),
  /** Move a picture on from one of `from`, with `changes`; whether it moved. */
  movePicture: (pieceId: string, from: ReadonlyArray<PictureState>, changes: Partial<PictureRow>) =>
    attempt(() =>
      db
        .update(piecePictures)
        .set(changes)
        .where(and(eq(piecePictures.pieceId, pieceId), inArray(piecePictures.state, [...from])))
        .returning({ pieceId: piecePictures.pieceId }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** A picture the owner asked for, unless the piece already has one; whether it was added. */
  addPicture: (picture: NewPicture) =>
    attempt(() =>
      db.insert(piecePictures).values(picture).onConflictDoNothing().returning({ pieceId: piecePictures.pieceId }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Queue pictures for pieces that have none, leaving any a concurrent request added. */
  addPictures: (pictures: ReadonlyArray<NewPicture>) => {
    const [head, ...rest] = pictures.map((picture) => db.insert(piecePictures).values(picture).onConflictDoNothing())
    return head === undefined ? Effect.void : attempt(() => db.batch([head, ...rest])).pipe(Effect.asVoid)
  },
  /** The account's kept cut-outs no drawing was ever asked for. A piece kept as its photo is not one. */
  undrawnPieces: (accountId: string) =>
    attempt(() =>
      db
        .select({ id: pieces.id })
        .from(pieces)
        .leftJoin(piecePictures, eq(piecePictures.pieceId, pieces.id))
        .where(
          and(
            eq(pieces.accountId, accountId),
            eq(pieces.status, 'ready'),
            isNotNull(pieces.imageKey),
            ne(pieces.imageKey, pieces.originalKey),
            isNull(piecePictures.pieceId),
          ),
        ),
    ).pipe(Effect.map((rows) => rows.map(({ id }) => id))),
  /** The account's pictures still waiting for the queue. */
  queuedPicturesOf: (accountId: string) =>
    attempt(() =>
      db
        .select({ pieceId: piecePictures.pieceId })
        .from(piecePictures)
        .where(and(eq(piecePictures.accountId, accountId), eq(piecePictures.state, 'queued'))),
    ).pipe(Effect.map((rows) => rows.map(({ pieceId }) => pieceId))),
  /** The pieces among `pieceIds` whose picture still waits for the queue. */
  waitingPictures: (pieceIds: ReadonlyArray<string>) =>
    readIn(pieceIds, (chunk) =>
      db
        .select({ pieceId: piecePictures.pieceId })
        .from(piecePictures)
        .where(and(inArray(piecePictures.pieceId, chunk), eq(piecePictures.state, 'queued'))),
    ).pipe(Effect.map((rows) => rows.map(({ pieceId }) => pieceId))),
})

/** Pieces' turns. Only the turn job and the owner's request write them, each move from the state it was read in. */
const turnRows = (db: Database) => ({
  findTurn: (pieceId: string) =>
    attempt(() => db.select().from(pieceTurns).where(eq(pieceTurns.pieceId, pieceId)).limit(1)).pipe(Effect.map(first)),
  /** Move a turn on from one of `from`, with `changes`; whether it moved. */
  moveTurn: (pieceId: string, from: ReadonlyArray<TurnState>, changes: Partial<TurnRow>) =>
    attempt(() =>
      db
        .update(pieceTurns)
        .set(changes)
        .where(and(eq(pieceTurns.pieceId, pieceId), inArray(pieceTurns.state, [...from])))
        .returning({ pieceId: pieceTurns.pieceId }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** A turn the owner asked for, unless the piece already has one; whether it was added. */
  addTurn: (turn: typeof pieceTurns.$inferInsert) =>
    attempt(() =>
      db.insert(pieceTurns).values(turn).onConflictDoNothing().returning({ pieceId: pieceTurns.pieceId }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
})

export const makeCaptureStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  return {
    ...captureRows(db),
    ...trayRows(db),
    ...pairRows(db),
    ...reviewRows(db),
    ...transitionRows(db),
    ...pictureRows(db),
    ...turnRows(db),
  }
}

export type CaptureStore = ReturnType<typeof makeCaptureStore>
