import {
  captureFrames,
  captures,
  detections,
  operationReceipts,
  piecePictures,
  pieces,
  pieceTurns,
  uploads,
} from '@styld/db'
import { and, desc, eq, inArray, isNull, ne, exists } from 'drizzle-orm'
import { Array, Context, Effect, Layer, Option } from 'effect'
import { insertWhen } from '../kernel/Conditional.ts'
import { matchRows } from './MatchStore.ts'
import { fileRecord } from './ProviderFiles.ts'
import { chunked, Database as Db, first, query } from '../kernel/Db.ts'
import { forgetReceipt } from '../kernel/Receipts.ts'
import { GarmentRows } from '../photos/Rows.ts'
import { PieceRows, UploadRows } from '../wardrobe/Store.ts'

export type CaptureRow = typeof captures.$inferSelect
/** A capture made from the person's own upload: every source but a garment offered from an outfit photo. */
export type UploadedCapture = CaptureRow & { readonly uploadId: string }
export type FrameRow = typeof captureFrames.$inferSelect
export type DetectionRow = typeof detections.$inferSelect
type PieceRow = typeof pieces.$inferSelect
type ReceiptRow = typeof operationReceipts.$inferSelect
export type PictureRow = typeof piecePictures.$inferSelect
export type PictureState = PictureRow['state']
type NewPicture = typeof piecePictures.$inferInsert
export type TurnRow = typeof pieceTurns.$inferSelect
export type TurnState = TurnRow['state']

type Database = Db['Service']

/** D1 binds at most 100 parameters to a statement. Rows are written one statement each, and id lists
 * go in chunks small enough to leave room for the rest of the statement. */

/** A read over many ids: one query per chunk, the rows together. */
const readIn = <A>(ids: ReadonlyArray<string>, read: (chunk: Array<string>) => Promise<ReadonlyArray<A>>) =>
  Effect.map(
    Effect.forEach(chunked(ids), (chunk) => query(() => read(chunk))),
    (rows) => rows.flat(),
  )

const finishCapture = (
  db: Database,
  capture: Pick<CaptureRow, 'id' | 'attempt'>,
  found: ReadonlyArray<DetectionRow>,
  changes: Partial<CaptureRow>,
) => {
  const current = and(
    eq(captures.id, capture.id),
    eq(captures.status, 'processing'),
    eq(captures.attempt, capture.attempt),
  )
  const owns = exists(db.select({ id: captures.id }).from(captures).where(current))
  return query(() =>
    db.batch([
      db.delete(detections).where(and(eq(detections.captureId, capture.id), eq(detections.status, 'review'), owns)),
      ...found.map((detection) => insertWhen(db, detections, detection, owns)),
      db.update(captures).set(changes).where(current).returning({ id: captures.id }),
    ]),
  ).pipe(
    Effect.map((results) => {
      const last = results.at(-1)
      return globalThis.Array.isArray(last) && last.length === 1
    }),
  )
}

