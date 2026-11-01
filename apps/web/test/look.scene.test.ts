import { LookId, type Look as LookContract } from '@styld/protocol'
import { click, Command, expect, given, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage } from './AppFixtures.ts'
import { init as initLook, Message as LookMessage, ShareLook, Shown } from '../src/page/Look.ts'
import { view } from '../src/View.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

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
const lookPage = withPage(at(`/looks/${lookId}`, { signedIn: true }), lenses.look, () =>
  modifyFields(initLook(lookId), { shown: () => Shown.Loaded({ look: weekend }) }),
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
