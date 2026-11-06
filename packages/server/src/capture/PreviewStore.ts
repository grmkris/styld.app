import { piecePictures } from '@styld/db'
import { inArray } from 'drizzle-orm'
import { Effect } from 'effect'
import { chunked, type Database as Db, query } from '../kernel/Db.ts'
import { owedMedia } from '../kernel/MediaDeletions.ts'
import { forgetChecks } from '../safety/Checks.ts'
import { owedPieceOf, PieceRows, type PieceRow } from '../wardrobe/Store.ts'

type Database = Db['Service']
type NewPicture = typeof piecePictures.$inferInsert

const readIn = <A>(ids: ReadonlyArray<string>, read: (chunk: Array<string>) => Promise<ReadonlyArray<A>>) =>
  Effect.map(
    Effect.forEach(chunked(ids), (chunk) => query(() => read(chunk))),
    (rows) => rows.flat(),
  )

/** Statements that drop early tray pieces and owe their prefixes a delete. */
export const draftDeletes = (db: Database, accountId: string, rows: ReadonlyArray<PieceRow>, at: Date) => [
  ...owedMedia(db).owe(
    rows.map(({ id }) => owedPieceOf(accountId, id)),
    at,
  ),
  ...chunked(rows.map(({ id }) => id)).flatMap((chunk) => [
    PieceRows.remove(db, accountId, chunk),
    forgetChecks(db, accountId, 'piece', chunk),
  ]),
]

const forgetListed = (db: Database, accountId: string, rows: ReadonlyArray<PieceRow>, at: Date) => {
  const [head, ...rest] = draftDeletes(db, accountId, rows, at)
  if (head === undefined) return Effect.void
  return query(() => db.batch([head, ...rest])).pipe(Effect.asVoid)
}

/** Early pieces written for detections the tray would offer ticked, hidden from the wardrobe until review. */
export const previewRows = (db: Database) => ({
  /** The account's pieces made from these detections, including ones still waiting in the tray. */
  piecesByDetections: (accountId: string, detectionIds: ReadonlyArray<string>) =>
    readIn(detectionIds, (chunk) => PieceRows.listedByDetections(db, accountId, chunk)),
  /** The pictures of these pieces, whatever their state. */
  picturesAmong: (pieceIds: ReadonlyArray<string>) =>
    readIn(pieceIds, (chunk) => db.select().from(piecePictures).where(inArray(piecePictures.pieceId, chunk))),
  /** Store pieces and queued pictures for detections the tray would offer ticked; an existing row is left as it is. */
  addPreviews: (input: { readonly pieces: ReadonlyArray<PieceRow>; readonly pictures: ReadonlyArray<NewPicture> }) =>
    Effect.gen(function* () {
      const [head, ...rest] = input.pieces
      if (head === undefined) return
      yield* query(() =>
        db.batch([
          PieceRows.insertIfNew(db, head),
          ...rest.map((piece) => PieceRows.insertIfNew(db, piece)),
          ...input.pictures.map((picture) => db.insert(piecePictures).values(picture).onConflictDoNothing()),
        ]),
      )
    }),
  /** Drop early pieces of detections the tray would no longer offer ticked, or of a capture being removed. */
  forgetDrafts: (accountId: string, detectionIds: ReadonlyArray<string>, at: Date) =>
    Effect.gen(function* () {
      const rows = yield* readIn(detectionIds, (chunk) => PieceRows.listedByDetections(db, accountId, chunk))
      if (rows.length === 0) return
      yield* forgetListed(db, accountId, rows, at)
    }),
  forgetDraftsOfCapture: (accountId: string, captureId: string, at: Date) =>
    Effect.gen(function* () {
      const rows = yield* query(() => PieceRows.listedOfCapture(db, accountId, captureId))
      if (rows.length === 0) return
      yield* forgetListed(db, accountId, rows, at)
    }),
})
