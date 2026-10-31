import { boards, contentChecks, profiles, reports } from '@styld/db'
import { type CheckState, WardrobeUnavailable } from '@styld/protocol'
import { count, desc, eq, inArray, max } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Context, DateTime, Effect, Option } from 'effect'
import type { CheckTarget, Checks } from '../safety/Checks.ts'

// What Styld's admins do through their assistants: feature boards and people for Explore, mark the house account
// whose public boards are Edits from Styld, hide or restore anything whatever its check said, and read reports and
// checks. Only accounts on the admin list ever see these tools.

const unavailable = () => WardrobeUnavailable.make({})
const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: unavailable })
const nowDate = Effect.map(DateTime.now, DateTime.toDateUtc)

/** How many reports and checks a list shows. */
const listLimit = 50

/** Reading what was reported and how checks stand. */
const reading = (db: ReturnType<typeof drizzle>) => ({
  /** Reported things, the most recently reported first, with how many people reported each and why. */
  reports: () =>
    attempt(() =>
      db
        .select({
          kind: reports.targetKind,
          id: reports.targetId,
          reporters: count(),
          last: max(reports.createdAt),
        })
        .from(reports)
        .groupBy(reports.targetKind, reports.targetId)
        .orderBy(desc(max(reports.createdAt)))
        .limit(listLimit),
    ).pipe(
      Effect.flatMap((targets) =>
        Effect.map(
          attempt(() =>
            db
              .select({ id: reports.targetId, reason: reports.reason, note: reports.note })
              .from(reports)
              .where(
                inArray(
                  reports.targetId,
                  targets.map(({ id }) => id),
                ),
              ),
          ),
          (reasons) =>
            targets.map((target) => ({
              ...target,
              last: target.last === null ? null : new Date(target.last).toISOString(),
              reasons: reasons.filter(({ id }) => id === target.id).map(({ reason, note }) => ({ reason, note })),
            })),
        ),
      ),
    ),
  /** Checks in one state, the most recently asked first. */
  checks: (state: CheckState) =>
    attempt(() =>
      db
        .select({
          kind: contentChecks.targetKind,
          id: contentChecks.targetId,
          state: contentChecks.state,
          reason: contentChecks.reason,
          model: contentChecks.model,
          hidden: contentChecks.hidden,
        })
        .from(contentChecks)
        .where(eq(contentChecks.state, state))
        .orderBy(desc(contentChecks.requestedAt))
        .limit(listLimit),
    ),
})

const make = (database: Parameters<typeof drizzle>[0], checks: Checks['Service']) => {
  const db = drizzle(database)
  const accountOf = (handle: string) =>
    Effect.map(
      attempt(() =>
        db.select({ accountId: profiles.accountId }).from(profiles).where(eq(profiles.handle, handle)).limit(1),
      ),
      (rows) => Option.map(Option.fromNullishOr(rows[0]), ({ accountId }) => accountId),
    )
  return {
    ...reading(db),
    /** What a curation tool names: a profile by its handle, anything else by its id. */
    targetOf: (kind: CheckTarget['kind'], id: string) =>
      kind === 'profile'
        ? Effect.map(
            accountOf(id),
            Option.map((accountId): CheckTarget => ({ kind, id: accountId })),
          )
        : Effect.succeed(Option.some<CheckTarget>({ kind, id })),
    /** Feature a public board in Explore, or stop featuring it. */
    featureBoard: (boardId: string, featured: boolean) =>
      Effect.flatMap(nowDate, (at) =>
        attempt(() =>
          db
            .update(boards)
            .set({ featuredAt: featured ? at : null })
            .where(eq(boards.id, boardId))
            .returning({ id: boards.id }),
        ),
      ).pipe(Effect.map((rows) => rows.length > 0)),
    /** Feature a person among People to follow, or stop. */
    featureProfile: (handle: string, featured: boolean) =>
      Effect.flatMap(nowDate, (at) =>
        attempt(() =>
          db
            .update(profiles)
            .set({ featuredAt: featured ? at : null })
            .where(eq(profiles.handle, handle))
            .returning({ id: profiles.accountId }),
        ),
      ).pipe(Effect.map((rows) => rows.length > 0)),
    /** Mark the house account, whose public boards are Edits from Styld. It may take the reserved `styld` handle. */
    markHouse: (handle: string, house: boolean, newHandle: Option.Option<string>) =>
      Effect.gen(function* () {
        const accountId = yield* accountOf(handle)
        if (Option.isNone(accountId)) return false
        const taken = Option.isSome(newHandle) ? yield* accountOf(newHandle.value) : Option.none()
        if (Option.isSome(taken) && taken.value !== accountId.value) return false
        yield* attempt(() =>
          db
            .update(profiles)
            .set({ house, ...(Option.isSome(newHandle) ? { handle: newHandle.value } : {}) })
            .where(eq(profiles.accountId, accountId.value)),
        )
        return true
      }),
    /** Hide something from others whatever its check said, or restore it to what the check says; the check's rows
     * are written only by `Checks`. */
    hide: (target: CheckTarget, hidden: boolean) => checks.curate(target, hidden).pipe(Effect.mapError(unavailable)),
    /** Put something in front of the model again. */
    rerun: (target: CheckTarget) => checks.reported(target, false),
  }
}

/** Curation for Styld's admins. */
export class Curation extends Context.Service<Curation, ReturnType<typeof make>>()('@styld/server/Curation') {}

export const makeCuration = (database: Parameters<typeof drizzle>[0], checks: Checks['Service']) =>
  Curation.of(make(database, checks))

/** The admin list: lowercased emails, from the Worker's `STYLD_ADMIN_EMAILS` (comma-separated). */
export const adminEmails = (configured: unknown): ReadonlySet<string> =>
  new Set(
    (typeof configured === 'string' ? configured : '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  )

/** Whether the signed-in account's email is on the admin list. */
export const isAdmin = (admins: ReadonlySet<string>, row: unknown) =>
  typeof row === 'object' &&
  row !== null &&
  'email' in row &&
  typeof row.email === 'string' &&
  admins.has(row.email.toLowerCase())
