import { Option } from 'effect'
import { expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import * as Stylist from '../src/page/Stylist.ts'
import * as StylistTryOns from '../src/page/StylistTryOns.ts'
import { view } from '../src/View.ts'
import { at, withPage } from './AppFixtures.ts'
import { chatNaming, done } from './TryOnFixtures.ts'

// A try-on Styld started in a chat, through the app's own view: its picture in the reply, opening its own page.

describe('A try-on in a chat with Styld', () => {
  test('shows the drawn picture in the reply, opening the try-on’s own page', () => {
    const cards = StylistTryOns.update(
      StylistTryOns.init(),
      StylistTryOns.Message.SucceededReadTryOn({ tryOn: done }),
    ).model
    const stylist: Stylist.Model = {
      ...Stylist.init(Option.none()),
      open: Option.some(chatNaming([{ _tag: 'TryOn', tryOnId: done.id }])),
      tryOnCards: cards,
    }
    scene(
      { update, view },
      given(withPage(at('/ask/stylist', { signedIn: true }), lenses.stylist, () => stylist)),
      expect(role('link', { name: /Open the try-on/ })).toHaveAttr('href', `/try-on/${done.id}`),
      expect(role('img', { name: 'You in the chosen pieces' })).toExist(),
      expect(text('Drawing…')).not.toExist(),
    )
  })
})
