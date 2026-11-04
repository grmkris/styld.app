import { FoundBoard } from '@styld/protocol'
import { Schema } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import {
  enter,
  FinishFirstRun,
  init,
  Message,
  OutMessage,
  ReadFirstRun,
  ReadHouseBoards,
  SaveFirstRunBoards,
  SaveFirstRunOccasions,
  SaveFirstRunShowMe,
  Stage,
  Step,
  update,
} from '../src/page/FirstRun.ts'
import { boardItem } from './WhatsNewFixtures.ts'

// The first run over Home (owner, 4 November 2026: everyone once): Show me, boards to save, the occasions they dress
// for, and their first clothes; each answer saves as it is given, and finishing or skipping marks it done.

const lisbon = boardItem('lisbon', 'styld.women')
const found = Schema.decodeUnknownSync(FoundBoard)({ board: lisbon.board, by: lisbon.by, moods: [] })
const stepOf = (current: ReturnType<typeof init>) =>
  Stage.guards.Open(current.stage)
    ? Step.match(current.stage.step, {
        ShowMe: () => 'ShowMe',
        Boards: () => 'Boards',
        Occasions: () => 'Occasions',
        Clothes: () => 'Clothes',
      })
    : 'Closed'

describe('the first run', () => {
  test('opens when the taste says it is not behind the person, and stays closed when it is or cannot be read', () => {
    expect(enter(init()).commands?.map(({ name }) => name)).toEqual([ReadFirstRun.name])
    expect(stepOf(update(init(), Message.SucceededReadTaste({ done: false })).model)).toBe('ShowMe')
    expect(stepOf(update(init(), Message.SucceededReadTaste({ done: true })).model)).toBe('Closed')
    expect(stepOf(update(init(), Message.FailedReadTaste()).model)).toBe('Closed')
  })

  test('goes through every step, saving each answer as it is given, and is done on reaching the clothes', () => {
    story(
      update,
      given({ ...init(), stage: Stage.Open({ step: Step.ShowMe() }) }),
      message(Message.ClickedShowMe({ showMe: 'women' })),
      expectOutMessage(OutMessage.AnsweredShowMe()),
      Command.expectExact(SaveFirstRunShowMe({ showMe: 'women' }), ReadHouseBoards()),
      Command.resolve(SaveFirstRunShowMe, Message.CompletedSave()),
      Command.resolve(ReadHouseBoards, Message.SucceededReadBoards({ boards: [found] })),
      message(Message.ClickedBoard({ boardId: found.board.id })),
      message(Message.ClickedNext()),
      Command.expectExact(SaveFirstRunBoards({ boardIds: [found.board.id] })),
      Command.resolve(SaveFirstRunBoards, Message.CompletedSave()),
      message(Message.ClickedOccasion({ occasion: 'casual' })),
      message(Message.ClickedOccasion({ occasion: 'smart' })),
      message(Message.ClickedNext()),
      // In the app's order, whatever order they were tapped in; and reaching the clothes marks it done.
      Command.expectExact(SaveFirstRunOccasions({ occasions: ['casual', 'smart'] }), FinishFirstRun()),
      Command.resolve(SaveFirstRunOccasions, Message.CompletedSave()),
      Command.resolve(FinishFirstRun, Message.CompletedSave()),
      model((current) => expect(stepOf(current)).toBe('Clothes')),
      message(Message.ClickedNext()),
      expectOutMessage(OutMessage.Finished()),
      model((current) => expect(stepOf(current)).toBe('Closed')),
    )
  })

  test('Skip answers Show me "Not now"; a step with nothing chosen saves nothing; Skip all ends it, done', () => {
    story(
      update,
      given({ ...init(), stage: Stage.Open({ step: Step.ShowMe() }) }),
      message(Message.ClickedShowMe({ showMe: null })),
      Command.expectExact(SaveFirstRunShowMe({ showMe: null }), ReadHouseBoards()),
      Command.resolve(SaveFirstRunShowMe, Message.CompletedSave()),
      Command.resolve(ReadHouseBoards, Message.FailedReadBoards()),
      message(Message.ClickedNext()),
      Command.expectNone(),
      message(Message.ClickedSkipAll()),
      expectOutMessage(OutMessage.Finished()),
      Command.expectExact(FinishFirstRun()),
      Command.resolve(FinishFirstRun, Message.CompletedSave()),
      model((current) => expect(stepOf(current)).toBe('Closed')),
    )
  })
})
