import { Story } from '@alchemy.run/domain/Story'
import { it } from '@effect/vitest'
import { expect } from 'vitest'
import { CurrentActor, NotAuthorized } from '../src/CurrentActor.context.ts'
import { OperationId, UserId } from '../src/Identity.ts'
import { Styld } from '../src/Styld.model.ts'
import {
  GrantMonthlyCredits,
  MonthlyCreditsGranted,
  StaleCreditGrant,
} from '../src/Wallet/GrantMonthlyCredits.command.ts'
import { GrantPurchasedCredits, PurchasedCreditsGranted } from '../src/Wallet/GrantPurchasedCredits.command.ts'
import {
  CreditsReserved,
  InsufficientCredits,
  ReservationConflict,
  ReserveCredits,
} from '../src/Wallet/ReserveCredits.command.ts'
import { CreditsSettled, ReservationNotFound, SettleCredits } from '../src/Wallet/SettleCredits.command.ts'
import { Wallet } from '../src/Wallet/Wallet.aggregate.ts'
import { reserveCommandId, settleCommandId } from '../src/Wallet/WalletCommandIds.ts'

const story = Story.make(Styld)
const today = '2026-10-29'
/** Accounts with no free allowance, as these older stories assume. */
const noAllowance = { day: today, dailyAllowance: 0 }
const noneFromDaily = { day: today, fromDaily: 0, dailyAfter: 0 }
const owner = UserId.make('usr_alice')
const wallet = Wallet.ref(owner)
const operationId = OperationId.make('generation-one')
const fingerprint = 'a'.repeat(64)
const service = Story.provide(CurrentActor, { userId: owner, service: true })
const initialGrant = new MonthlyCreditsGranted({ period: '2026-10', monthly: 10, subscriptionAfter: 10 })
const reserve = new ReserveCredits({ ...noAllowance, operationId, fingerprint, amount: 15 })
const reserveFour = new ReserveCredits({ ...noAllowance, operationId, fingerprint, amount: 4 })
const reservedFour = new CreditsReserved({
  ...noneFromDaily,
  operationId,
  fingerprint,
  fromSubscription: 4,
  fromPurchased: 0,
  subscriptionAfter: 6,
  purchasedAfter: 0,
})
const refund = new SettleCredits({ operationId, outcome: 'refunded' })
const reserved = new CreditsReserved({
  ...noneFromDaily,
  operationId,
  fingerprint,
  fromSubscription: 10,
  fromPurchased: 5,
  subscriptionAfter: 0,
  purchasedAfter: 5,
})

// beta.84 has no Domain.verify export. Building the real model exercises its kernel validation.
it.effect('builds the complete declared model', () => story())

it.effect('allocates subscription first and refunds exactly once to the original pools', () =>
  story(
    service,
    Story.given(
      wallet,
      initialGrant,
      new PurchasedCreditsGranted({ paymentId: 'purchase-one', amount: 10, purchasedAfter: 10 }),
    ),
    Story.when(wallet, reserve, { commandId: reserveCommandId(reserve) }),
    Story.then(wallet, reserved),
    Story.when(wallet, reserve, { commandId: reserveCommandId(reserve) }),
    Story.then(wallet),
    Story.when(wallet, refund, { commandId: settleCommandId(refund) }),
    Story.then(
      wallet,
      new CreditsSettled({
        fromDaily: 0,
        dailyAfter: 0,
        operationId,
        outcome: 'refunded',
        fromSubscription: 10,
        fromPurchased: 5,
        subscriptionAfter: 10,
        purchasedAfter: 10,
      }),
    ),
    Story.when(wallet, new SettleCredits({ operationId, outcome: 'refunded' })),
    Story.rejected(new ReservationNotFound()),
    Story.state(wallet, (state) => expect(state).toMatchObject({ subscription: 10, purchased: 10, reservations: {} })),
  ),
)

