import { catalogVersion } from '@styld/i18n'
import { LookId, type Look as LookContract } from '@styld/protocol'
import { click, Command, expect, given, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { init, Session, update } from '../src/App.ts'
import { init as initLook, Message as LookMessage, ShareLook, Shown } from '../src/page/Look.ts'
import { view } from '../src/View.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }
const lookId = `lk_${'a'.repeat(22)}`
const tee = pieceFixture('tee', { name: 'White tee' })
const weekend: LookContract = {
  id: LookId.make(lookId),
  name: 'Weekend',
  occasion: null,
  pieces: [tee, pieceFixture('jeans', { type: 'trousers' })],
  shared: false,
  check: null,
  createdAt: '2026-10-29T12:00:00.000Z',
}
const lookPage = modifyFields(
  init({
    locale: 'en',
    catalogVersion,
    timeZone: 'UTC',
    referenceTime: 0,
    pathname: `/looks/${lookId}`,
    origin: 'https://styld.test',
    telemetryConsent: 'denied',
  }).model,
  {
    session: () => Session.SignedIn({ claims }),
    look: () => modifyFields(initLook(lookId), { shown: () => Shown.Loaded({ look: weekend }) }),
  },
)

describe('a look of your own', () => {
  test('says under its name who sees it, lists its pieces, and goes public with the switch', () => {
    scene(
      { update, view },
      given(lookPage),
      expect(text('Only you can see it')).toExist(),
      expect(role('heading', { name: 'The pieces' })).toExist(),
      expect(role('link', { name: /White tee/ })).toHaveAttr('href', `/wardrobe/${tee.id}`),
      expect(role('switch', { name: 'Public' })).toHaveAttr('aria-checked', 'false'),
      click(role('switch', { name: 'Public' })),
      Command.resolve(
        ShareLook({ lookId, shared: true }),
        LookMessage.SucceededShareLook({ look: { ...weekend, shared: true } }),
      ),
      expect(text('Public, anyone with the link can see it')).toExist(),
      expect(role('switch', { name: 'Public' })).toHaveAttr('aria-checked', 'true'),
    )
  })
})
