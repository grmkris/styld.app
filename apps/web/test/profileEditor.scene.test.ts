import { catalogVersion } from '@styld/i18n'
import { expect, given, role, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Session, init, update } from '../src/App.ts'
import { view } from '../src/View.ts'

const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }

const opened = modifyFields(
  init({
    locale: 'en',
    catalogVersion,
    timeZone: 'UTC',
    referenceTime: 0,
    pathname: '/profile',
    origin: 'https://styld.test',
    telemetryConsent: 'denied',
  }).model,
  { session: () => Session.SignedIn({ claims }) },
)

describe('the profile editor', () => {
  test('while the profile loads, its shape holds the page and a status says it is loading', () => {
    scene(
      { update, view },
      given(opened),
      expect(role('status')).toHaveText('Loading…'),
      expect(role('textbox', { name: 'Name' })).not.toExist(),
    )
  })
})
