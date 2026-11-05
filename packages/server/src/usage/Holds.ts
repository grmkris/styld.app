import { isOutcomeUnknown, ProviderError } from '../providers/Errors.ts'
import { accounts, pendingSettlements } from '@styld/db'
import { freeCredits, LimitReached, Unavailable } from '@styld/protocol'
import { freeLeft, spendableOn } from '@styld/domain/Wallet/Allowance'
import type { WalletState } from '@styld/domain/Wallet/WalletState'
import { OperationId, UserId } from '@styld/domain/Identity'
import { ReserveCredits } from '@styld/domain/Wallet/ReserveCredits.command'
import { SettleCredits } from '@styld/domain/Wallet/SettleCredits.command'
import { Wallet } from '@styld/domain/Wallet/Wallet.aggregate'
import { reserveCommandId, settleCommandId } from '@styld/domain/Wallet/WalletCommandIds'
import { and, asc, eq, isNotNull, lt, or, sql } from 'drizzle-orm'
import { Cause, Context, DateTime, Duration, Effect, Layer, Option, Predicate, Schedule, Schema } from 'effect'
import { Database, first, nowDate, query, stored } from '../kernel/Db.ts'
import { allowanceAt, membershipOf, type MembershipRecord } from '../billing/Membership.ts'

// Every paid action holds its credits in the account's Wallet before the work runs and settles them once after it
// ends, by one policy: work that succeeded consumes them; work that failed, or whose provider answer was lost after it
// was sent, refunds them (owner, 2026-11-01). A hold is named by what it pays for and the attempt, so a hold id is
// never reused: the Wallet's receipts would answer a reused id as already reserved, and the work would run unpaid.
// Every hold is kept in D1 (`pending_settlements`) from before it is reserved until the Wallet confirms it settled.

/** What a hold pays for. Holds named `back/…` (a back's photo credit until 4 November) are no longer made; any still
 * pending is settled by id like every other (`settlementRows`), never by its kind. */
export type HoldKind = 'capture' | 'piece' | 'photo' | 'generation' | 'picture' | 'turn' | 'stylist' | 'tryOn'

export const HoldId = Schema.String.pipe(Schema.brand('Styld/HoldId'))
export type HoldId = typeof HoldId.Type

/** The hold for one attempt at the work on one entity: a capture's retry, a piece's queue delivery, a redraw. */
export const holdId = (kind: HoldKind, entityId: string, attempt: number): HoldId =>
  HoldId.make(`${kind}/${entityId}/${attempt}`)

/** How work that held credits ended. */
export type Ending = 'succeeded' | 'failed' | 'unknown'

/** The one settlement policy: only work that succeeded is paid for.
 * @internal Exported for its tests. */
export const settlementOf = (ending: Ending) => (ending === 'succeeded' ? 'consumed' : 'refunded')

/** Credits to hold for one attempt at paid work. */
export interface Charge {
  readonly accountId: string
  readonly hold: HoldId
  readonly credits: number
}

/** The UTC day an instant falls on, and the start of the next one. */
const dayOf = (now: DateTime.Utc) => DateTime.formatIso(now).slice(0, 10)
const nextDay = (now: DateTime.Utc) => DateTime.formatIso(DateTime.add(DateTime.startOf(now, 'day'), { days: 1 }))

/** Why a hold was refused: a member's credits come back tomorrow; without a plan none do (owner, 4 November 2026). */
const refusal = (daily: number, now: DateTime.Utc) =>
  daily === 0
    ? LimitReached.make({ limit: 'credits' })
    : LimitReached.make({ limit: 'dailyCredits', resetsAt: nextDay(now) })

/** A Wallet the same isolate just reached may refuse for a moment while its object starts. */
const walletPatience = { schedule: Schedule.exponential('100 millis'), times: 2 }

/** A hold whose work never recorded how it ended is refunded after this long: longer than any work's own patience (a
 * turn's video waits two hours for the owner's browser; every other job is given up within half an hour), so only a
 * hold whose work was lost before it could end reaches it. */
const abandonedAfter = Duration.hours(6)

/** The most holds one sweep settles. */
const settleBatch = 50

/** The holds the Wallet has not yet confirmed settled: a row is written before its hold is reserved and goes once the
 * Wallet settled it, so a settlement lost on the way (the Wallet unreachable, the work's own rows ended or deleted
 * meanwhile) is never lost for good: the sweep finds it here, whatever became of the work.
 * @internal Exported for its tests. */
