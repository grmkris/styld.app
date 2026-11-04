import * as Domain from '@alchemy.run/domain'
import { Story } from '@alchemy.run/domain/Story'
import { describe, it } from '@effect/vitest'
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
const reservedFour = new CreditsReserved({ operationId, day: today, amount: 4, dailyAfter: 6, dailyAllowance: 10 })
const refund = new SettleCredits({ operationId, outcome: 'refunded' })
const consume = new SettleCredits({ operationId, outcome: 'consumed' })

it('the declared model is well defined', () => expect(Domain.verify(Styld)).toEqual([]))

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
    Story.state(wallet, (state) =>
      expect(state).toEqual({ daily: { day: today, remaining: 6, allowance: 10 }, reservations: {} }),
    ),
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
    Story.then(
      wallet,
      new CreditsReserved({
        operationId: second.operationId,
        day: today,
        amount: 3,
        dailyAfter: 3,
        dailyAllowance: 10,
      }),
    ),
    Story.when(wallet, refund),
    Story.then(wallet, new CreditsSettled({ operationId, outcome: 'refunded', amount: 4, dailyAfter: 7 })),
    // A new day starts from the full allowance, whatever was left yesterday.
    Story.when(wallet, third),
    Story.then(
      wallet,
      new CreditsReserved({
        operationId: third.operationId,
        day: tomorrow,
        amount: 2,
        dailyAfter: 8,
        dailyAllowance: 10,
      }),
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
    Story.then(wallet, new CreditsReserved({ operationId, day: today, amount: 10, dailyAfter: 0, dailyAllowance: 10 })),
    // The same reservation redelivered tomorrow is the same command: no second hold, no new allowance.
    Story.when(wallet, new ReserveCredits({ operationId, amount: 10, day: tomorrow, dailyAllowance: 10 }), {
      commandId: reserveCommandId(all),
    }),
    Story.then(wallet),
    Story.state(wallet, (state) => expect(state.daily).toEqual({ day: today, remaining: 0, allowance: 10 })),
  )
})

const reserve = (name: string, amount: number, day: string, dailyAllowance: number) =>
  new ReserveCredits({ operationId: OperationId.make(name), amount, day, dailyAllowance })
const reserved = (name: string, amount: number, day: string, dailyAfter: number, dailyAllowance: number) =>
  new CreditsReserved({ operationId: OperationId.make(name), day, amount, dailyAfter, dailyAllowance })

describe('premium', () => {
  const free = 100
  const premium = 500

  it.effect('premium bought mid-day tops today up by the difference', () =>
    story(
      Story.when(wallet, reserve('one', 30, today, free)),
      Story.then(wallet, reserved('one', 30, today, 70, free)),
      Story.when(wallet, reserve('two', 10, today, premium)),
      Story.then(wallet, reserved('two', 10, today, 460, premium)),
      // The top-up is given once: the same allowance again adds nothing.
      Story.when(wallet, reserve('three', 10, today, premium)),
      Story.then(wallet, reserved('three', 10, today, 450, premium)),
    ),
  )

  it.effect('premium bought after spending everything opens the difference', () =>
    story(
      Story.when(wallet, reserve('one', free, today, free)),
      Story.then(wallet, reserved('one', free, today, 0, free)),
      Story.when(wallet, reserve('two', 1, today, free)),
      Story.rejected(new InsufficientCredits({ available: 0, required: 1 })),
      Story.when(wallet, reserve('two', 400, today, premium)),
      Story.then(wallet, reserved('two', 400, today, 0, premium)),
    ),
  )

  it.effect('a new day inside premium starts from the premium allowance', () =>
    story(
      Story.when(wallet, reserve('one', 450, today, premium)),
      Story.then(wallet, reserved('one', 450, today, 50, premium)),
      Story.when(wallet, reserve('two', 20, tomorrow, premium)),
      Story.then(wallet, reserved('two', 20, tomorrow, 480, premium)),
    ),
  )

  it.effect('premium ending mid-day takes nothing back, and the next day is free again', () =>
    story(
      Story.when(wallet, reserve('one', 100, today, premium)),
      Story.then(wallet, reserved('one', 100, today, 400, premium)),
      Story.when(wallet, reserve('two', 300, today, free)),
      Story.then(wallet, reserved('two', 300, today, 100, premium)),
      Story.when(wallet, reserve('three', 101, tomorrow, free)),
      Story.rejected(new InsufficientCredits({ available: free, required: 101 })),
    ),
  )

  it.effect('events written before the allowance was recorded replay as the free allowance', () =>
    story(
      Story.given(
        wallet,
        new CreditsReserved({ operationId: OperationId.make('old'), day: today, amount: 40, dailyAfter: 60 }),
      ),
      Story.state(wallet, (state) => expect(state.daily).toEqual({ day: today, remaining: 60 })),
      Story.when(wallet, reserve('new', 10, today, premium)),
      Story.then(wallet, reserved('new', 10, today, 450, premium)),
    ),
  )
})

