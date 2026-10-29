import * as Domain from '@alchemy.run/domain'
import { Effect, Record } from 'effect'
import { requireService } from '../CurrentActor.context.ts'
import { maximumCredits, maximumPendingReservations } from './Credits.ts'
import {
  GrantMonthlyCredits,
  MonthlyCreditsGranted,
  MonthlyGrantConflict,
  StaleCreditGrant,
} from './GrantMonthlyCredits.command.ts'
import { CreditLimitExceeded, GrantPurchasedCredits, PurchasedCreditsGranted } from './GrantPurchasedCredits.command.ts'
import {
  CreditsReserved,
  InsufficientCredits,
  ReservationConflict,
  ReserveCredits,
  TooManyReservations,
} from './ReserveCredits.command.ts'
import { CreditsSettled, ReservationNotFound, SettleCredits } from './SettleCredits.command.ts'
import { WalletId } from './Wallet.id.ts'
import { heldCredits, WalletState } from './WalletState.ts'

/** Internal commands only. Trusted handlers derive stable transport IDs from payment/operation IDs. */
export class Wallet extends Domain.Aggregate('Wallet', {
  id: WalletId,
  state: WalletState,
  initial: {
    daily: { day: null, remaining: 0 },
    subscription: 0,
    purchased: 0,
    period: null,
    monthly: 0,
    reservations: {},
  },
  commands: [GrantPurchasedCredits, GrantMonthlyCredits, ReserveCredits, SettleCredits],
  decide: {
    GrantPurchasedCredits: Effect.fn(function* (state, command, { id }) {
      yield* requireService(id)
      const purchasedAfter = state.purchased + command.amount
      if (purchasedAfter + heldCredits(state).purchased > maximumCredits) return yield* new CreditLimitExceeded()
      return [new PurchasedCreditsGranted({ paymentId: command.paymentId, amount: command.amount, purchasedAfter })]
    }),
    GrantMonthlyCredits: Effect.fn(function* (state, command, { id }) {
      yield* requireService(id)
      if (state.period !== null && command.period < state.period)
        return yield* new StaleCreditGrant({ current: state.period })
      if (command.period === state.period) {
        if (command.monthly !== state.monthly) return yield* new MonthlyGrantConflict()
        return []
      }
      if (command.monthly * 2 > maximumCredits) return yield* new CreditLimitExceeded()
      // Holds remain owned by the old operation across renewal or a plan downgrade.
      const held = heldCredits(state).subscription
      const subscriptionAfter = Math.max(
        0,
        Math.min(state.subscription + held + command.monthly, command.monthly * 2) - held,
      )
      return [new MonthlyCreditsGranted({ period: command.period, monthly: command.monthly, subscriptionAfter })]
    }),
    ReserveCredits: Effect.fn(function* (state, command, { id }) {
      yield* requireService(id)
      const previous = state.reservations[command.operationId]
      if (previous !== undefined) {
        if (
          previous.fingerprint !== command.fingerprint ||
          previous.fromDaily + previous.fromSubscription + previous.fromPurchased !== command.amount
        )
          return yield* new ReservationConflict()
        return []
      }
      if (Object.keys(state.reservations).length >= maximumPendingReservations) return yield* new TooManyReservations()
      // The free allowance is spent first, then subscription credits, then purchased ones.
      const daily = state.daily.day === command.day ? state.daily.remaining : command.dailyAllowance
      const available = daily + state.subscription + state.purchased
      if (command.amount > available) return yield* new InsufficientCredits({ available, required: command.amount })
      const fromDaily = Math.min(daily, command.amount)
      const fromSubscription = Math.min(state.subscription, command.amount - fromDaily)
      const fromPurchased = command.amount - fromDaily - fromSubscription
      return [
        new CreditsReserved({
          operationId: command.operationId,
          fingerprint: command.fingerprint,
          day: command.day,
          fromDaily,
          dailyAfter: daily - fromDaily,
          fromSubscription,
          fromPurchased,
          subscriptionAfter: state.subscription - fromSubscription,
          purchasedAfter: state.purchased - fromPurchased,
        }),
      ]
    }),
    SettleCredits: Effect.fn(function* (state, command, { id }) {
      yield* requireService(id)
      const reservation = state.reservations[command.operationId]
      if (reservation === undefined) return yield* new ReservationNotFound()
      const refund = command.outcome === 'refunded'
      // A refund returns the free allowance only on the day it was spent; tomorrow already has its own.
      const sameDay = state.daily.day === reservation.day
      return [
        new CreditsSettled({
          operationId: command.operationId,
          outcome: command.outcome,
          fromDaily: reservation.fromDaily,
          dailyAfter: state.daily.remaining + (refund && sameDay ? reservation.fromDaily : 0),
          fromSubscription: reservation.fromSubscription,
          fromPurchased: reservation.fromPurchased,
          subscriptionAfter: state.subscription + (refund ? reservation.fromSubscription : 0),
          purchasedAfter: state.purchased + (refund ? reservation.fromPurchased : 0),
        }),
      ]
    }),
  },
  evolve: {
    PurchasedCreditsGranted: (state, event) => ({ ...state, purchased: event.purchasedAfter }),
    MonthlyCreditsGranted: (state, event) => ({
      ...state,
      subscription: event.subscriptionAfter,
      period: event.period,
      monthly: event.monthly,
    }),
    CreditsReserved: (state, event) => ({
      ...state,
      daily: { day: event.day, remaining: event.dailyAfter },
      subscription: event.subscriptionAfter,
      purchased: event.purchasedAfter,
      reservations: {
        ...state.reservations,
        [event.operationId]: {
          fingerprint: event.fingerprint,
          day: event.day,
          fromDaily: event.fromDaily,
          fromSubscription: event.fromSubscription,
          fromPurchased: event.fromPurchased,
        },
      },
    }),
    CreditsSettled: (state, event) => ({
      ...state,
      daily: { ...state.daily, remaining: event.dailyAfter },
      subscription: event.subscriptionAfter,
      purchased: event.purchasedAfter,
      reservations: Record.remove(state.reservations, event.operationId),
    }),
  },
}) {}
