import { all, click, Command, expect, first, given, inside, role, scene, tap, textContent } from 'foldkit/scene'
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
  remaining: 40,
  daily: 100,
  premiumUntil: null,
  premiumAvailable: true,
  ...fields,
})
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

  test('shows today’s credits and offers the premium week, which opens Dodo’s checkout', () => {
    scene(
      { update, view },
      given(withCredits(balance({}))),
      expect(role('heading', { name: 'Credits' })).toExist(),
      expect(first(all.text('40 of 100 credits left today'))).toExist(),
      click(role('button', { name: 'Premium week · $4.99' })),
      Command.expectExact(Account.OpenCheckout),
      expect(role('button', { name: 'Premium week · $4.99' })).toHaveAttr('aria-disabled', 'true'),
      Command.resolve(Account.OpenCheckout, Account.Message.FailedOpenCheckout()),
      expect(role('alert')).toHaveText("Styld couldn't open the payment page just now. Try again in a moment."),
    )
  })

  test('a stage that sells no premium shows the credits only', () => {
    scene(
      { update, view },
      given(withCredits(balance({ premiumAvailable: false }))),
      expect(first(all.text('40 of 100 credits left today'))).toExist(),
      expect(role('button', { name: 'Premium week · $4.99' })).not.toExist(),
    )
  })

  test('back from paying, says the payment arrived until premium shows, then its end', () => {
    const paid = modifyFields(Account.init(), { arrival: () => Account.Arrival.Paid({ readsLeft: 3 }) })
    scene(
      { update, view },
      given(withCredits(balance({}), paid)),
      expect(role('status')).toHaveText('Payment received. Premium starts in a moment.'),
    )
    scene(
      { update, view },
      given(withCredits(balance({ daily: 500, remaining: 440, premiumUntil: '2026-11-11T18:00:00.000Z' }), paid)),
      expect(first(all.text('440 of 500 credits left today'))).toExist(),
      expect(first(all.text('Premium until 11 November'))).toExist(),
    )
  })
})