export const settlementRows = (db: Database['Service']) => ({
  enabled: (accountId: string) =>
    query(() =>
      db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.enabled, true)))
        .limit(1),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** The hold is about to be reserved; a hold opened again (the same charge held twice) keeps its row. */
  open: (accountId: string, hold: HoldId, at: Date) =>
    query(() =>
      db
        .insert(pendingSettlements)
        .values({ holdId: hold, accountId, ending: null, updatedAt: at })
        .onConflictDoNothing(),
    ),
  /** Record how the work ended; the first ending recorded stands, and is the one answered. */
  end: (accountId: string, hold: HoldId, ending: Ending, at: Date) =>
    query(() =>
      db
        .insert(pendingSettlements)
        .values({ holdId: hold, accountId, ending, updatedAt: at })
        .onConflictDoUpdate({
          target: pendingSettlements.holdId,
          set: { ending: sql`coalesce(${pendingSettlements.ending}, excluded.ending)`, updatedAt: at },
        })
        .returning({ ending: pendingSettlements.ending }),
    ).pipe(
      Effect.map((rows) =>
        Option.getOrElse(
          Option.flatMapNullishOr(first(rows), (row) => row.ending),
          () => ending,
        ),
      ),
    ),
  /** The Wallet settled the hold, or never held it. */
  forget: (hold: HoldId) => query(() => db.delete(pendingSettlements).where(eq(pendingSettlements.holdId, hold))),
  /** Holds to settle now, oldest first: every one whose ending is recorded, and every one opened before `abandoned`
   * whose work never recorded one, refunded as `unknown`. */
  unsettled: (abandoned: Date, limit: number) =>
    query(() =>
      db
        .select()
        .from(pendingSettlements)
        .where(or(isNotNull(pendingSettlements.ending), lt(pendingSettlements.updatedAt, abandoned)))
        .orderBy(asc(pendingSettlements.updatedAt))
        .limit(limit),
    ).pipe(
      Effect.map((rows) =>
        rows.map(({ holdId: hold, accountId, ending }) => ({
          hold: HoldId.make(hold),
          accountId,
          ending: ending ?? ('unknown' as const),
        })),
      ),
    ),
})

/** An account's credits now: today's and the free ones left together, today's allowance, the free ones left, and its
 * membership as D1 has it. */
export interface Balance {
  readonly remaining: number
  readonly daily: number
  readonly free: number
  readonly membership: Option.Option<MembershipRecord>
}

/** Today's allowance (the members' while a plan is active, `billing/Membership.ts`, none otherwise) and what is left
 * of it and of the free credits: the one reading the holds reserve under and the credits the person is shown. */
const balances = (
  walletOf: (accountId: string) => Effect.Effect<WalletState, Unavailable>,
  db: Database['Service'],
) => {
  const allowanceOf = (accountId: string, now: DateTime.Utc) =>
    membershipOf(db, accountId).pipe(
      Effect.map((membership) => ({ membership, daily: allowanceAt(membership, DateTime.toDateUtc(now)) })),
      stored,
    )
  const balance = Effect.fn('Styld.Holds.balance')(function* (accountId: string) {
    const now = yield* DateTime.now
    const { membership, daily } = yield* allowanceOf(accountId, now)
    const state = yield* walletOf(accountId)
    const free = freeLeft(state, freeCredits) ?? 0
    return { remaining: spendableOn(state.daily, dayOf(now), daily).available + free, daily, free, membership }
  })
  return { allowanceOf, balance }
}

/** Credit holds through the Wallet (Domain owns usage reservations), each kept in D1 until it is settled. */
export class Holds extends Context.Service<
  Holds,
  {
    /** Hold the charge's credits; holding the same charge again is the same hold. A charge of no credits holds
     * nothing (a back, free since 4 November), and settling it is done like any hold never reserved. */
    readonly reserve: (charge: Charge) => Effect.Effect<void, LimitReached | Unavailable>
    /** Settle a hold by how its work ended; the first settlement stands, and one with no hold is done. Done once the
     * ending is recorded: a Wallet that cannot take it now is settled by the sweep. */
    readonly settle: (accountId: string, hold: HoldId, ending: Ending) => Effect.Effect<void, Unavailable>
    /** The credits the account has left now. */
    readonly remaining: (accountId: string) => Effect.Effect<number, Unavailable>
    /** The credits left now, today's allowance (the members' or none), the free credits left and the membership. */
    readonly balance: (accountId: string) => Effect.Effect<Balance, Unavailable>
    /** Settle the holds still kept, a batch at a time; how many it tried. */
    readonly sweep: Effect.Effect<number, Unavailable>
  }
