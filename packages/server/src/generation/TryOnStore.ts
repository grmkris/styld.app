import { operationReceipts, tryOnPieces, tryOns } from '@styld/db'
import { and, asc, desc, eq, inArray, isNull, lt, notExists } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { receiptRows, type ReceiptRow } from '../kernel/Receipts.ts'
import { Database, fenced, first, query } from '../kernel/Db.ts'

export type TryOnRow = typeof tryOns.$inferSelect
type Drizzle = Database['Service']

/** The statuses of a try-on not yet ended. */
const running = ['admitting', 'drawing'] as const

/** The most try-ons a list reads, newest first. */
const listed = 200

/** Try-ons as their owner writes and reads them: written once with their pieces and receipt, listed, deleted. */
const ownerQueries = (db: Drizzle) => ({
  ...receiptRows(db),
  /** The try-on, its pieces in order and the operation's receipt, as one batch. */
  insertTryOn: (row: TryOnRow, pieceIds: ReadonlyArray<string>, receipt: ReceiptRow) =>
    fenced(() =>
      db.batch([
        db.insert(tryOns).values(row),
        ...pieceIds.map((pieceId, position) => db.insert(tryOnPieces).values({ tryOnId: row.id, position, pieceId })),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.asVoid),
  /** A try-on whose admission failed never became queue work: remove it and free its operation id for a retry. */
  undoTryOn: (row: Pick<TryOnRow, 'id' | 'accountId'>, operationId: string) =>
    query(() =>
      db.batch([
        db.delete(tryOns).where(and(eq(tryOns.id, row.id), inArray(tryOns.status, ['failed', 'refused']))),
        db
          .delete(operationReceipts)
          .where(
            and(
              eq(operationReceipts.accountId, row.accountId),
              eq(operationReceipts.operationId, operationId),
              eq(operationReceipts.result, row.id),
              notExists(db.select({ id: tryOns.id }).from(tryOns).where(eq(tryOns.id, row.id))),
            ),
          ),
      ]),
    ).pipe(Effect.asVoid),
  findTryOn: (accountId: string, tryOnId: string) =>
    query(() =>
      db
        .select()
        .from(tryOns)
        .where(and(eq(tryOns.id, tryOnId), eq(tryOns.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  listTryOns: (accountId: string) =>
    query(() =>
      db
        .select()
        .from(tryOns)
        .where(eq(tryOns.accountId, accountId))
        .orderBy(desc(tryOns.createdAt), desc(tryOns.id))
        .limit(listed),
    ),
  /** The pieces each try-on still wears, in the order chosen. */
  piecesOf: (tryOnIds: ReadonlyArray<string>) =>
    tryOnIds.length === 0
      ? Effect.succeed([])
      : query(() =>
          db
            .select()
            .from(tryOnPieces)
            .where(inArray(tryOnPieces.tryOnId, [...tryOnIds]))
            .orderBy(asc(tryOnPieces.tryOnId), asc(tryOnPieces.position)),
        ),
})

/** Try-ons as the queue moves them: only on from the status they were read in, so a try-on given up stays given up and
 * two deliveries never draw it twice. */
const workQueries = (db: Drizzle) => ({
  /** For the queue, which acts for the try-on's account. */
  tryOnForWork: (tryOnId: string) =>
    query(() => db.select().from(tryOns).where(eq(tryOns.id, tryOnId)).limit(1)).pipe(Effect.map(first)),
  /** Move the try-on on only from a status it is still at. */
  advance: (tryOnId: string, from: ReadonlyArray<TryOnRow['status']>, change: Partial<TryOnRow>) =>
    query(() =>
      db
        .update(tryOns)
        .set(change)
        .where(and(eq(tryOns.id, tryOnId), inArray(tryOns.status, [...from])))
        .returning({ id: tryOns.id }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Claim the drawing of a try-on still drawing that nobody claimed; false when another delivery claimed it first,
   * or it was given up. */
  claim: (tryOnId: string, at: Date) =>
    query(() =>
      db
        .update(tryOns)
        .set({ startedAt: at, updatedAt: at })
        .where(and(eq(tryOns.id, tryOnId), eq(tryOns.status, 'drawing'), isNull(tryOns.startedAt)))
        .returning({ id: tryOns.id }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Try-ons not ended and not touched since `before`: their messages were lost or their deliveries died. */
  stalledTryOns: (before: Date, limit: number) =>
    query(() =>
      db
        .select({ id: tryOns.id })
        .from(tryOns)
        .where(and(inArray(tryOns.status, [...running]), lt(tryOns.updatedAt, before)))
        .orderBy(asc(tryOns.updatedAt))
        .limit(limit),
    ).pipe(Effect.map((rows) => rows.map(({ id }) => id))),
  /** Delete the account's try-on and write the receipt of the delete, as one batch; its pieces go with it. The try-on
   * as it was, or none when it was not the account's. */
  deleteTryOn: (accountId: string, tryOnId: string, receipt: ReceiptRow) =>
    fenced(() =>
      db.batch([
        db
          .delete(tryOns)
          .where(and(eq(tryOns.id, tryOnId), eq(tryOns.accountId, accountId)))
          .returning(),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.map(([deleted]) => first(deleted))),
})

/** Try-ons over the application's database. */
const tryOnStore = (db: Drizzle) => ({ ...ownerQueries(db), ...workQueries(db) })

/** The try-on store over the application's one database. */
export class TryOnStore extends Context.Service<TryOnStore, ReturnType<typeof tryOnStore>>()(
  '@styld/server/generation/TryOnStore',
) {
  static readonly layer = Layer.effect(this, Effect.map(Database, tryOnStore))
}
