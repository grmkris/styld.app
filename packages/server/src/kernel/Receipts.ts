import { operationReceipts } from '@styld/db'
import { OperationConflict, Unavailable } from '@styld/protocol'
import { and, eq } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { Effect, Option } from 'effect'
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
export const receiptQuery = (db: Database, accountId: string, operationId: string) =>
  db
    .select()
    .from(operationReceipts)
    .where(and(eq(operationReceipts.accountId, accountId), eq(operationReceipts.operationId, operationId)))
    .limit(1)

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

/** Reading and writing receipts, for every store to spread into its own. */
export const receiptRows = (db: Database) => ({
  findReceipt: (accountId: string, operationId: string) =>
    query(() => receiptQuery(db, accountId, operationId)).pipe(Effect.map(first)),
  /** A receipt on its own, for an operation whose work is not one D1 batch. A receipt already there stays. */
  saveReceipt: (receipt: typeof operationReceipts.$inferInsert) =>
    query(() => db.insert(operationReceipts).values(receipt).onConflictDoNothing()).pipe(Effect.asVoid),
})
export type ReceiptRows = ReturnType<typeof receiptRows>

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