>()('@styld/server/usage/Holds') {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const wallets = yield* Wallet
      const db = yield* Database
      const ledger = settlementRows(db)
      const { allowanceOf, balance } = balances((accountId) => wallets.state(UserId.make(accountId)).pipe(stored), db)
      /** The Wallet's settlement, then the row forgotten (one that cannot be forgotten now is settled again later). A
       * hold the Wallet does not hold (never reserved, or settled before) is settled. */
      const settled = (accountId: string, hold: HoldId, ending: Ending) => {
        const command = new SettleCredits({ operationId: OperationId.make(hold), outcome: settlementOf(ending) })
        return wallets.send(UserId.make(accountId), command, { commandId: settleCommandId(command) }).pipe(
          Effect.asVoid,
          Effect.catchTag('ReservationNotFound', () => Effect.void),
          Effect.retry(walletPatience),
          stored,
          Effect.andThen(Effect.ignore(ledger.forget(hold))),
        )
      }
      return Holds.of({
        reserve: Effect.fn('Styld.Holds.reserve')(function* (charge: Charge) {
          yield* Effect.annotateCurrentSpan('styld.hold', charge.hold)
          if (charge.credits === 0) return
          const now = yield* DateTime.now
          if (!(yield* ledger.enabled(charge.accountId).pipe(stored))) return yield* Unavailable.make({})
          // No hold without its row: the row is what settles it if everything after this is lost.
          yield* ledger.open(charge.accountId, charge.hold, DateTime.toDateUtc(now)).pipe(stored)
          const { daily } = yield* allowanceOf(charge.accountId, now)
          const command = new ReserveCredits({
            operationId: OperationId.make(charge.hold),
            amount: charge.credits,
            day: dayOf(now),
            dailyAllowance: daily,
            freeCredits,
          })
          const refusedToday = () => refusal(daily, now)
          yield* wallets.send(UserId.make(charge.accountId), command, { commandId: reserveCommandId(command) }).pipe(
            Effect.catchTags({
              InsufficientCredits: refusedToday,
              TooManyReservations: refusedToday,
              ReservationConflict: () => Effect.die(new Error(`Hold ${charge.hold} reserved with another amount`)),
            }),
            Effect.asVoid,
            Effect.mapError((error) => (Predicate.isTagged(error, 'LimitReached') ? error : Unavailable.make({}))),
            // Refused outright, nothing is held and the row goes; a Wallet that did not answer leaves it to the sweep.
            Effect.tapError((error) =>
              Predicate.isTagged(error, 'LimitReached') ? Effect.ignore(ledger.forget(charge.hold)) : Effect.void,
            ),
          )
          // Domain replays accepted commands even after their reservation was settled. That receipt alone is not
          // permission to start more work: this exact hold must still be present in the Wallet.
          const state = yield* wallets.state(UserId.make(charge.accountId)).pipe(stored)
          if (state.reservations[OperationId.make(charge.hold)] === undefined) return yield* Unavailable.make({})
        }),
        settle: Effect.fn('Styld.Holds.settle')(function* (accountId: string, hold: HoldId, ending: Ending) {
          yield* Effect.annotateCurrentSpan({ 'styld.hold': hold, 'styld.hold.ending': ending })
          const recorded = yield* Effect.option(ledger.end(accountId, hold, ending, yield* nowDate))
          const now = settled(
            accountId,
            hold,
            Option.getOrElse(recorded, () => ending),
          )
          // Recorded, the sweep settles what the Wallet cannot take now; unrecorded, only this call can.
          yield* Option.isSome(recorded)
            ? now.pipe(Effect.ignore({ log: true, message: 'Styld.Holds left a settlement to the sweep' }))
            : now
        }),
        remaining: (accountId: string) => Effect.map(balance(accountId), ({ remaining }) => remaining),
        balance,
        sweep: Effect.gen(function* () {
          const abandoned = DateTime.toDateUtc(DateTime.subtractDuration(yield* DateTime.now, abandonedAfter))
          const open = yield* ledger.unsettled(abandoned, settleBatch).pipe(stored)
          yield* Effect.forEach(
            open,
            ({ accountId, hold, ending }) =>
              settled(accountId, hold, ending).pipe(
                Effect.ignore({ log: true, message: 'Styld.Holds could not settle a hold yet' }),
              ),
            { discard: true },
          )
          return open.length
        }).pipe(Effect.withSpan('Styld.Holds.sweep')),
      })
    }),
  )
}

const isProviderError = Schema.is(ProviderError)

/** How a failed attempt ended: a provider whose answer was lost after it took the work is `unknown`; anything else
 * failed. Both refund, so the difference is only what the span and the log say. */
export const failedEnding = (cause: Cause.Cause<unknown>): Ending =>
  Option.exists(Cause.findErrorOption(cause), (error) => isProviderError(error) && isOutcomeUnknown(error))
    ? 'unknown'
    : 'failed'
