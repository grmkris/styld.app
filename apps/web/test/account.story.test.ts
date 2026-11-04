import { Profile } from '@styld/protocol'
import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { Arrival, Checkout, enter, init, Message, paidReads, update } from '../src/page/Account.ts'
import { ProfileData } from '../src/page/ProfileRead.ts'

const nika = Schema.decodeUnknownSync(Profile)({
  handle: 'nika.kovac',
  name: 'Nika',
  city: null,
  bio: null,
  tone: 'sand',
  published: true,
  check: null,
})

describe('the account’s profile line', () => {
  test('a read that fails keeps the profile already shown; Try again reads it again', () => {
    const shown = update(init(), Message.SucceededReadProfile({ profile: nika })).model
    const failed = update(shown, Message.FailedReadProfile()).model
    expect(failed.profile).toEqual(ProfileData.Stale({ error: 'Unavailable', data: nika }))
    const retried = update(failed, Message.ClickedRetryProfile())
    expect(retried.model.profile).toEqual(ProfileData.Refreshing({ data: nika }))
    expect(retried.commands?.map(({ name }) => name)).toEqual(['ReadProfile'])
  })

  test('a first read that fails says so', () => {
    expect(update(init(), Message.FailedReadProfile()).model.profile).toEqual(
      ProfileData.Failure({ error: 'Unavailable' }),
    )
  })
})

const names = (commands: ReadonlyArray<{ readonly name: string }> | undefined) =>
  (commands ?? []).map(({ name }) => name)

describe('the account’s credits', () => {
  const waiting = { remaining: 40, daily: 100, premiumUntil: null, premiumAvailable: true }
  const premium = { remaining: 440, daily: 500, premiumUntil: '2026-11-11T18:00:00.000Z', premiumAvailable: true }

  test('back from the checkout, reads the credits again until the week shows', () => {
    const entered = enter(true)(init())
    expect(entered.model.arrival).toEqual(Arrival.Paid({ readsLeft: paidReads }))
    expect(names(entered.commands)).toEqual(expect.arrayContaining(['ReadProfile', 'ReadCredits']))
    const first = update(entered.model, Message.SucceededReadCredits({ credits: waiting }))
    expect(names(first.commands)).toEqual(['ReadCreditsSoon'])
    expect(first.model.arrival).toEqual(Arrival.Paid({ readsLeft: paidReads - 1 }))
    const shown = update(first.model, Message.SucceededReadCredits({ credits: premium }))
    expect(names(shown.commands)).toEqual([])
  })

  test('stops reading again once the reads run out', () => {
    const last = update(
      { ...init(), arrival: Arrival.Paid({ readsLeft: 0 }) },
      Message.SucceededReadCredits({ credits: waiting }),
    )
    expect(names(last.commands)).toEqual([])
  })

  test('an ordinary visit reads the credits once', () => {
    const entered = enter(false)(init())
    expect(entered.model.arrival).toEqual(Arrival.Plain())
    expect(names(update(entered.model, Message.SucceededReadCredits({ credits: waiting })).commands)).toEqual([])
  })

  test('the premium week opens one checkout at a time', () => {
    const opening = update(init(), Message.ClickedPremiumWeek())
    expect(names(opening.commands)).toEqual(['OpenCheckout'])
    expect(opening.model.checkout).toEqual(Checkout.Opening())
    expect(names(update(opening.model, Message.ClickedPremiumWeek()).commands)).toEqual([])
    expect(update(opening.model, Message.FailedOpenCheckout()).model.checkout).toEqual(Checkout.Failed())
  })
})
