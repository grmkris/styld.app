import { dailyCredits, LimitReached, Unavailable } from '@styld/protocol'
import { OperationId, UserId } from '@styld/domain/Identity'
import { ReserveCredits } from '@styld/domain/Wallet/ReserveCredits.command'
import { SettleCredits } from '@styld/domain/Wallet/SettleCredits.command'
import { Wallet } from '@styld/domain/Wallet/Wallet.aggregate'
import { reserveCommandId, settleCommandId } from '@styld/domain/Wallet/WalletCommandIds'
import { Cause, Context, DateTime, Effect, Exit, Layer, Option, Predicate, Schedule, Schema } from 'effect'

// Every paid action holds its credits in the account's Wallet before the work runs and settles them once after it
// ends, by one policy: work that succeeded consumes them; work that failed, or whose provider answer was lost after it
// was sent, refunds them (owner, 2026-11-01). A hold is named by what it pays for and the attempt, so a hold id is
// never reused: the Wallet's receipts would answer a reused id as already reserved, and the work would run unpaid.

/** What a hold pays for. */
export type HoldKind = 'capture' | 'piece' | 'back' | 'photo' | 'generation' | 'picture' | 'turn' | 'stylist'

export const HoldId = Schema.String.pipe(Schema.brand('Styld/HoldId'))
export type HoldId = typeof HoldId.Type

/** The hold for one attempt at the work on one entity: a capture's retry, a piece's queue delivery, a redraw. */
export const holdId = (kind: HoldKind, entityId: string, attempt: number): HoldId =>
  HoldId.make(`${kind}/${entityId}/${attempt}`)

/** How work that held credits ended. */
export type Ending = 'succeeded' | 'failed' | 'unknown'

/** The one settlement policy: only work that succeeded is paid for. */
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

const unavailable = () => Unavailable.make({})

/** A Wallet the same isolate just reached may refuse for a moment while its object starts. */
const walletPatience = { schedule: Schedule.exponential('100 millis'), times: 2 }

/** Credit holds through the Wallet (Domain owns usage reservations). */
export class Holds extends Context.Service<
  Holds,
  {
    /** Hold the charge's credits; holding the same charge again is the same hold. */
    readonly reserve: (charge: Charge) => Effect.Effect<void, LimitReached | Unavailable>
    /** Settle a hold by how its work ended; the first settlement stands, and one with no hold is done. */
    readonly settle: (accountId: string, hold: HoldId, ending: Ending) => Effect.Effect<void, Unavailable>
    /** The credits the account has left today. */
    readonly remaining: (accountId: string) => Effect.Effect<number, Unavailable>
  }
>()('@styld/server/usage/Holds') {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const wallets = yield* Wallet
      return Holds.of({
        reserve: Effect.fn('Styld.Holds.reserve')(function* (charge: Charge) {
          yield* Effect.annotateCurrentSpan('styld.hold', charge.hold)
          const now = yield* DateTime.now
          const command = new ReserveCredits({
            operationId: OperationId.make(charge.hold),
            amount: charge.credits,
            day: dayOf(now),
            dailyAllowance: dailyCredits,
          })
          yield* wallets.send(UserId.make(charge.accountId), command, { commandId: reserveCommandId(command) }).pipe(
            Effect.catchTags({
              InsufficientCredits: () => LimitReached.make({ limit: 'dailyCredits', resetsAt: nextDay(now) }),
              TooManyReservations: () => LimitReached.make({ limit: 'dailyCredits', resetsAt: nextDay(now) }),
              ReservationConflict: () => Effect.die(new Error(`Hold ${charge.hold} reserved with another amount`)),
            }),
            Effect.asVoid,
            Effect.mapError((error) => (Predicate.isTagged(error, 'LimitReached') ? error : unavailable())),
          )
        }),
        settle: Effect.fn('Styld.Holds.settle')(function* (accountId: string, hold: HoldId, ending: Ending) {
          yield* Effect.annotateCurrentSpan({ 'styld.hold': hold, 'styld.hold.ending': ending })
          const command = new SettleCredits({ operationId: OperationId.make(hold), outcome: settlementOf(ending) })
          yield* wallets.send(UserId.make(accountId), command, { commandId: settleCommandId(command) }).pipe(
            Effect.asVoid,
            // No hold under this id: it was never reserved, or the first settlement already took it.
            Effect.catchTag('ReservationNotFound', () => Effect.void),
            Effect.retry(walletPatience),
            Effect.mapError(unavailable),
          )
        }),
        remaining: Effect.fn('Styld.Holds.remaining')(function* (accountId: string) {
          const today = dayOf(yield* DateTime.now)
          const state = yield* wallets.state(UserId.make(accountId)).pipe(Effect.mapError(unavailable))
          return state.daily.day === today ? state.daily.remaining : dailyCredits
        }),
      })
    }),
  )
}

/** How a failed attempt ended: a provider whose answer was lost after it took the work is `unknown`; anything else
 * failed. Both refund, so the difference is only what the span and the log say. */
const endingOf = (cause: Cause.Cause<unknown>): Ending =>
  Option.exists(Cause.findErrorOption(cause), (error) => Predicate.isTagged(error, 'ProviderOutcomeUnknown'))
    ? 'unknown'
    : 'failed'

/** Run paid work that ends within this effect: its credits held first, then settled by how it ended. A hold that
 * cannot be settled now is logged and left to the work's status sweep. */
export const metered = <A, E, R>(charge: Charge, work: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const holds = yield* Holds
    yield* holds.reserve(charge)
    const exit = yield* Effect.exit(work)
    yield* holds
      .settle(charge.accountId, charge.hold, Exit.isSuccess(exit) ? 'succeeded' : endingOf(exit.cause))
      .pipe(Effect.ignore({ log: true, message: 'Styld.Holds could not settle a hold' }))
    return yield* exit
  })
