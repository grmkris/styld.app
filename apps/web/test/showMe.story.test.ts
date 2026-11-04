import type { Audience } from '@styld/protocol'
import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import {
  Answer,
  asks,
  init,
  Message,
  OutMessage,
  PreferencesData,
  SaveShowMe,
  shownChoice,
  update,
} from '../src/page/ShowMe.ts'

// Show me (owner, 4 November 2026): Home asks once after sign-in what What's new starts with; the Account page keeps
// the choice. It only reorders, so What's new is read again when the order changes, and only then.

const saved = (showMe: Audience | null, showMeAsked: boolean) =>
  modifyFields(init(), { preferences: () => PreferencesData.Success({ data: { showMe, showMeAsked } }) })

describe('Show me', () => {
  test('asks until answered; the answer is saved, and What’s new reads again in the new order', () => {
    story(
      update,
      given(saved(null, false)),
      model((current) => expect(asks(current)).toBe(true)),
      message(Message.ClickedChoice({ showMe: 'men' })),
      Command.expectExact(SaveShowMe({ showMe: 'men' })),
      model((current) => expect(shownChoice(current)).toEqual(Option.some('men'))),
      Command.resolve(SaveShowMe, Message.SucceededSaveShowMe({ preferences: { showMe: 'men', showMeAsked: true } })),
      expectOutMessage(OutMessage.ChangedShowMe()),
      model((current) => {
        expect(asks(current)).toBe(false)
        expect(shownChoice(current)).toEqual(Option.some('men'))
      }),
    )
  })

  test('a press while an answer is on its way sends nothing', () => {
    story(
      update,
      given(modifyFields(saved(null, false), { answer: () => Answer.Saving({ showMe: 'men' }) })),
      message(Message.ClickedChoice({ showMe: 'women' })),
      message(Message.ClickedNotNow()),
      Command.expectNone(),
      model((current) => expect(shownChoice(current)).toEqual(Option.some('men'))),
    )
  })

  test('“Not now” puts the card away at once, and keeps it away even when that did not save', () => {
    story(
      update,
      given(saved(null, false)),
      message(Message.ClickedNotNow()),
      Command.expectExact(SaveShowMe({ showMe: null })),
      model((current) => expect(asks(current)).toBe(false)),
      Command.resolve(SaveShowMe, Message.FailedSaveShowMe()),
      expectNoOutMessage(),
      model((current) => expect(asks(current)).toBe(false)),
    )
  })

  test('a choice that did not save keeps the card asking, the saved choice shown', () => {
    story(
      update,
      given(saved(null, false)),
      message(Message.ClickedChoice({ showMe: 'women' })),
      Command.resolve(SaveShowMe, Message.FailedSaveShowMe()),
      model((current) => {
        expect(asks(current)).toBe(true)
        expect(Answer.guards.Failed(current.answer)).toBe(true)
        expect(shownChoice(current)).toEqual(Option.some('all'))
      }),
    )
  })

  test('Everything after nothing chosen keeps What’s new in the order it has: nothing to read again', () => {
    story(
      update,
      given(saved(null, true)),
      model((current) => expect(shownChoice(current)).toEqual(Option.some('all'))),
      message(Message.ClickedChoice({ showMe: 'all' })),
      Command.resolve(SaveShowMe, Message.SucceededSaveShowMe({ preferences: { showMe: 'all', showMeAsked: true } })),
      expectNoOutMessage(),
    )
  })
})
