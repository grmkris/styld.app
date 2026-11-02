import { all, click, Command, expect, first, given, inside, role, scene, tap, textContent } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { expect as assert, describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage } from './AppFixtures.ts'
import * as Account from '../src/page/Account.ts'
import { ProfileData } from '../src/page/ProfileRead.ts'
import { view } from '../src/View.ts'
import { You } from '../src/You.ts'

const accountWith = (account: Account.Model) =>
  withPage(at('/account', { signedIn: true }), lenses.account, () => account)

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
})