it.effect('derived command IDs keep a settled operation from being reserved again', () =>
  story(
    service,
    Story.given(wallet, initialGrant),
    Story.when(wallet, reserveFour, { commandId: reserveCommandId(reserveFour) }),
    Story.then(wallet, reservedFour),
    Story.when(wallet, new SettleCredits({ operationId, outcome: 'consumed' }), {
      commandId: settleCommandId(new SettleCredits({ operationId, outcome: 'consumed' })),
    }),
    Story.then(
      wallet,
      new CreditsSettled({
        fromDaily: 0,
        dailyAfter: 0,
        operationId,
        outcome: 'consumed',
        fromSubscription: 4,
        fromPurchased: 0,
        subscriptionAfter: 6,
        purchasedAfter: 0,
      }),
    ),
    // A redelivered reservation reuses its receipt: no second hold for a settled operation.
    Story.when(wallet, reserveFour, { commandId: reserveCommandId(reserveFour) }),
    Story.then(wallet),
    // A late refund for the same operation is the same settlement and cannot return consumed credits.
    Story.when(wallet, refund, { commandId: settleCommandId(refund) }),
    Story.then(wallet),
    Story.state(wallet, (state) => expect(state).toMatchObject({ subscription: 6, reservations: {} })),
  ),
)

it.effect('a settle that arrives before its reservation is rejected and does not block the later settlement', () =>
  story(
    service,
    Story.given(wallet, initialGrant),
    Story.when(wallet, refund, { commandId: settleCommandId(refund) }),
    Story.rejected(new ReservationNotFound()),
    Story.when(wallet, reserveFour, { commandId: reserveCommandId(reserveFour) }),
    Story.then(wallet, reservedFour),
    // The rejection left no receipt, so the same settle ID now settles the hold.
    Story.when(wallet, refund, { commandId: settleCommandId(refund) }),
    Story.then(
      wallet,
      new CreditsSettled({
        fromDaily: 0,
        dailyAfter: 0,
        operationId,
        outcome: 'refunded',
        fromSubscription: 4,
        fromPurchased: 0,
        subscriptionAfter: 10,
        purchasedAfter: 0,
      }),
    ),
  ),
)

it.effect('refuses overspend and changed reservations', () =>
  story(
    service,
    Story.given(
      wallet,
      initialGrant,
      new PurchasedCreditsGranted({ paymentId: 'purchase-one', amount: 10, purchasedAfter: 10 }),
    ),
    Story.when(wallet, reserve),
    Story.then(wallet, reserved),
    Story.when(wallet, new ReserveCredits({ ...noAllowance, operationId, fingerprint: 'b'.repeat(64), amount: 15 })),
    Story.rejected(new ReservationConflict()),
    Story.when(
      wallet,
      new ReserveCredits({ ...noAllowance, operationId: OperationId.make('generation-two'), fingerprint, amount: 6 }),
    ),
    Story.rejected(new InsufficientCredits({ available: 5, required: 6 })),
  ),
)

it.effect('preserves unresolved holds across monthly renewal', () =>
  story(
    service,
    Story.given(wallet, initialGrant),
    Story.when(wallet, new ReserveCredits({ ...noAllowance, operationId, fingerprint, amount: 8 })),
    Story.then(
      wallet,
      new CreditsReserved({
        ...noneFromDaily,
        operationId,
        fingerprint,
        fromSubscription: 8,
        fromPurchased: 0,
        subscriptionAfter: 2,
        purchasedAfter: 0,
      }),
    ),
    Story.when(wallet, new GrantMonthlyCredits({ period: '2026-11', monthly: 10 })),
    Story.then(wallet, new MonthlyCreditsGranted({ period: '2026-11', monthly: 10, subscriptionAfter: 12 })),
    Story.when(wallet, new GrantMonthlyCredits({ period: '2026-11', monthly: 10 })),
    Story.then(wallet),
    Story.when(wallet, new GrantMonthlyCredits({ period: '2026-10', monthly: 10 })),
    Story.rejected(new StaleCreditGrant({ current: '2026-11' })),
    Story.state(wallet, (state) => expect(state.reservations[operationId]?.fromSubscription).toBe(8)),
  ),
)

it.effect('requires trusted service authority for wallet mutations', () =>
  story(
    Story.provide(CurrentActor, { userId: owner, service: false }),
    Story.when(wallet, new GrantPurchasedCredits({ paymentId: 'fake', amount: 100 })),
    Story.rejected(new NotAuthorized()),
    Story.provide(CurrentActor, { userId: UserId.make('usr_other'), service: true }),
    Story.when(wallet, new GrantMonthlyCredits({ period: '2026-10', monthly: 100 })),
    Story.rejected(new NotAuthorized()),
    Story.when(wallet, new ReserveCredits({ ...noAllowance, operationId, fingerprint, amount: 1 })),
    Story.rejected(new NotAuthorized()),
    Story.when(wallet, new SettleCredits({ operationId, outcome: 'refunded' })),
    Story.rejected(new NotAuthorized()),
  ),
)

