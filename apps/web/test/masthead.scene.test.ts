import { click, Command, expect, given, role, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Message, ReadSession, Session, update } from '../src/App.ts'
import { ReadYou } from '../src/You.ts'
import { view } from '../src/View.ts'
import { at, claims } from './AppFixtures.ts'

describe('the masthead', () => {
  test('a session that could not be read leaves a way on and reads it again, rather than an empty bar', () => {
    scene(
      { update, view },
      given(modifyFields(at('/explore', { signedIn: false }), { session: () => Session.Unavailable() })),
      click(role('button', { name: 'Your account could not be reached. Try again' })),
      Command.resolve(ReadSession, Message.ReceivedSession({ claims })),
      Command.resolve(ReadYou, Message.FailedReadYou()),
      expect(role('link', { name: 'Account' })).toExist(),
    )
  })
})
