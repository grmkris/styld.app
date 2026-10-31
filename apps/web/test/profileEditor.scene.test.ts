import { Profile } from '@styld/protocol'
import { Schema } from 'effect'
import { change, expect, given, role, scene, type, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { Message as EditorMessage } from '../src/page/ProfileEditor.ts'
import { update as editorUpdate, init as editorInit } from '../src/page/ProfileEditor.ts'
import { view } from '../src/View.ts'
import { signedInAt } from './AppFixtures.ts'

const opened = signedInAt('/profile')
const ana = Schema.decodeUnknownSync(Profile)({
  handle: 'ana',
  name: 'Ana Novak',
  city: 'Ljubljana',
  bio: 'Linen in summer.',
  tone: 'sage',
  published: true,
  check: { state: 'passed', hidden: false, reason: null },
})
const ready = modifyFields(opened, {
  profile: () => editorUpdate(editorInit(), EditorMessage.SucceededLoadProfile({ profile: ana })).model,
})

describe('the profile editor', () => {
  test('while the profile loads, its shape holds the page and a status says it is loading', () => {
    scene(
      { update, view },
      given(opened),
      expect(role('status')).toHaveText('Loading…'),
      expect(role('textbox', { name: 'Name' })).not.toExist(),
    )
  })

  test('says under the title where the profile stands, and ends the form with Save', () => {
    scene(
      { update, view },
      given(ready),
      expect(text('@ana, public')).toExist(),
      expect(role('link', { name: 'View your page' })).toHaveAttr('href', '/@ana'),
      expect(role('button', { name: 'Make it private' })).toExist(),
      expect(role('group', { name: 'Avatar colour' })).toExist(),
      expect(role('radio', { name: 'Sage' })).toBeChecked(),
      change(role('radio', { name: 'Clay' }), 'clay'),
      expect(role('radio', { name: 'Clay' })).toBeChecked(),
      expect(text('16/160')).toExist(),
      type(role('textbox', { name: /^Bio/ }), 'Linen in summer, wool after.'),
      expect(text('28/160')).toExist(),
      expect(role('button', { name: 'Save' })).toExist(),
    )
  })
})
