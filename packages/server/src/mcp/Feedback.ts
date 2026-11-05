import { assistantFeedback } from '@styld/db'
import {
  CurrentAccount,
  type FeedbackId,
  type FeedbackStatus,
  LimitReached,
  maximumFeedbackPerDay,
  NotFound,
  type SendFeedback,
} from '@styld/protocol'
import { and, desc, eq, lt, sql, sum } from 'drizzle-orm'
import { Context, DateTime, Duration, Effect, Layer } from 'effect'
import { Database, nowDate, query, stored } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'

// What assistants tell Styld about Styld (owner, 4 November 2026, after v1's send_feedback): a note a day is one row
// whose repeats are counted, at most 30 a day per account, kept 180 days. Only admins read them and mark them handled;
// the words are the assistant's, data for the admin and never instructions.

/** How long a note is kept. */
const kept = Duration.days(180)

/** The most notes an admin reads at once, newest first. */
const listed = 100

type Db = Database['Service']

const run = <A>(effect: () => Promise<A>) => query(effect).pipe(stored)

/** Keep a note for the admins: the same note again today counts once more; past today's thirty, refused. */
const send = Effect.fn('Styld.Feedback.send')(function* (db: Db, input: SendFeedback) {
  const { accountId } = yield* CurrentAccount
  const at = yield* nowDate
  const day = at.toISOString().slice(0, 10)
  const [today] = yield* run(() =>
    db
      .select({ sent: sum(assistantFeedback.count) })
      .from(assistantFeedback)
      .where(and(eq(assistantFeedback.accountId, accountId), eq(assistantFeedback.day, day))),
  )
  if (Number(today?.sent ?? 0) >= maximumFeedbackPerDay) return yield* LimitReached.make({ limit: 'feedback' })
  const id = yield* newId('fb')
  const row = { id, accountId, kind: input.kind, message: input.message, tool: input.tool ?? null, day }
  yield* run(() =>
    db
      .insert(assistantFeedback)
      .values({ ...row, count: 1, status: 'open', createdAt: at, updatedAt: at })
      .onConflictDoUpdate({
        target: [assistantFeedback.accountId, assistantFeedback.day, assistantFeedback.kind, assistantFeedback.message],
        set: { count: sql`${assistantFeedback.count} + 1`, status: 'open', updatedAt: at },
      }),
  )
  return { sent: true }
})

/** The notes in one state, the most recently sent first, for an admin. */
const list = Effect.fn('Styld.Feedback.list')(function* (db: Db, status: FeedbackStatus) {
  const rows = yield* run(() =>
    db
      .select()
      .from(assistantFeedback)
      .where(eq(assistantFeedback.status, status))
      .orderBy(desc(assistantFeedback.updatedAt))
      .limit(listed),
  )
  return rows.map(({ id, accountId, kind, message, tool, day, count, status: state }) => ({
    id,
    accountId,
    kind,
    message,
    tool,
    day,
    count,
    status: state,
  }))
})

/** Mark a note handled, or open it again. */
const setStatus = Effect.fn('Styld.Feedback.setStatus')(function* (db: Db, id: FeedbackId, status: FeedbackStatus) {
  const at = yield* nowDate
  const changed = yield* run(() =>
    db
      .update(assistantFeedback)
      .set({ status, updatedAt: at })
      .where(eq(assistantFeedback.id, id))
      .returning({ id: assistantFeedback.id }),
  )
  if (changed.length === 0) return yield* NotFound.make({})
  return { id, status }
})

/** The schedule's sweep: notes older than 180 days go. */
const sweep = Effect.fn('Styld.Feedback.sweep')(function* (db: Db) {
  const before = DateTime.toDateUtc(DateTime.subtractDuration(yield* DateTime.now, kept))
  const gone = yield* run(() =>
    db.delete(assistantFeedback).where(lt(assistantFeedback.createdAt, before)).returning({ id: assistantFeedback.id }),
  )
  return gone.length
})

const make = Effect.map(Database, (db) => ({
  send: (input: SendFeedback) => send(db, input),
  list: (status: FeedbackStatus) => list(db, status),
  setStatus: (id: FeedbackId, status: FeedbackStatus) => setStatus(db, id, status),
  sweep: () => sweep(db),
}))

/** Assistants' notes about Styld, over the application's database. */
export class Feedback extends Context.Service<Feedback, Effect.Success<typeof make>>()('@styld/server/mcp/Feedback') {
  static readonly layer = Layer.effect(this, make)
}
