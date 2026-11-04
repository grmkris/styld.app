import { operationReceipts } from '@styld/db'
import { OperationConflict, Unavailable } from '@styld/protocol'
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { drizzle } from 'drizzle-orm/d1'
import { DateTime, Duration, Effect, Exit, Option, Predicate } from 'effect'
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

/** Whether a stored receipt is the operation's own: the same command and input under its id. */
const sameOperation = (operation: Identified, receipt: typeof operationReceipts.$inferSelect) =>
  receipt.command === operation.command && receipt.inputDigest === operation.digest

/** What the operation already made, judged from the receipt stored under its id: the same command and input answer
 * its result (one still pending is being made, and is asked for again later); a different one under the same id is a
 * conflict. */
export const priorResult = (
  operation: Identified,
  receipt: Option.Option<typeof operationReceipts.$inferSelect>,
): Effect.Effect<Option.Option<string>, OperationConflict | Unavailable> => {
  if (Option.isNone(receipt)) return Effect.succeed(Option.none())
  if (!sameOperation(operation, receipt.value)) return Effect.fail(OperationConflict.make({}))
  const { result } = receipt.value
  return result === null ? Effect.fail(Unavailable.make({})) : Effect.succeed(Option.some(result))
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

/** The receipt under an account's operation id, while it is still pending. */
const pendingOf = (accountId: string, operationId: string) =>
  and(
    eq(operationReceipts.accountId, accountId),
    eq(operationReceipts.operationId, operationId),
    isNull(operationReceipts.result),
  )

/** Reading and writing receipts, for every store to spread into its own. */
export const receiptRows = (db: Database) => ({
  findReceipt: (accountId: string, operationId: string) =>
    query(() => receiptQuery(db, accountId, operationId)).pipe(Effect.map(first)),
  /** A receipt on its own, for an operation whose work is not one D1 batch. One already under the id must be the same
   * operation's, or the id is in conflict. */
  saveReceipt: Effect.fnUntraced(function* (
    receipt: ReceiptRow,
  ): Effect.fn.Return<void, OperationConflict | Unavailable> {
    const written = yield* query(() =>
      db
        .insert(operationReceipts)
        .values(receipt)
        .onConflictDoNothing()
        .returning({ operationId: operationReceipts.operationId }),
    ).pipe(Effect.mapError(unavailable))
    if (written.length > 0) return
    const stored = yield* query(() => receiptQuery(db, receipt.accountId, receipt.operationId)).pipe(
      Effect.map(first),
      Effect.mapError(unavailable),
    )
    const operation = { ...receipt, digest: receipt.inputDigest }
    if (Option.isNone(stored) || !sameOperation(operation, stored.value)) return yield* OperationConflict.make({})
  }),
  /** Claim an operation id for work about to run: a pending receipt, unless one is there; whether it was claimed. */
  claimReceipt: (receipt: ReceiptRow) =>
    query(() =>
      db
        .insert(operationReceipts)
        .values(receipt)
        .onConflictDoNothing()
        .returning({ operationId: operationReceipts.operationId }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Claim again a pending receipt whose request died, as it was seen; whether it was claimed. */
  reclaimReceipt: (receipt: ReceiptRow, seen: Date) =>
    query(() =>
      db
        .update(operationReceipts)
        .set({ createdAt: receipt.createdAt })
        .where(and(pendingOf(receipt.accountId, receipt.operationId), eq(operationReceipts.createdAt, seen)))
        .returning({ operationId: operationReceipts.operationId }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** The pending operation's result, once its work succeeded. */
  answerReceipt: (accountId: string, operationId: string, result: string) =>
    query(() =>
      db
        .update(operationReceipts)
        .set({ result })
        .where(pendingOf(accountId, operationId))
        .returning({ operationId: operationReceipts.operationId }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** The pending operation's work failed: its id is free for a repeat to run it again. */
  dropPending: (accountId: string, operationId: string) =>
    query(() => db.delete(operationReceipts).where(pendingOf(accountId, operationId))),
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

/** A delete the account asks for under an operation id, of one thing (`target`, its id) or of several (their ids,
 * in the order asked). */
export interface Deletion {
  readonly accountId: string
  readonly operationId: string
  readonly command: string
  readonly target: string | ReadonlyArray<string>
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
  const result = typeof deletion.target === 'string' ? deletion.target : deletion.target.join(' ')
  yield* remove(yield* receiptRow(identified, result))
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

/** A pending receipt older than this belongs to a request that died before it answered: every operation run by
 * `once` answers within it. */
const pendingPatience = Duration.minutes(2)

/** How a request found its operation id: claimed for it to run, or answered by what a receipt holds. */
type Found =
  | { readonly _tag: 'Claimed' }
  | { readonly _tag: 'Made'; readonly result: string }
  | { readonly _tag: 'Lost' }

/** Claim the operation id for this request, or find what holds it: the same operation's result, its request still
 * running (`Unavailable`, asked again later), a request that died before it answered (`Lost`), or another operation
 * (`OperationConflict`). */
const claimed = Effect.fnUntraced(function* (receipts: ReceiptRows, operation: Identified) {
  const pending = { ...(yield* receiptRow(operation, '')), result: null }
  if (yield* receipts.claimReceipt(pending).pipe(Effect.mapError(unavailable)))
    return { _tag: 'Claimed' } satisfies Found
  const stored = yield* receipts
    .findReceipt(operation.accountId, operation.operationId)
    .pipe(Effect.mapError(unavailable))
  if (Option.isNone(stored)) return yield* unavailable()
  if (!sameOperation(operation, stored.value)) return yield* OperationConflict.make({})
  const { result, createdAt } = stored.value
  if (result !== null) return { _tag: 'Made', result } satisfies Found
  if (pending.createdAt.getTime() - createdAt.getTime() < Duration.toMillis(pendingPatience))
    return yield* unavailable()
  return { _tag: 'Lost' } satisfies Found
})

const resumed = <A, E, R>(found: Found, resume: Effect.Effect<A, E, R> | undefined) =>
  Predicate.isTagged(found, 'Lost') && resume !== undefined
    ? Option.some(resume)
    : Option.none<Effect.Effect<A, E, R>>()

/** An operation whose work is not one D1 batch (a fetch, an upload, a queue message, a status move), answered once:
 * its id is claimed by a pending receipt before the work runs, so two requests never both run it, and a repeat
 * answers from the receipt (`replay` reads what `run` made from its result). Work that fails frees the id for a
 * repeat. A request that died while its work ran leaves its outcome unknown: `resume` answers it from where the work
 * left things (paid work, never run twice); without one the work runs again, which these operations allow. */
export const once = <A, E, R, E2, R2, E3 = never, R3 = never>(
  receipts: ReceiptRows,
  operation: Operation,
  answer: {
    readonly replay: (result: string) => Effect.Effect<A, E2, R2>
    readonly run: Effect.Effect<readonly [A, string], E, R>
    readonly resume?: Effect.Effect<A, E3, R3>
    /** Cleanup for a durable provider claim after this receipt is committed. */
    readonly after?: Effect.Effect<void, E3, R3>
  },
) =>
  Effect.gen(function* () {
    const identified = yield* identify(operation)
    const { accountId, operationId } = operation
    const found = yield* claimed(receipts, identified)
    const lost = Predicate.isTagged(found, 'Lost')
    if (Predicate.isTagged(found, 'Made')) {
      const value = yield* answer.replay(found.result)
      yield* (answer.after ?? Effect.void).pipe(Effect.ignore)
      return value
    }
    const resume = resumed(found, answer.resume)
    if (Option.isSome(resume)) return yield* resume.value
    if (lost) {
      const stored = yield* receipts.findReceipt(accountId, operationId).pipe(Effect.mapError(unavailable))
      const again = { ...(yield* receiptRow(identified, '')), result: null }
      const seen = Option.map(stored, ({ createdAt }) => createdAt)
      const reclaimed = yield* Option.match(seen, {
        onNone: () => Effect.succeed(false),
        onSome: (createdAt) => receipts.reclaimReceipt(again, createdAt).pipe(Effect.mapError(unavailable)),
      })
      if (!reclaimed) return yield* unavailable()
    }
    const exit = yield* Effect.exit(answer.run)
    if (Exit.isFailure(exit)) {
      yield* receipts.dropPending(accountId, operationId).pipe(Effect.ignore)
      return yield* Effect.failCause(exit.cause)
    }
    const [value, result] = exit.value
    // The work is done; a result that cannot be kept now leaves the receipt pending, answered by `resume` later.
    const committed = yield* receipts.answerReceipt(accountId, operationId, result).pipe(
      Effect.tapError(() => Effect.logWarning('Styld.Receipts could not keep a result')),
      Effect.option,
    )
    const kept = Option.filter(committed, (committedValue) => committedValue)
    if (Option.isSome(kept)) yield* (answer.after ?? Effect.void).pipe(Effect.ignore)
    return value
  })
