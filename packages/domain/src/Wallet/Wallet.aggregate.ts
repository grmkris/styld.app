import * as Domain from '@alchemy.run/domain'
import { Effect, Record } from 'effect'
import { freeLeft, spendableOn } from './Allowance.ts'
import { maximumPendingReservations } from './Credits.ts'
import {
  CreditsReserved,
  InsufficientCredits,
  ReservationConflict,
  ReserveCredits,
  TooManyReservations,
} from './ReserveCredits.command.ts'
import { CreditsSettled, ReservationNotFound, SettleCredits } from './SettleCredits.command.ts'
import { WalletId } from './Wallet.id.ts'
import { WalletState } from './WalletState.ts'

/** The free credits as state holds them: absent until recorded. */
const freeOf = (free: number | undefined) => (free === undefined ? {} : { free })

/** An account's daily credits, its one-time free credits, and the holds on them. Internal commands only: no Domain Api exposes the
 * Wallet, so only the server's own code sends them, with transport IDs from `WalletCommandIds.ts`. */
export class Wallet extends Domain.Aggregate('Wallet', {
  id: WalletId,
  state: WalletState,
  initial: { daily: { day: null, remaining: 0 }, reservations: {} },
  commands: [ReserveCredits, SettleCredits],
  decide: {
    ReserveCredits: Effect.fn(function* (state, command) {
      const previous = state.reservations[command.operationId]
      if (previous !== undefined) {
        if (previous.amount !== command.amount) return yield* new ReservationConflict()
        return []
      }
      if (Object.keys(state.reservations).length >= maximumPendingReservations) return yield* new TooManyReservations()
      const { available, allowance } = spendableOn(state.daily, command.day, command.dailyAllowance)
      const free = freeLeft(state, command.freeCredits)
      const total = available + (free ?? 0)
      if (command.amount > total) return yield* new InsufficientCredits({ available: total, required: command.amount })
      // The day's allowance first, which tomorrow replaces anyway; the free credits never come back once spent.
      const fromDaily = Math.min(command.amount, available)
      const fromFree = command.amount - fromDaily
      return [
        new CreditsReserved({
          operationId: command.operationId,
          day: command.day,
          amount: command.amount,
          dailyAfter: available - fromDaily,
          dailyAllowance: allowance,
          ...(free === undefined ? {} : { fromFree, freeAfter: free - fromFree }),
        }),
      ]
    }),
    SettleCredits: Effect.fn(function* (state, command) {
      const reservation = state.reservations[command.operationId]
      if (reservation === undefined) return yield* new ReservationNotFound()
      // A refund returns the day's credits only on the day they were spent (tomorrow already has its own), and the
      // free credits always: they never reset.
      const refunded = command.outcome === 'refunded'
      const fromFree = reservation.fromFree ?? 0
      const returned = refunded && state.daily.day === reservation.day ? reservation.amount - fromFree : 0
      return [
        new CreditsSettled({
          operationId: command.operationId,
          outcome: command.outcome,
          amount: reservation.amount,
          dailyAfter: state.daily.remaining + returned,
          ...(refunded && fromFree > 0 ? { freeAfter: (state.free ?? 0) + fromFree } : {}),
        }),
      ]
    }),
  },
  evolve: {
    CreditsReserved: (state, event) => ({
      daily: {
        day: event.day,
        remaining: event.dailyAfter,
        ...(event.dailyAllowance === undefined ? {} : { allowance: event.dailyAllowance }),
      },
      ...freeOf(event.freeAfter ?? state.free),
      reservations: {
        ...state.reservations,
        [event.operationId]: {
          day: event.day,
          amount: event.amount,
          ...(event.fromFree === undefined || event.fromFree === 0 ? {} : { fromFree: event.fromFree }),
        },
      },
    }),
    CreditsSettled: (state, event) => ({
      daily: { ...state.daily, remaining: event.dailyAfter },
      ...freeOf(event.freeAfter ?? state.free),
      reservations: Record.remove(state.reservations, event.operationId),
    }),
  },
}) {}