it.effect('spends the free allowance first, resets it each day and returns it only on the same day', () => {
  const tomorrow = '2026-10-30'
  const first = new ReserveCredits({ operationId, fingerprint, amount: 3, day: today, dailyAllowance: 5 })
  const second = new ReserveCredits({
    operationId: OperationId.make('generation-two'),
    fingerprint,
    amount: 4,
    day: today,
    dailyAllowance: 5,
  })
  const third = new ReserveCredits({
    operationId: OperationId.make('generation-three'),
    fingerprint,
    amount: 2,
    day: tomorrow,
    dailyAllowance: 5,
  })
  return story(
    service,
    Story.given(wallet, initialGrant),
    Story.when(wallet, first, { commandId: reserveCommandId(first) }),
    Story.then(
      wallet,
      new CreditsReserved({
        operationId,
        fingerprint,
        day: today,
        fromDaily: 3,
        dailyAfter: 2,
        fromSubscription: 0,
        fromPurchased: 0,
        subscriptionAfter: 10,
        purchasedAfter: 0,
      }),
    ),
    // Two left today; the rest comes from the subscription.
    Story.when(wallet, second, { commandId: reserveCommandId(second) }),
    Story.then(
      wallet,
      new CreditsReserved({
        operationId: second.operationId,
        fingerprint,
        day: today,
        fromDaily: 2,
        dailyAfter: 0,
        fromSubscription: 2,
        fromPurchased: 0,
        subscriptionAfter: 8,
        purchasedAfter: 0,
      }),
    ),
    Story.when(wallet, refund, { commandId: settleCommandId(refund) }),
    Story.then(
      wallet,
      new CreditsSettled({
        operationId,
        outcome: 'refunded',
        fromDaily: 3,
        dailyAfter: 3,
        fromSubscription: 0,
        fromPurchased: 0,
        subscriptionAfter: 8,
        purchasedAfter: 0,
      }),
    ),
    // A new day starts from the full allowance, whatever was left yesterday.
    Story.when(wallet, third, { commandId: reserveCommandId(third) }),
    Story.then(
      wallet,
      new CreditsReserved({
        operationId: third.operationId,
        fingerprint,
        day: tomorrow,
        fromDaily: 2,
        dailyAfter: 3,
        fromSubscription: 0,
        fromPurchased: 0,
        subscriptionAfter: 8,
        purchasedAfter: 0,
      }),
    ),
    // Yesterday's hold refunds its subscription part; today's allowance does not grow from it.
    Story.when(wallet, new SettleCredits({ operationId: second.operationId, outcome: 'refunded' })),
    Story.then(
      wallet,
      new CreditsSettled({
        operationId: second.operationId,
        outcome: 'refunded',
        fromDaily: 2,
        dailyAfter: 3,
        fromSubscription: 2,
        fromPurchased: 0,
        subscriptionAfter: 10,
        purchasedAfter: 0,
      }),
    ),
  )
})

it.effect('holds a free account to its daily allowance, and a retry after midnight to its first day', () => {
  const free = new ReserveCredits({ operationId, fingerprint, amount: 5, day: today, dailyAllowance: 5 })
  return story(
    service,
    Story.when(wallet, new ReserveCredits({ operationId, fingerprint, amount: 6, day: today, dailyAllowance: 5 })),
    Story.rejected(new InsufficientCredits({ available: 5, required: 6 })),
    Story.when(wallet, free, { commandId: reserveCommandId(free) }),
    Story.then(
      wallet,
      new CreditsReserved({
        operationId,
        fingerprint,
        day: today,
        fromDaily: 5,
        dailyAfter: 0,
        fromSubscription: 0,
        fromPurchased: 0,
        subscriptionAfter: 0,
        purchasedAfter: 0,
      }),
    ),
    // The same reservation redelivered tomorrow is the same command: no second hold, no new allowance.
    Story.when(
      wallet,
      new ReserveCredits({ operationId, fingerprint, amount: 5, day: '2026-10-30', dailyAllowance: 5 }),
      { commandId: reserveCommandId(free) },
    ),
    Story.then(wallet),
    Story.state(wallet, (state) => expect(state.daily).toEqual({ day: today, remaining: 0 })),
  )
})
