import { Story } from '@alchemy.run/domain/Story'
import { it } from '@effect/vitest'
import { expect } from 'vitest'
import { OperationId, UserId } from '../src/Identity.ts'
import { Styld } from '../src/Styld.model.ts'
import {
  CreditsReserved,
  InsufficientCredits,
  ReservationConflict,
  ReserveCredits,
  TooManyReservations,
} from '../src/Wallet/ReserveCredits.command.ts'
import { CreditsSettled, ReservationNotFound, SettleCredits } from '../src/Wallet/SettleCredits.command.ts'
import { Wallet } from '../src/Wallet/Wallet.aggregate.ts'
import { reserveCommandId, settleCommandId } from '../src/Wallet/WalletCommandIds.ts'

const story = Story.make(Styld)
const today = '2026-10-29'
const tomorrow = '2026-10-30'
const owner = UserId.make('usr_alice')
const wallet = Wallet.ref(owner)
const operationId = OperationId.make('generation-one')
const allowance = { day: today, dailyAllowance: 10 }
const reserveFour = new ReserveCredits({ ...allowance, operationId, amount: 4 })
const reservedFour = new CreditsReserved({ operationId, day: today, amount: 4, dailyAfter: 6 })
const refund = new SettleCredits({ operationId, outcome: 'refunded' })
const consume = new SettleCredits({ operationId, outcome: 'consumed' })

// beta.84 has no Domain.verify export. Building the real model exercises its kernel validation.
it.effect('builds the complete declared model', () => story())

it.effect('derived command IDs keep a settled operation from being reserved again', () =>
  story(
    Story.when(wallet, reserveFour, { commandId: reserveCommandId(reserveFour) }),
    Story.then(wallet, reservedFour),
    Story.when(wallet, consume, { commandId: settleCommandId(consume) }),
    Story.then(wallet, new CreditsSettled({ operationId, outcome: 'consumed', amount: 4, dailyAfter: 6 })),
    // A redelivered reservation reuses its receipt: no second hold for a settled operation.
    Story.when(wallet, reserveFour, { commandId: reserveCommandId(reserveFour) }),
    Story.then(wallet),
    // A late refund for the same operation is the same settlement and cannot return consumed credits.
    Story.when(wallet, refund, { commandId: settleCommandId(refund) }),
    Story.then(wallet),
    Story.state(wallet, (state) => expect(state).toEqual({ daily: { day: today, remaining: 6 }, reservations: {} })),
  ),
)

it.effect('a settle that arrives before its reservation is rejected and does not block the later settlement', () =>
  story(
    Story.when(wallet, refund, { commandId: settleCommandId(refund) }),
    Story.rejected(new ReservationNotFound()),
    Story.when(wallet, reserveFour, { commandId: reserveCommandId(reserveFour) }),
    Story.then(wallet, reservedFour),
    // The rejection left no receipt, so the same settle ID now settles the hold.
    Story.when(wallet, refund, { commandId: settleCommandId(refund) }),
    Story.then(wallet, new CreditsSettled({ operationId, outcome: 'refunded', amount: 4, dailyAfter: 10 })),
  ),
)

it.effect('refuses overspend and a changed amount under a pending hold', () =>
  story(
    Story.when(wallet, reserveFour),
    Story.then(wallet, reservedFour),
    Story.when(wallet, new ReserveCredits({ ...allowance, operationId, amount: 5 })),
    Story.rejected(new ReservationConflict()),
    Story.when(
      wallet,
      new ReserveCredits({ ...allowance, operationId: OperationId.make('generation-two'), amount: 7 }),
    ),
    Story.rejected(new InsufficientCredits({ available: 6, required: 7 })),
  ),
)

it.effect('refuses a hold past the most an account may have pending', () =>
  story(
    Story.given(
      wallet,
      ...Array.from(
        { length: 256 },
        (_, index) =>
          new CreditsReserved({
            operationId: OperationId.make(`held-${index}`),
            day: today,
            amount: 0,
            dailyAfter: 10,
          }),
      ),
    ),
    Story.when(wallet, reserveFour),
    Story.rejected(new TooManyReservations()),
  ),
)

it.effect('resets the free allowance each day and returns it only on the same day', () => {
  const second = new ReserveCredits({ ...allowance, operationId: OperationId.make('generation-two'), amount: 3 })
  const third = new ReserveCredits({
    operationId: OperationId.make('generation-three'),
    amount: 2,
    day: tomorrow,
    dailyAllowance: 10,
  })
  return story(
    Story.when(wallet, reserveFour),
    Story.then(wallet, reservedFour),
    Story.when(wallet, second),
    Story.then(wallet, new CreditsReserved({ operationId: second.operationId, day: today, amount: 3, dailyAfter: 3 })),
    Story.when(wallet, refund),
    Story.then(wallet, new CreditsSettled({ operationId, outcome: 'refunded', amount: 4, dailyAfter: 7 })),
    // A new day starts from the full allowance, whatever was left yesterday.
    Story.when(wallet, third),
    Story.then(
      wallet,
      new CreditsReserved({ operationId: third.operationId, day: tomorrow, amount: 2, dailyAfter: 8 }),
    ),
    // Yesterday's hold refunds nothing into today's allowance.
    Story.when(wallet, new SettleCredits({ operationId: second.operationId, outcome: 'refunded' })),
    Story.then(
      wallet,
      new CreditsSettled({ operationId: second.operationId, outcome: 'refunded', amount: 3, dailyAfter: 8 }),
    ),
  )
})

it.effect('holds an account to its daily allowance, and a retry after midnight to its first day', () => {
  const all = new ReserveCredits({ ...allowance, operationId, amount: 10 })
  return story(
    Story.when(wallet, new ReserveCredits({ ...allowance, operationId, amount: 11 })),
    Story.rejected(new InsufficientCredits({ available: 10, required: 11 })),
    Story.when(wallet, all, { commandId: reserveCommandId(all) }),
    Story.then(wallet, new CreditsReserved({ operationId, day: today, amount: 10, dailyAfter: 0 })),
    // The same reservation redelivered tomorrow is the same command: no second hold, no new allowance.
    Story.when(wallet, new ReserveCredits({ operationId, amount: 10, day: tomorrow, dailyAllowance: 10 }), {
      commandId: reserveCommandId(all),
    }),
    Story.then(wallet),
    Story.state(wallet, (state) => expect(state.daily).toEqual({ day: today, remaining: 0 })),
  )
})
