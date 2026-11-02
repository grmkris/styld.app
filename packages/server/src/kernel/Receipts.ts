import { operationReceipts } from '@styld/db'
import { OperationConflict, Unavailable } from '@styld/protocol'
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { drizzle } from 'drizzle-orm/d1'
import { DateTime, Duration, Effect, Option } from 'effect'
import { first, nowDate, query } from './Db.ts'
import { digestOf } from './Ids.ts'

// Every idempotent write answers a repeat the same way: the account's operation id names one command and one input.
// The same command and input under that id is the same operation, answered with what it made; anything else under it
// is a conflict. The receipt is written in the same D1 batch as the operation's own rows, so it exists exactly when the
// operation happened.

type Database = ReturnType<typeof drizzle>

/** An operation an account asks for: its id, the command and the input that make it what it is. */
export interface Operation {
  readonly accountId: string
  readonly operationId: string
  readonly command: string
  readonly input: unknown
}

/** An operation with the digest a repeat is compared by. */
export interface Identified {
  readonly accountId: string
  readonly operationId: string
  readonly command: string
  readonly digest: string
}

/** The operation's identity: its command and input together, digested. */
export const identify = Effect.fnUntraced(function* (operation: Operation) {
  const digest = yield* digestOf(JSON.stringify([operation.command, operation.input]))
  return {
    accountId: operation.accountId,
    operationId: operation.operationId,
    command: operation.command,
    digest,
  } satisfies Identified
})

/** The receipt stored under an account's operation id. */
const receiptQuery = (db: Database, accountId: string, operationId: string) =>
  db
    .select()
    .from(operationReceipts)
    .where(and(eq(operationReceipts.accountId, accountId), eq(operationReceipts.operationId, operationId)))
    .limit(1)

/** The statement that forgets an operation's receipt, for the batch that undoes what the operation wrote. */
export const forgetReceipt = (db: Database, accountId: string, operationId: string) =>
  db
    .delete(operationReceipts)
    .where(and(eq(operationReceipts.accountId, accountId), eq(operationReceipts.operationId, operationId)))

/** What the operation already made, judged from the receipt stored under its id: the same command and input answer
 * its result; a different one under the same id is a conflict. */
export const priorResult = (operation: Identified, receipt: Option.Option<typeof operationReceipts.$inferSelect>) => {
  if (Option.isNone(receipt)) return Effect.succeed(Option.none<string>())
  return receipt.value.command === operation.command && receipt.value.inputDigest === operation.digest
    ? Effect.succeed(Option.some(receipt.value.result))
    : Effect.fail(OperationConflict.make({}))
}

/** The receipt row to write in the operation's batch, recording what it made. */
export const receiptRow = (operation: Identified, result: string) =>
  Effect.map(nowDate, (createdAt) => ({
    accountId: operation.accountId,
    operationId: operation.operationId,
    command: operation.command,
    inputDigest: operation.digest,
    result,
    createdAt,
  }))

const unavailable = () => Unavailable.make({})

/** A receipt answers repeats for this long; after it, the same operation id is a new operation. */
const receiptLifetime = Duration.days(30)

/** Forget receipts older than their lifetime, oldest first, a batch at a time; how many went. */
export const forgetOldReceipts = (db: Database, limit: number) =>
  Effect.gen(function* () {
    const before = DateTime.toDateUtc(DateTime.subtractDuration(yield* DateTime.now, receiptLifetime))
    const old = db
      .select({ row: sql`rowid` })
      .from(operationReceipts)
      .where(lt(operationReceipts.createdAt, before))
      .orderBy(asc(operationReceipts.createdAt))
      .limit(limit)
    const gone = yield* query(() =>
      db
        .delete(operationReceipts)
        .where(inArray(sql`rowid`, old))
        .returning({ operationId: operationReceipts.operationId }),
    )
    return gone.length
  })

/** Reading and writing receipts, for every store to spread into its own. */
export const receiptRows = (db: Database) => ({
  findReceipt: (accountId: string, operationId: string) =>
    query(() => receiptQuery(db, accountId, operationId)).pipe(Effect.map(first)),
  /** A receipt on its own, for an operation whose work is not one D1 batch. A receipt already there stays. */
  saveReceipt: (receipt: typeof operationReceipts.$inferInsert) =>
    query(() => db.insert(operationReceipts).values(receipt).onConflictDoNothing()).pipe(Effect.asVoid),
})
export type ReceiptRows = ReturnType<typeof receiptRows>

/** Recorded writes over the store's database, for a store to spread into its own. */
export const recordedWrites = (db: Database) => ({
  /** A write that is one D1 batch, done once per operation id (`recorded`). */
  recorded: <A, E, R, E2, R2>(operation: Operation, steps: RecordedSteps<A, E, R, E2, R2>) =>
    recorded(db, operation, steps),
})

