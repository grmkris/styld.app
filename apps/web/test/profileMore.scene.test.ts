import { Dialog } from '@foldkit/ui'
import { Relation } from '@styld/protocol'
import { Schema } from 'effect'
import { click, Command, expect, given, Mount, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'
import { Message, update } from '../src/App.ts'
import { FocusMoreTitle, Message as PeopleMessage, SetBlocked } from '../src/page/People.ts'
import { Message as VisitMessage, Shown } from '../src/page/Visit.ts'
import { view } from '../src/View.ts'
import { sceneSheetMoved, sceneSheetOpened } from './SheetFixtures.ts'
import { nika, signedIn, visiting } from './VisitFixtures.ts'

const relation = (blocked: boolean) =>
  Schema.decodeUnknownSync(Relation)({ handle: 'nika.kovac', following: false, blocked })

/** Nika's profile, signed in, once it is known the visitor does not follow or block her. */
const known = () =>
  update(
    signedIn(visiting('/@nika.kovac', Shown.Person({ profile: nika }))),
    Message.GotVisitMessage({
      message: VisitMessage.GotPeopleMessage({
        message: PeopleMessage.SucceededLoadRelation({ relation: relation(false) }),
      }),
    }),
  ).model

const openMore = [
  click(role('button', { name: 'More options' })),
  Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
  Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
  ...sceneSheetOpened,
] as const

describe("someone's profile, signed in", () => {
  test('keeps Report and Block behind More, and asks a report through in the sheet under its title', () => {
    scene(
      { update, view },
      given(known()),
      expect(role('button', { name: 'Follow' })).toHaveAttr('aria-pressed', 'false'),
      expect(role('button', { name: 'Report profile' })).toBeAbsent(),
      ...openMore,
      expect(role('heading', { name: '@nika.kovac' })).toExist(),
      expect(role('button', { name: 'Block @nika.kovac' })).toExist(),
      click(role('button', { name: 'Report profile' })),
      Command.resolve(FocusMoreTitle, PeopleMessage.CompletedFocusMoreTitle()),
      expect(role('heading', { name: 'Report profile' })).toExist(),
      expect(text("What's wrong with it?")).toExist(),
      expect(role('radio', { name: 'Spam or a scam' })).toExist(),
      expect(role('button', { name: 'Send report' })).toHaveAttr('aria-disabled', 'true'),
    )
  })

  test('blocking asks in the sheet, waits there, then closes and says the person is blocked', () => {
    scene(
      { update, view },
      given(known()),
      ...openMore,
      click(role('button', { name: 'Block @nika.kovac' })),
      Command.resolve(FocusMoreTitle, PeopleMessage.CompletedFocusMoreTitle()),
      expect(role('heading', { name: 'Block @nika.kovac?' })).toExist(),
      click(role('button', { name: 'Block' })),
      expect(role('button', { name: 'Block' })).toHaveAttr('aria-disabled', 'true'),
      // Follow does not take the block's wait.
      expect(role('button', { name: 'Follow' })).toHaveAttr('aria-busy', 'false'),
      Command.resolve(
        SetBlocked({ handle: 'nika.kovac', blocked: true }),
        PeopleMessage.SucceededSetRelation({ relation: relation(true) }),
      ),
      ...sceneSheetMoved(2),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
      Mount.expectEnded(Dialog.AcquireResources),
      expect(role('status')).toHaveText('@nika.kovac is blocked. You can unblock them under More options.'),
      expect(role('button', { name: 'Follow' })).toBeAbsent(),
    )
  })
})
