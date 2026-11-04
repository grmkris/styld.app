import { click, Command, expect, given, role, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Message, ReadSession, Session, update } from '../src/App.ts'
import { ReadYou } from '../src/You.ts'
import { view } from '../src/View.ts'
import { at, claims } from './AppFixtures.ts'

describe('the masthead', () => {
  test('Ask opens the stylist directly, while keyword search stays in Wardrobe', () => {
    scene(
      { update, view },
      given(at('/wardrobe', { signedIn: true })),
      expect(role('link', { name: 'Ask' })).toHaveAttr('href', '/ask/stylist'),
      expect(role('link', { name: 'Search your wardrobe' })).toHaveAttr('href', '/ask'),
    )
    scene(
      { update, view },
      given(at('/ask/stylist', { signedIn: true })),
      expect(role('link', { name: 'Back' })).toHaveAttr('href', '/wardrobe'),
      expect(role('searchbox')).not.toExist(),
      expect(role('textbox', { name: 'Message to Styld' })).toExist(),
    )
  })

  test('a session that could not be read offers to read it again, rather than an empty bar', () => {
    scene(
      { update, view },
      given(modifyFields(at('/@nika.kovac', { signedIn: false }), { session: () => Session.Unavailable() })),
      click(role('button', { name: 'Your account could not be reached. Try again' })),
      Command.resolve(ReadSession, Message.ReceivedSession({ claims })),
      Command.resolve(ReadYou, Message.FailedReadYou()),
      expect(role('link', { name: 'Account' })).toExist(),
    )
  })
})
