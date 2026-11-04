import { pieceBackPictures, piecePictures, pieceProvenance, pieces } from '@styld/db'
import { and, desc, eq, inArray, isNotNull, isNull, lt, ne, notExists, or } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { Array, Effect, Schema } from 'effect'
import { type Database as Db, query } from '../kernel/Db.ts'

type Database = Db['Service']
type NewPicture = typeof piecePictures.$inferInsert

/** What each batched statement returns: the pieces it wrote. */
const Written = Schema.Array(Schema.Array(Schema.Struct({ pieceId: Schema.String })))

/** One statement for each item, sent fifty to a batch; the pieces the statements returned. A batch's own result type
 * is lost to the generic statement, so its rows are decoded; rows of another shape are a broken invariant. */
const batchedPieces = <A>(db: Database, items: ReadonlyArray<A>, statement: (item: A) => BatchItem<'sqlite'>) =>
  Effect.map(
    Effect.forEach(Array.chunksOf(items, 50), (chunk) =>
      query((): Promise<unknown> => {
        const [head, ...rest] = Array.map(chunk, statement)
        return db.batch([head, ...rest])
      }).pipe(Effect.flatMap((rows) => Effect.orDie(Schema.decodeUnknownEffect(Written)(rows)))),
    ),
    (results) => results.flat(2).map(({ pieceId }) => pieceId),
  )

/** The drawings a run draws again. `every`, after a changed prompt: shown, dropped by the check, or failed. `ended`
 * only those that ended without a picture shown, dropped or failed (owner, 4 November: the fixed prompt and the
 * refusal fallback draw those again and leave every shown drawing alone). A retake and a piece kept as its photo were
 * the judge's call on the cut-out, not the prompt's, and stay; a picture on its way is left to its job. */
const redrawable = {
  every: ['ready', 'proposed', 'rejected', 'failed'],
  ended: ['rejected', 'failed'],
} as const
export type Redrawn = keyof typeof redrawable

/** Drawings made before a prompt changed, queued again (owner, 4 November: the pressed prompt). */
const redrawRows = (db: Database) => ({
  /** The account's ready pieces whose drawing ended `which` way before `before`, newest piece first. */
  staleDrawings: (accountId: string, before: Date, which: Redrawn) =>
    query(() =>
      db
        .select({ pieceId: piecePictures.pieceId })
        .from(piecePictures)
        .innerJoin(pieces, eq(pieces.id, piecePictures.pieceId))
        .where(
          and(
            eq(piecePictures.accountId, accountId),
            eq(pieces.status, 'ready'),
            inArray(piecePictures.state, [...redrawable[which]]),
            lt(piecePictures.updatedAt, before),
          ),
        )
        .orderBy(desc(pieces.createdAt)),
    ).pipe(Effect.map((rows) => rows.map(({ pieceId }) => pieceId))),
  /** Queue these drawings again at their turn, paid by Styld, each only while it still ended `which` way before
   * `before`, so a picture moved meanwhile keeps its own way; the pieces queued. Until the new drawing is made the
   * piece shows its cut-out, so a run queues only a minute's worth (`Backfill.ts`). */
  requeueDrawings: (
    pictures: ReadonlyArray<{ readonly pieceId: string; readonly turn: Date }>,
    before: Date,
    which: Redrawn,
  ) =>
    batchedPieces(db, pictures, ({ pieceId, turn }) =>
      db
        .update(piecePictures)
        .set({ state: 'queued', paid: false, claimedAt: null, updatedAt: turn })
        .where(
          and(
            eq(piecePictures.pieceId, pieceId),
            inArray(piecePictures.state, [...redrawable[which]]),
            lt(piecePictures.updatedAt, before),
          ),
        )
        .returning({ pieceId: piecePictures.pieceId }),
    ),
})

/** The operator's backfill of clean pictures (`Backfill.ts`): which of an account's pieces have none, adding theirs,
 * the drawings proposed before 4 November, and drawings made before a prompt changed, queued again. */
export const backfillRows = (db: Database) => ({
  /** The account's ready pieces shown as a cut-out that have no clean picture, newest first. A photo never leaves
   * Styld, so a piece kept as its photo is not among them, and a house garment the seed generated already is a clean
   * picture. */
  undrawnPieces: (accountId: string) =>
    query(() =>
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
            notExists(
              db
                .select({ id: pieceProvenance.pieceId })
                .from(pieceProvenance)
                .where(and(eq(pieceProvenance.pieceId, pieces.id), eq(pieceProvenance.origin, 'generated'))),
            ),
          ),
        )
        .orderBy(desc(pieces.createdAt)),
    ).pipe(Effect.map((rows) => rows.map(({ id }) => id))),
  /** The account's ready pieces with a photographed back that has no drawing of its own yet, newest first. */
  undrawnBacks: (accountId: string) =>
    query(() =>
      db
        .select({ id: pieces.id })
        .from(pieces)
        .leftJoin(pieceBackPictures, eq(pieceBackPictures.pieceId, pieces.id))
        .where(
          and(
            eq(pieces.accountId, accountId),
            eq(pieces.status, 'ready'),
            isNotNull(pieces.backImageKey),
            or(isNull(pieceBackPictures.pieceId), ne(pieceBackPictures.sourceKey, pieces.backImageKey)),
          ),
        )
        .orderBy(desc(pieces.createdAt)),
    ).pipe(Effect.map((rows) => rows.map(({ id }) => id))),
  /** Pictures for pieces that have none, one statement each; the pieces whose picture was added (a piece given one
   * meanwhile keeps its own). */
  addPictures: (pictures: ReadonlyArray<NewPicture>) =>
    batchedPieces(db, pictures, (picture) =>
      db.insert(piecePictures).values(picture).onConflictDoNothing().returning({ pieceId: piecePictures.pieceId }),
    ),
  /** The account's pictures still waiting for the queue since before `until`: their message may have been lost. */
  overduePictures: (accountId: string, until: Date) =>
    query(() =>
      db
        .select({ pieceId: piecePictures.pieceId })
        .from(piecePictures)
        .where(
          and(
            eq(piecePictures.accountId, accountId),
            eq(piecePictures.state, 'queued'),
            lt(piecePictures.updatedAt, until),
          ),
        ),
    ).pipe(Effect.map((rows) => rows.map(({ pieceId }) => pieceId))),
  /** Show the account's drawings proposed before 4 November, which passed the reject bar (`Policy.ts`); the pieces
   * whose drawing moved. */
  showProposed: (accountId: string, at: Date) =>
    query(() =>
      db
        .update(piecePictures)
        .set({ state: 'ready', updatedAt: at })
        .where(and(eq(piecePictures.accountId, accountId), eq(piecePictures.state, 'proposed')))
        .returning({ pieceId: piecePictures.pieceId }),
    ).pipe(Effect.map((rows) => rows.map(({ pieceId }) => pieceId))),
  ...redrawRows(db),
})
