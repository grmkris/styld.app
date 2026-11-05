import { contentChecks, profiles, reports } from '@styld/db'
import { type CheckState } from '@styld/protocol'
import { count, desc, eq, inArray, max } from 'drizzle-orm'
import { Context, Effect, Layer, Option, Predicate } from 'effect'
import { BoardRows } from '../boards/Rows.ts'
import { type CheckTarget, Checks } from '../safety/Checks.ts'
import { Database, nowDate, query, stored } from '../kernel/Db.ts'
import { handleOwner } from './ProfileStore.ts'

// What Styld's admins do through their assistants: feature boards and people for Explore, mark the house account
// whose public boards are Edits from Styld, hide or restore anything whatever its check said, and read reports and
// checks. Only accounts on the admin list ever see these tools.

const read = <A>(run: () => Promise<A>) => query(run).pipe(stored)

/** How many reports and checks a list shows. */
const listLimit = 50

type Drizzle = Database['Service']

/** Reading what was reported and how checks stand. */
const reading = (db: Drizzle) => ({
  /** Reported things, the most recently reported first, with how many people reported each and why. */
  reports: Effect.fn('Styld.Curation.reports')(function* () {
    const targets = yield* read(() =>
      db
        .select({ kind: reports.targetKind, id: reports.targetId, reporters: count(), last: max(reports.createdAt) })
        .from(reports)
        .groupBy(reports.targetKind, reports.targetId)
        .orderBy(desc(max(reports.createdAt)))
        .limit(listLimit),
    )
    const reasons = yield* read(() =>
      db
        .select({ id: reports.targetId, reason: reports.reason, note: reports.note })
        .from(reports)
        .where(
          inArray(
            reports.targetId,
            targets.map(({ id }) => id),
          ),
        ),
    )
    return targets.map((target) => ({
      ...target,
      last: target.last === null ? null : new Date(target.last).toISOString(),
      reasons: reasons.filter(({ id }) => id === target.id).map(({ reason, note }) => ({ reason, note })),
    }))
  }),
  /** Checks in one state, the most recently asked first. */
  checks: Effect.fn('Styld.Curation.checks')(function* (state: CheckState) {
    return yield* read(() =>
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
    )
  }),
})

/** Featuring boards and people, and the house account. */
const featuring = (db: Drizzle) => ({
  /** Feature a public board in Explore, or stop featuring it, by the boards' statement (`BoardRows`). */
  featureBoard: Effect.fn('Styld.Curation.featureBoard')(function* (boardId: string, featured: boolean) {
    const at = yield* nowDate
    const rows = yield* read(() => BoardRows.feature(db, boardId, featured ? at : null))
    return rows.length > 0
  }),
  /** Feature a person among People to follow, or stop. */
  featureProfile: Effect.fn('Styld.Curation.featureProfile')(function* (handle: string, featured: boolean) {
    const at = yield* nowDate
    const rows = yield* read(() =>
      db
        .update(profiles)
        .set({ featuredAt: featured ? at : null })
        .where(eq(profiles.handle, handle))
        .returning({ id: profiles.accountId }),
    )
    return rows.length > 0
  }),
  /** Mark the house account, whose public boards are Edits from Styld. It may take the reserved `styld` handle. */
  markHouse: Effect.fn('Styld.Curation.markHouse')(function* (
    handle: string,
    house: boolean,
    newHandle: Option.Option<string>,
  ) {
    const accountId = yield* handleOwner(db, handle).pipe(stored)
    if (Option.isNone(accountId)) return false
    const taken = Option.isSome(newHandle) ? yield* handleOwner(db, newHandle.value).pipe(stored) : Option.none()
    if (Option.isSome(taken) && taken.value !== accountId.value) return false
    yield* read(() =>
      db
        .update(profiles)
        .set({ house, ...(Option.isSome(newHandle) ? { handle: newHandle.value } : {}) })
        .where(eq(profiles.accountId, accountId.value)),
    )
    return true
  }),
})

const make = Effect.gen(function* () {
  const db = yield* Database
  const checks = yield* Checks
  return {
    ...reading(db),
    ...featuring(db),
    /** What a curation tool names: a profile by its handle, anything else by its id. */
    targetOf: Effect.fn('Styld.Curation.targetOf')(function* (kind: CheckTarget['kind'], id: string) {
      if (kind !== 'profile') return Option.some<CheckTarget>({ kind, id })
      const accountId = yield* handleOwner(db, id).pipe(stored)
      return Option.map(accountId, (account): CheckTarget => ({ kind, id: account }))
    }),
    /** Hide something from others whatever its check said, or restore it to what the check says; the check's rows are
     * written only by `Checks`. */
    hide: Effect.fn('Styld.Curation.hide')(function* (target: CheckTarget, hidden: boolean) {
      return yield* checks.curate(target, hidden)
    }),
    /** Put something in front of the model again. */
    rerun: Effect.fn('Styld.Curation.rerun')(function* (target: CheckTarget) {
      yield* checks.reported(target, false)
    }),
  }
})

/** Curation for Styld's admins. */
export class Curation extends Context.Service<Curation, Effect.Success<typeof make>>()(
  '@styld/server/social/Curation',
) {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Curation.of(service)),
  )
}

/** A list of sign-in emails from a comma-separated deployment fact, lowercased: the admins (`STYLD_ADMIN_EMAILS`) and
 * the house accounts (`STYLD_HOUSE_EMAILS`). */
export const emailListOf = (configured: unknown): ReadonlySet<string> =>
  new Set(
    (typeof configured === 'string' ? configured : '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  )

/** Whether the signed-in account's email is on the admin list. */
export const isAdmin = (admins: ReadonlySet<string>, row: unknown) =>
  Predicate.hasProperty(row, 'email') && Predicate.isString(row.email) && admins.has(row.email.toLowerCase())
