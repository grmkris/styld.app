import { catalogVersion } from '@styld/i18n'
import { expect, given, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { init, Session, update } from '../src/App.ts'
import { SavedData } from '../src/page/Looks.ts'
import { view } from '../src/View.ts'

const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }
const looksWith = (saved: SavedData) =>
  modifyFields(
    init({
      locale: 'en',
      catalogVersion,
      timeZone: 'UTC',
      referenceTime: 0,
      pathname: '/looks',
      origin: 'https://styld.test',
      telemetryConsent: 'denied',
    }).model,
    { session: () => Session.SignedIn({ claims }), looks: () => ({ saved }) },
  )

describe('the looks tab', () => {
  test('with no looks yet, says where one is made and leads there', () => {
    scene(
      { update, view },
      given(looksWith(SavedData.Success({ data: [] }))),
      expect(role('heading', { name: 'No looks yet' })).toExist(),
      expect(text("Lay pieces out on a board's table and save it as a look, or ask Styld for one.")).toExist(),
      expect(role('link', { name: 'Go to Boards' })).toHaveAttr('href', '/boards'),
    )
  })
})