const captureRows = (db: Database) => ({
  /** The capture, its uploads spent, its stills and the operation's receipt, as one atomic batch: an upload already
   * spent fails it whole (`spendUpload`). */
  createCapture: (capture: UploadedCapture, frames: ReadonlyArray<FrameRow>, receipt: ReceiptRow) =>
    query(() =>
      db.batch([
        db.insert(captures).values(capture),
        ...frames.map((frame) => db.insert(captureFrames).values(frame)),
        ...[capture.uploadId, ...frames.map(({ uploadId }) => uploadId)].map((uploadId) =>
          UploadRows.spend(db, uploadId),
        ),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.asVoid),
  /** Undo a capture whose credits could not be held: the capture (its stills with it), its receipt, and its uploads
   * received again, as one batch. */
  undoCapture: (capture: UploadedCapture, frames: ReadonlyArray<FrameRow>, operationId: string) =>
    query(() =>
      db.batch([
        db.delete(captures).where(and(eq(captures.id, capture.id), eq(captures.status, 'processing'))),
        forgetReceipt(db, capture.accountId, operationId),
        ...[capture.uploadId, ...frames.map(({ uploadId }) => uploadId)].map((uploadId) =>
          UploadRows.restore(db, uploadId),
        ),
      ]),
    ).pipe(Effect.asVoid),
  /** The keys of every detection the capture holds, whatever their state. */
  detectionKeys: (captureId: string) =>
    query(() =>
      db
        .select({ cutoutKey: detections.cutoutKey, sourceKey: detections.sourceKey })
        .from(detections)
        .where(eq(detections.captureId, captureId)),
    ),
  findCapture: (accountId: string, captureId: string) =>
    query(() =>
      db
        .select()
        .from(captures)
        .where(and(eq(captures.id, captureId), eq(captures.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  /** For the processing queue, which acts for no one in particular. */
  captureForProcessing: (captureId: string) =>
    query(() => db.select().from(captures).where(eq(captures.id, captureId)).limit(1)).pipe(Effect.map(first)),
  capturesOf: (accountId: string, captureIds: ReadonlyArray<string>) =>
    readIn(captureIds, (chunk) =>
      db
        .select()
        .from(captures)
        .where(and(eq(captures.accountId, accountId), inArray(captures.id, chunk))),
    ),
  frames: (captureId: string) =>
    query(() => db.select().from(captureFrames).where(eq(captureFrames.captureId, captureId))),
  updateCapture: (captureId: string, changes: Partial<CaptureRow>) =>
    query(() => db.update(captures).set(changes).where(eq(captures.id, captureId))).pipe(Effect.asVoid),
  /** File ownership is recorded independently of the capture, including when the account closed during upload. */
  recordFile: (capture: CaptureRow, fileId: string, at: Date) =>
    query(() => fileRecord(db, { fileId, accountId: capture.accountId, createdAt: at })).pipe(Effect.asVoid),
  handedOver: (capture: CaptureRow, fileId: string, frameCount: number) =>
    query(() =>
      db
        .update(captures)
        .set({ providerFileId: fileId, frameCount })
        .where(
          and(eq(captures.id, capture.id), eq(captures.status, 'processing'), eq(captures.attempt, capture.attempt)),
        )
        .returning({ id: captures.id }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Apply only the result of the current processing attempt. Every child write uses the same claim, which is
   * ended last in the atomic batch; a replay cannot replace detections the person already reviewed. */
  finishCapture: (
    capture: Pick<CaptureRow, 'id' | 'attempt'>,
    found: ReadonlyArray<DetectionRow>,
    changes: Partial<CaptureRow>,
  ) => finishCapture(db, capture, found, changes),
  deleteCapture: (accountId: string, captureId: string) =>
    query(() =>
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
      const open = yield* query(() =>
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
    query(() =>
      db
        .select()
        .from(detections)
        .where(and(eq(detections.id, detectionId), eq(detections.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
})

/** A back that finished after its front was kept becomes the back of the piece the front became, when that piece
 * has none yet; whether it did. Without it a person who keeps the front before the back is ready loses the back,
 * which then waits in the tray on its own (the guided camera's native journey, 3 November). */
const backOfKept = (db: Database, accountId: string, captureId: string, backKey: string) =>
  query(() =>
    db
      .update(pieces)
      .set({ backImageKey: backKey })
      .where(
        and(
          eq(pieces.accountId, accountId),
          isNull(pieces.backImageKey),
          inArray(
            pieces.detectionId,
            db
              .select({ id: detections.id })
              .from(detections)
              .where(
                and(
                  eq(detections.accountId, accountId),
                  eq(detections.captureId, captureId),
                  eq(detections.status, 'kept'),
                ),
              ),
          ),
        ),
      )
      .returning({ id: pieces.id }),
  ).pipe(Effect.map((rows) => rows.length > 0))

/** Front and back camera shots of one garment, paired once both are stored. */
const pairRows = (db: Database) => {
  /** The back shots of `frontCaptureId` in `status`: waiting in the tray, or folded into it. */
  const backsOf = (accountId: string, frontCaptureId: string, status: 'review' | 'done') =>
    query(() =>
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
    /** Give the front shot's piece its back: the open card's, or else the kept piece's (`backOfKept`); whether it did.
     * The card is the ticked one, or else the surest: a front whose only cut-out came out unticked still gets its
     * back. */
    attachBack: (accountId: string, captureId: string, backKey: string) =>
      Effect.gen(function* () {
        const front = first(
          yield* query(() =>
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
        if (Option.isNone(front)) return yield* backOfKept(db, accountId, captureId, backKey)
        const rows = yield* query(() =>
          db
            .update(detections)
            .set({ backCutoutKey: backKey })
            .where(and(eq(detections.id, front.value.id), eq(detections.status, 'review')))
            .returning({ id: detections.id }),
        )
        return rows.length > 0 || (yield* backOfKept(db, accountId, captureId, backKey))
      }),
    /** A back shot of `frontCaptureId` that finished before its front and waits in the tray on its own, with
     * its open detections. */
    waitingBack: (accountId: string, frontCaptureId: string) =>
      Effect.gen(function* () {
        const back = first(yield* backsOf(accountId, frontCaptureId, 'review'))
        if (Option.isNone(back)) return Option.none()
        const found = yield* query(() =>
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
      query(() =>
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
    query(() =>
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
  claimTracking: (capture: Pick<CaptureRow, 'id' | 'attempt'>, at: Date) =>
    query(() =>
      db
        .update(captures)
        .set({ trackingStartedAt: at })
        .where(
          and(
            eq(captures.id, capture.id),
            eq(captures.attempt, capture.attempt),
            eq(captures.status, 'processing'),
            isNull(captures.trackingStartedAt),
          ),
        )
        .returning({ id: captures.id }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Only a confirmed failure before the upload was accepted releases its claim. */
  releaseTracking: (capture: Pick<CaptureRow, 'id' | 'attempt'>) =>
    query(() =>
      db
        .update(captures)
        .set({ trackingStartedAt: null })
        .where(
          and(
            eq(captures.id, capture.id),
            eq(captures.attempt, capture.attempt),
            eq(captures.status, 'processing'),
            isNull(captures.providerFileId),
          ),
        ),
    ).pipe(Effect.asVoid),
  /** Whether any of the capture's detections became a piece. */
  hasKept: (captureId: string) =>
    query(() =>
      db
        .select({ id: detections.id })
        .from(detections)
        .where(and(eq(detections.captureId, captureId), eq(detections.status, 'kept')))
        .limit(1),
    ).pipe(Effect.map((rows) => rows.length > 0)),
})

const reviewRows = (db: Database) => ({
  /** Kept pieces, decided detections, finished captures and the receipt, as one atomic batch. */
  review: (input: {
    readonly pieces: ReadonlyArray<PieceRow>
    /** The detections kept, the pieces' own and their other sightings: a piece names its detection
     * (`pieces.detection_id`). */
    readonly kept: ReadonlyArray<string>
    readonly discarded: ReadonlyArray<string>
    /** Garments offered from outfit photos, confirmed as the pieces kept from them. */
    readonly linked: ReadonlyArray<{ readonly captureId: string; readonly pieceId: string }>
    readonly finished: ReadonlyArray<string>
    /** Clean pictures to draw for the kept pieces, queued with them. */
    readonly pictures: ReadonlyArray<NewPicture>
    readonly receipt: ReceiptRow
    readonly now: Date
  }) =>
    query(() =>
      db.batch([
        db.insert(operationReceipts).values(input.receipt),
        ...input.pieces.map((piece) => PieceRows.insert(db, piece)),
        ...input.pictures.map((picture) => db.insert(piecePictures).values(picture)),
        ...chunked(input.kept).map((chunk) =>
          db
            .update(detections)
            .set({ status: 'kept' })
            .where(and(inArray(detections.id, chunk), eq(detections.status, 'review'))),
        ),
        ...chunked(input.discarded).map((chunk) =>
          db
            .update(detections)
            .set({ status: 'discarded' })
            .where(and(inArray(detections.id, chunk), eq(detections.status, 'review'))),
        ),
        ...input.linked.map(({ captureId, pieceId }) => GarmentRows.confirm(db, captureId, pieceId)),
        ...chunked(input.finished).map((chunk) =>
          db.update(captures).set({ status: 'done', updatedAt: input.now }).where(inArray(captures.id, chunk)),
        ),
      ]),
    ).pipe(Effect.asVoid),
  /** The content type each of these stored uploads was received as: a photo's, or a video's stills. */
  uploadTypes: (accountId: string, keys: ReadonlyArray<string>) =>
    readIn(keys, (chunk) =>
      db
        .select({ objectKey: uploads.objectKey, contentType: uploads.contentType })
        .from(uploads)
        .where(and(eq(uploads.accountId, accountId), inArray(uploads.objectKey, chunk))),
    ),
  /** How many of the capture's detections still wait. */
  openDetections: (captureIds: ReadonlyArray<string>) =>
    readIn(captureIds, (chunk) =>
      db
        .select({ captureId: detections.captureId, id: detections.id })
        .from(detections)
        .where(and(inArray(detections.captureId, chunk), eq(detections.status, 'review'))),
    ),
})

/** Pieces' clean pictures. Only the picture job and the person's choice write them, and every write moves a picture
 * on only from a state it was read in, so two deliveries of one message never both draw it. */
const pictureRows = (db: Database) => ({
  findPicture: (pieceId: string) =>
    query(() => db.select().from(piecePictures).where(eq(piecePictures.pieceId, pieceId)).limit(1)).pipe(
      Effect.map(first),
    ),
  /** Move a picture on from one of `from`, with `changes`; whether it moved. */
  movePicture: (pieceId: string, from: ReadonlyArray<PictureState>, changes: Partial<PictureRow>) =>
    query(() =>
      db
        .update(piecePictures)
        .set(changes)
        .where(and(eq(piecePictures.pieceId, pieceId), inArray(piecePictures.state, [...from])))
        .returning({ pieceId: piecePictures.pieceId }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Claim a picture's next paid redraw, or take back one claimed: move it only from the state and the redraw it was
   * read in, so of two requests reading the same picture one owns the redraw and its hold; whether it moved. */
  claimRedraw: (pieceId: string, seen: Pick<PictureRow, 'state' | 'redraws'>, changes: Partial<PictureRow>) =>
    query(() =>
      db
        .update(piecePictures)
        .set(changes)
        .where(
          and(
            eq(piecePictures.pieceId, pieceId),
            eq(piecePictures.state, seen.state),
            eq(piecePictures.redraws, seen.redraws),
          ),
        )
        .returning({ pieceId: piecePictures.pieceId }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Drop a first picture the owner asked for whose credit could not be held, while it still waits as added. */
  dropPicture: (pieceId: string, redraws: number) =>
    query(() =>
      db
        .delete(piecePictures)
        .where(
          and(
            eq(piecePictures.pieceId, pieceId),
            eq(piecePictures.state, 'queued'),
            eq(piecePictures.redraws, redraws),
          ),
        ),
    ).pipe(Effect.asVoid),
  /** A picture the owner asked for, unless the piece already has one; whether it was added. */
  addPicture: (picture: NewPicture) =>
    query(() =>
      db.insert(piecePictures).values(picture).onConflictDoNothing().returning({ pieceId: piecePictures.pieceId }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
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
    query(() => db.select().from(pieceTurns).where(eq(pieceTurns.pieceId, pieceId)).limit(1)).pipe(Effect.map(first)),
  /** Move a turn on from one of `from`, with `changes`; whether it moved. */
  moveTurn: (pieceId: string, from: ReadonlyArray<TurnState>, changes: Partial<TurnRow>) =>
    query(() =>
      db
        .update(pieceTurns)
        .set(changes)
        .where(and(eq(pieceTurns.pieceId, pieceId), inArray(pieceTurns.state, [...from])))
        .returning({ pieceId: pieceTurns.pieceId }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Claim a piece's next turn, or take back one claimed: move it only from the state and the attempt it was read in,
   * so of two requests reading the same turn one owns the attempt and its hold; whether it moved. */
  claimTurn: (pieceId: string, seen: Pick<TurnRow, 'state' | 'attempt'>, changes: Partial<TurnRow>) =>
    query(() =>
      db
        .update(pieceTurns)
        .set(changes)
        .where(
          and(eq(pieceTurns.pieceId, pieceId), eq(pieceTurns.state, seen.state), eq(pieceTurns.attempt, seen.attempt)),
        )
        .returning({ pieceId: pieceTurns.pieceId }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Drop a first turn whose credits could not be held, while it still waits as added. */
  dropTurn: (pieceId: string, attempt: number) =>
    query(() =>
      db
        .delete(pieceTurns)
        .where(
          and(eq(pieceTurns.pieceId, pieceId), eq(pieceTurns.state, 'requested'), eq(pieceTurns.attempt, attempt)),
        ),
    ).pipe(Effect.asVoid),
  /** A turn the owner asked for, unless the piece already has one; whether it was added. */
  addTurn: (turn: typeof pieceTurns.$inferInsert) =>
    query(() =>
      db.insert(pieceTurns).values(turn).onConflictDoNothing().returning({ pieceId: pieceTurns.pieceId }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
})

export const makeCaptureStore = (db: Database) => ({
  ...captureRows(db),
  ...trayRows(db),
  ...pairRows(db),
  ...reviewRows(db),
  ...transitionRows(db),
  ...pictureRows(db),
  ...turnRows(db),
  ...matchRows(db),
})

/** Captures' rows over the application's one database: captures, their detections and frames, pieces' clean pictures
 * and turns. */
export class CaptureStore extends Context.Service<CaptureStore, ReturnType<typeof makeCaptureStore>>()(
  '@styld/server/capture/CaptureStore',
) {
  static readonly layer = Layer.effect(this, Effect.map(Db, makeCaptureStore))
}
