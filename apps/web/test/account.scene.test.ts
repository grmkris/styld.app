import { all, click, Command, expect, first, given, inside, nth, role, scene, tap, textContent } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { expect as assert, describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage } from './AppFixtures.ts'
import * as Account from '../src/page/Account.ts'
import { ProfileData } from '../src/page/ProfileRead.ts'
import type { CreditBalance } from '@styld/protocol'
import { view } from '../src/View.ts'
import { You } from '../src/You.ts'

const accountWith = (account: Account.Model) =>
  withPage(at('/account', { signedIn: true }), lenses.account, () => account)

const balance = (fields: Partial<CreditBalance>): CreditBalance => ({
  remaining: 2,
  daily: 0,
  free: 2,
  membership: null,
  plansAvailable: true,
  manageable: false,
  ...fields,
})
const member = (membership: CreditBalance['membership'], manageable = true) =>
  balance({ remaining: 440, daily: 500, free: 0, membership, manageable })
const withCredits = (credits: CreditBalance, account = Account.init()) =>
  accountWith(modifyFields(account, { credits: () => Account.CreditsData.Success({ data: credits }) }))

describe('the account page', () => {
  test('shows you in the bar as your profile does: its initials, once it is read', () => {
    const named = modifyFields(accountWith(Account.init()), {
      you: () => You.Known({ name: 'Kris (preview)', tone: 'sage' }),
    })
    scene({ update, view }, given(named), expect(role('link', { name: 'Account' })).toHaveText('KP'))
  })

  test('puts Sign out under who you are, before your profile and the assistants’ setup', () => {
    for (const [locale, signOut, assistants] of [
      ['en', 'Sign out', 'Use Styld in ChatGPT or Claude'],
      ['sl', 'Odjava', 'Uporabi Styld v ChatGPT ali Claudu'],
    ] as const) {
      scene(
        { update, view },
        given(withPage(at('/account', { signedIn: true, locale }), lenses.account, () => Account.init())),
        // The page's first control, and above every section: no heading of one comes before it.
        inside(role('main'), expect(first(all.role('button'))).toHaveText(signOut)),
        tap(({ html }) => {
          const words = textContent(html)
          assert(words.indexOf(signOut)).toBeGreaterThan(-1)
          assert(words.indexOf(signOut)).toBeLessThan(words.indexOf(assistants))
          assert(words.indexOf(signOut)).toBeLessThan(
            words.indexOf(locale === 'en' ? 'Public profile' : 'Javni profil'),
          )
        }),
      )
    }
  })

  test('says when the profile did not load, and reads it again on Try again', () => {
    scene(
      { update, view },
      given(
        accountWith(modifyFields(Account.init(), { profile: () => ProfileData.Failure({ error: 'Unavailable' }) })),
      ),
      expect(role('alert')).toHaveText("Your profile didn't load."),
      click(role('button', { name: 'Try again' })),
      Command.resolve(Account.ReadProfile, Account.Message.FailedReadProfile()),
      expect(role('alert')).toHaveText("Your profile didn't load."),
    )
  })

  test('without a plan, shows the free cut-outs left and lists the four plans, each opening Dodo’s checkout', () => {
    scene(
      { update, view },
      given(withCredits(balance({}))),
      expect(role('heading', { name: 'Plans' })).toExist(),
      expect(first(all.text('2 of your 3 free cut-outs left'))).toExist(),
      expect(nth(all.selector('dt'), 3)).toHaveText('Lifetime'),
      expect(first(all.text('$4.99 once, for 7 days'))).toExist(),
      expect(first(all.text('$20 a month, until you cancel'))).toExist(),
      expect(first(all.text('$200 a year, until you cancel'))).toExist(),
      expect(first(all.text('$349 once, never ends'))).toExist(),
      expect(role('button', { name: 'Manage subscription' })).not.toExist(),
      click(nth(all.role('button', { name: 'Choose' }), 2)),
      Command.expectExact(Account.OpenCheckout),
      expect(first(all.role('button', { name: 'Choose' }))).toHaveAttr('aria-disabled', 'true'),
      Command.resolve(Account.OpenCheckout, Account.Message.FailedOpenCheckout()),
      expect(role('alert')).toHaveText("Styld couldn't open the payment page just now. Try again in a moment."),
    )
  })

  test('a stage that sells no plans shows the credits only', () => {
    scene(
      { update, view },
      given(withCredits(balance({ plansAvailable: false }))),
      expect(first(all.text('2 of your 3 free cut-outs left'))).toExist(),
      expect(role('button', { name: 'Choose' })).not.toExist(),
    )
  })

  test('a subscriber sees the plan renewing and Manage subscription, which opens the portal', () => {
    scene(
      { update, view },
      given(withCredits(member({ plan: 'monthly', until: '2026-12-05T18:00:00.000Z', renews: true }))),
      expect(first(all.text('440 of 500 credits left today'))).toExist(),
      expect(first(all.text('Month, renews on 5 December'))).toExist(),
      click(role('button', { name: 'Manage subscription' })),
      Command.expectExact(Account.OpenPortal),
      Command.resolve(Account.OpenPortal, Account.Message.FailedOpenPortal()),
      expect(role('alert')).toHaveText("Styld couldn't open your subscription page just now. Try again in a moment."),
    )
  })

  test('a lifetime member sees Lifetime and no plans to choose', () => {
    scene(
      { update, view },
      given(withCredits(member({ plan: 'lifetime', until: null, renews: false }, false))),
      expect(first(all.text('Lifetime, never ends'))).toExist(),
      expect(role('button', { name: 'Choose' })).not.toExist(),
    )
  })

  test('back from paying, says the payment arrived until the plan shows, then its end', () => {
    const paid = modifyFields(Account.init(), { arrival: () => Account.Arrival.Paid({ readsLeft: 3 }) })
    scene(
      { update, view },
      given(withCredits(balance({}), paid)),
      expect(role('status')).toHaveText('Payment received. Your plan starts in a moment.'),
    )
    scene(
      { update, view },
      given(withCredits(member({ plan: 'week', until: '2026-11-11T18:00:00.000Z', renews: false }), paid)),
      expect(first(all.text('440 of 500 credits left today'))).toExist(),
      expect(first(all.text('Week until 11 November'))).toExist(),
    )
  })
})
