import * as Domain from '@alchemy.run/domain'
import { Effect, Record } from 'effect'
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

/** An account's free daily credits and the holds on them. Internal commands only: no Domain Api exposes the
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
      const available = state.daily.day === command.day ? state.daily.remaining : command.dailyAllowance
      if (command.amount > available) return yield* new InsufficientCredits({ available, required: command.amount })
      return [
        new CreditsReserved({
          operationId: command.operationId,
          day: command.day,
          amount: command.amount,
          dailyAfter: available - command.amount,
        }),
      ]
    }),
    SettleCredits: Effect.fn(function* (state, command) {
      const reservation = state.reservations[command.operationId]
      if (reservation === undefined) return yield* new ReservationNotFound()
      // A refund returns the free allowance only on the day it was spent; tomorrow already has its own.
      const returned = command.outcome === 'refunded' && state.daily.day === reservation.day ? reservation.amount : 0
      return [
        new CreditsSettled({
          operationId: command.operationId,
          outcome: command.outcome,
          amount: reservation.amount,
          dailyAfter: state.daily.remaining + returned,
        }),
      ]
    }),
  },
  evolve: {
    CreditsReserved: (state, event) => ({
      daily: { day: event.day, remaining: event.dailyAfter },
      reservations: { ...state.reservations, [event.operationId]: { day: event.day, amount: event.amount } },
    }),
    CreditsSettled: (state, event) => ({
      daily: { ...state.daily, remaining: event.dailyAfter },
      reservations: Record.remove(state.reservations, event.operationId),
    }),
  },
}) {}
