import { catalogVersion } from '@styld/i18n'
import { click, Command, expect, given, role, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Session, init, update } from '../src/App.ts'
import * as Account from '../src/page/Account.ts'
import { view } from '../src/View.ts'
import { You } from '../src/You.ts'

const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }

const accountWith = (account: Account.Model) =>
  modifyFields(
    init({
      locale: 'en',
      catalogVersion,
      timeZone: 'UTC',
      referenceTime: 0,
      pathname: '/account',
      origin: 'https://styld.test',
      telemetryConsent: 'denied',
    }).model,
    { session: () => Session.SignedIn({ claims }), account: () => account },
  )

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
