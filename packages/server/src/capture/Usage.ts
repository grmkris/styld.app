import { Unavailable, LimitReached } from '@styld/protocol'
import { CurrentActor } from '@styld/domain/CurrentActor.context'
import { OperationId, UserId } from '@styld/domain/Identity'
import { ReserveCredits } from '@styld/domain/Wallet/ReserveCredits.command'
import { SettleCredits } from '@styld/domain/Wallet/SettleCredits.command'
import { Wallet } from '@styld/domain/Wallet/Wallet.aggregate'
import { reserveCommandId, settleCommandId } from '@styld/domain/Wallet/WalletCommandIds'
import { Context, DateTime, Effect, Layer, Predicate } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as Hex from 'effect/encoding/Hex'
import { layerCryptoWeb } from '@yielded/auth/WebCrypto'

/** The UTC day an instant falls on, and the start of the next one. */
const dayOf = (now: DateTime.Utc) => DateTime.formatIso(now).slice(0, 10)
const nextDay = (now: DateTime.Utc) => DateTime.formatIso(DateTime.add(DateTime.startOf(now, 'day'), { days: 1 }))

const unavailable = () => Unavailable.make({})

/** Act as the service on an account's wallet: only trusted server code holds this authority. */
const as = (accountId: string) => Effect.provideService(CurrentActor, { userId: UserId.make(accountId), service: true })

/** Capture metering through the Wallet (Domain owns usage reservations): credits are held when work is
 * accepted, then consumed after it succeeds or refunded once after it fails. Billing later only adds
 * subscription and purchased credits behind the free daily allowance. */
export class Usage extends Context.Service<
  Usage,
  {
    readonly reserve: (
      accountId: string,
      operationId: string,
      credits: number,
    ) => Effect.Effect<void, LimitReached | Unavailable>
    readonly settle: (
      accountId: string,
      operationId: string,
      outcome: 'consumed' | 'refunded',
    ) => Effect.Effect<void, Unavailable>
    readonly remaining: (accountId: string) => Effect.Effect<number, Unavailable>
  }
>()('@styld/server/Usage') {
  static readonly layer = (dailyAllowance: number) =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const wallets = yield* Wallet
        const crypto = yield* Crypto.Crypto
        // What the Wallet compares when the same reservation arrives again: the operation and its amount.
        const fingerprintOf = (operationId: string, credits: number) =>
          crypto
            .digest('SHA-256', new TextEncoder().encode(`${operationId}:${credits}`))
            .pipe(Effect.map(Hex.encode), Effect.mapError(unavailable))
        return {
          reserve: Effect.fn('Styld.Usage.reserve')(function* (
            accountId: string,
            operationId: string,
            credits: number,
          ) {
            const now = yield* DateTime.now
            const command = new ReserveCredits({
              operationId: OperationId.make(operationId),
              fingerprint: yield* fingerprintOf(operationId, credits),
              amount: credits,
              day: dayOf(now),
              dailyAllowance,
            })
            yield* wallets.send(UserId.make(accountId), command, { commandId: reserveCommandId(command) }).pipe(
              as(accountId),
              Effect.catchTag('InsufficientCredits', () =>
                Effect.fail(LimitReached.make({ limit: 'dailyCredits', resetsAt: nextDay(now) })),
              ),
              Effect.mapError((error) => (Predicate.isTagged(error, 'LimitReached') ? error : unavailable())),
            )
          }),
          settle: Effect.fn('Styld.Usage.settle')(function* (
            accountId: string,
            operationId: string,
            outcome: 'consumed' | 'refunded',
          ) {
            const command = new SettleCredits({ operationId: OperationId.make(operationId), outcome })
            yield* wallets.send(UserId.make(accountId), command, { commandId: settleCommandId(command) }).pipe(
              as(accountId),
              // Already settled: the first outcome stands.
              Effect.catchTag('ReservationNotFound', () => Effect.void),
              Effect.mapError(unavailable),
            )
          }),
          remaining: Effect.fn('Styld.Usage.remaining')(function* (accountId: string) {
            const today = dayOf(yield* DateTime.now)
            const state = yield* wallets.state(UserId.make(accountId)).pipe(as(accountId), Effect.mapError(unavailable))
            return state.daily.day === today ? state.daily.remaining : dailyAllowance
          }),
        }
      }),
    ).pipe(Layer.provide(layerCryptoWeb))
}