/** What the operation already made, by the receipt stored under its id (`priorResult`). */
export const madeBefore = (receipts: ReceiptRows, operation: Identified) =>
  Effect.flatMap(
    receipts.findReceipt(operation.accountId, operation.operationId).pipe(Effect.mapError(unavailable)),
    (receipt) => priorResult(operation, receipt),
  )

/** A receipt as stored, for the batch of the operation it records. */
export type ReceiptRow = typeof operationReceipts.$inferSelect

/** A delete the account asks for under an operation id, of one thing (`target`, its id). */
export interface Deletion {
  readonly accountId: string
  readonly operationId: string
  readonly command: string
  readonly target: string
}

/** A delete answered once: `remove` deletes the thing and writes the receipt it is given in the same D1 batch, so a
 * repeat of the same delete answers done though what it deleted is gone, and the id used for anything else is
 * `OperationConflict`. A repeat that raced the first (both found no receipt) fails that batch on the receipt's key
 * and answers `Unavailable`, which the next repeat answers from the receipt. */
export const deleting = Effect.fnUntraced(function* <E, R>(
  receipts: ReceiptRows,
  deletion: Deletion,
  remove: (receipt: ReceiptRow) => Effect.Effect<void, E, R>,
) {
  const identified = yield* identify({ ...deletion, input: deletion.target })
  const receipt = yield* receipts
    .findReceipt(deletion.accountId, deletion.operationId)
    .pipe(Effect.mapError(unavailable))
  if (Option.isSome(yield* priorResult(identified, receipt))) return
  yield* remove(yield* receiptRow(identified, deletion.target))
})

/** A write that is D1 statements and nothing else. */
interface Recorded {
  /** The write's statements, run in one batch with the receipt. */
  readonly statements: ReadonlyArray<BatchItem<'sqlite'>>
  /** What the receipt keeps of what the write made, for `answer`. */
  readonly result: string
}

/** How a recorded write is done the first time, and how it and every repeat answer. */
export interface RecordedSteps<A, E, R, E2, R2> {
  readonly write: Effect.Effect<Recorded, E, R>
  readonly answer: (result: string) => Effect.Effect<A, E2, R2>
}

/** A write whose work is one D1 batch, done once per operation id: `write` decides the statements only while the id
 * has no receipt, and the receipt joins their batch, so it exists exactly when the write happened. The first request
 * and every repeat answer `answer(result)`; a repeat writes nothing, so it never undoes a later operation. Changed input
 * under the id is `OperationConflict`. A request that raced the first (both found no receipt) fails its batch on the
 * receipt's key and answers from the receipt the winner wrote; any other failed batch is `Unavailable`. */
export const recorded = Effect.fnUntraced(function* <A, E, R, E2, R2>(
  db: Database,
  operation: Operation,
  steps: RecordedSteps<A, E, R, E2, R2>,
) {
  const identified = yield* identify(operation)
  const stored = Effect.flatMap(
    query(() => receiptQuery(db, operation.accountId, operation.operationId)).pipe(Effect.mapError(unavailable)),
    (rows) => priorResult(identified, first(rows)),
  )
  const prior = yield* stored
  if (Option.isSome(prior)) return yield* steps.answer(prior.value)
  const { statements, result } = yield* steps.write
  const receipt = db.insert(operationReceipts).values(yield* receiptRow(identified, result))
  const committed = yield* query(() => db.batch([receipt, ...statements])).pipe(Effect.option)
  if (Option.isSome(committed)) return yield* steps.answer(result)
  const raced = yield* stored
  return yield* Option.isSome(raced) ? steps.answer(raced.value) : Effect.fail(unavailable())
})

/** An operation whose work is not one D1 batch (a fetch, an upload, a queue message, a status move): a repeat of it
 * answers from its receipt (`replay` reads what `run` made from the receipt's result). The receipt is written once the
 * work succeeded, so if that write is lost a repeat does the work once more; these operations allow that. */
export const once = <A, E, R, E2, R2>(
  receipts: ReceiptRows,
  operation: Operation,
  answer: {
    readonly replay: (result: string) => Effect.Effect<A, E2, R2>
    readonly run: Effect.Effect<readonly [A, string], E, R>
  },
) =>
  Effect.gen(function* () {
    const identified = yield* identify(operation)
    const receipt = yield* receipts
      .findReceipt(operation.accountId, operation.operationId)
      .pipe(Effect.mapError(unavailable))
    const prior = yield* priorResult(identified, receipt)
    if (Option.isSome(prior)) return yield* answer.replay(prior.value)
    const [value, result] = yield* answer.run
    yield* receipts.saveReceipt(yield* receiptRow(identified, result)).pipe(Effect.mapError(unavailable))
    return value
  })
