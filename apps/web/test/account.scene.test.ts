import { click, Command, expect, given, role, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage } from './AppFixtures.ts'
import * as Account from '../src/page/Account.ts'
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

  test('says when the profile did not load, and reads it again on Try again', () => {
    scene(
      { update, view },
      given(accountWith(modifyFields(Account.init(), { profile: () => Account.ProfileState.Failed() }))),
      expect(role('alert')).toHaveText("Your profile didn't load."),
      click(role('button', { name: 'Try again' })),
      Command.resolve(Account.ReadProfile, Account.Message.FailedReadProfile()),
      expect(role('alert')).toHaveText("Your profile didn't load."),
    )
  })
})