const reservedFree = (
  name: string,
  amount: number,
  day: string,
  spent: { readonly dailyAfter: number; readonly dailyAllowance: number; fromFree: number; freeAfter: number },
) => new CreditsReserved({ operationId: OperationId.make(name), day, amount, ...spent })
const refundOf = (name: string) => new SettleCredits({ operationId: OperationId.make(name), outcome: 'refunded' })

describe('the free credits and a non-member allowance of 0 (owner, 4 November 2026)', () => {
  const freeCredits = 3
  const member = 500
  const reserveFree = (name: string, amount: number, day: string, dailyAllowance: number) =>
    new ReserveCredits({ operationId: OperationId.make(name), amount, day, dailyAllowance, freeCredits })
  const none = { dailyAfter: 0, dailyAllowance: 0 }

  it.effect('a non-member spends the 3 free credits once, then is refused every day after', () =>
    story(
      Story.when(wallet, reserveFree('one', 1, today, 0)),
      Story.then(wallet, reservedFree('one', 1, today, { ...none, fromFree: 1, freeAfter: 2 })),
      Story.when(wallet, reserveFree('two', 2, today, 0)),
      Story.then(wallet, reservedFree('two', 2, today, { ...none, fromFree: 2, freeAfter: 0 })),
      Story.when(wallet, reserveFree('three', 1, today, 0)),
      Story.rejected(new InsufficientCredits({ available: 0, required: 1 })),
      // A new day brings no allowance and no new free credits.
      Story.when(wallet, reserveFree('four', 1, tomorrow, 0)),
      Story.rejected(new InsufficientCredits({ available: 0, required: 1 })),
      Story.state(wallet, (state) => expect(state.free).toBe(0)),
    ),
  )

  it.effect('a refund gives the free credits back, on any day', () =>
    story(
      Story.when(wallet, reserveFree('one', 3, today, 0)),
      Story.then(wallet, reservedFree('one', 3, today, { ...none, fromFree: 3, freeAfter: 0 })),
      Story.when(wallet, refundOf('one')),
      Story.then(
        wallet,
        new CreditsSettled({
          operationId: OperationId.make('one'),
          outcome: 'refunded',
          amount: 3,
          dailyAfter: 0,
          freeAfter: 3,
        }),
      ),
      Story.when(wallet, reserveFree('two', 1, today, 0)),
      Story.then(wallet, reservedFree('two', 1, today, { ...none, fromFree: 1, freeAfter: 2 })),
      Story.when(wallet, reserveFree('three', 1, tomorrow, 0)),
      Story.then(wallet, reservedFree('three', 1, tomorrow, { ...none, fromFree: 1, freeAfter: 1 })),
      // Yesterday's hold refunded today still returns its free credit.
      Story.when(wallet, refundOf('two')),
      Story.then(
        wallet,
        new CreditsSettled({
          operationId: OperationId.make('two'),
          outcome: 'refunded',
          amount: 1,
          dailyAfter: 0,
          freeAfter: 2,
        }),
      ),
      // A consumed hold keeps them spent.
      Story.when(wallet, new SettleCredits({ operationId: OperationId.make('three'), outcome: 'consumed' })),
      Story.then(
        wallet,
        new CreditsSettled({ operationId: OperationId.make('three'), outcome: 'consumed', amount: 1, dailyAfter: 0 }),
      ),
      Story.state(wallet, (state) => expect(state.free).toBe(2)),
    ),
  )

  it.effect('a member spends the day first, then the free credits, and a refund returns each part', () =>
    story(
      Story.when(wallet, reserveFree('one', 499, today, member)),
      Story.then(
        wallet,
        reservedFree('one', 499, today, { dailyAfter: 1, dailyAllowance: member, fromFree: 0, freeAfter: 3 }),
      ),
      Story.when(wallet, reserveFree('two', 3, today, member)),
      Story.then(
        wallet,
        reservedFree('two', 3, today, { dailyAfter: 0, dailyAllowance: member, fromFree: 2, freeAfter: 1 }),
      ),
      Story.when(wallet, refundOf('two')),
      Story.then(
        wallet,
        new CreditsSettled({
          operationId: OperationId.make('two'),
          outcome: 'refunded',
          amount: 3,
          dailyAfter: 1,
          freeAfter: 3,
        }),
      ),
    ),
  )

  it.effect('a Wallet written before the free credits gets all 3 with its first reservation that brings them', () =>
    story(
      Story.given(
        wallet,
        new CreditsReserved({ operationId: OperationId.make('old'), day: today, amount: 40, dailyAfter: 60 }),
        new CreditsSettled({ operationId: OperationId.make('old'), outcome: 'consumed', amount: 40, dailyAfter: 60 }),
      ),
      Story.state(wallet, (state) => expect(state.free).toBeUndefined()),
      Story.when(wallet, reserveFree('new', 2, tomorrow, 0)),
      Story.then(wallet, reservedFree('new', 2, tomorrow, { ...none, fromFree: 2, freeAfter: 1 })),
    ),
  )
})
