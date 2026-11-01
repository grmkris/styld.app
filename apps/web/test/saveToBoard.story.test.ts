import { Dialog } from '@foldkit/ui'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { storySheetMoved } from './SheetFixtures.ts'
import { init, Message, OutMessage, SaveTo, Saving, update } from '../src/page/SaveToBoard.ts'
import { boardSummaryFixture } from './BoardFixtures.ts'

const autumn = boardSummaryFixture('autumn', { name: 'Autumn', pinCount: 3 })
const fresh = init({ kind: 'piece', id: `pc_${'knit'.padEnd(22, 'x')}` })

describe('save to board', () => {
  test('opening asks the app for the person’s boards, and the one tapped gets the piece', () => {
    story(
      update,
      given(fresh),
      message(Message.ClickedSave()),
      model(({ sheet }) => expect(sheet.isOpen).toBe(true)),
      expectOutMessage(OutMessage.RequestedBoards()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      ...storySheetMoved(1),
      message(Message.ClickedBoard({ boardId: autumn.id, boardName: autumn.name })),
      model(({ saving }) => expect(Saving.guards.Sending(saving)).toBe(true)),
      Command.expectExact(SaveTo),
      Command.resolve(SaveTo, Message.SucceededSave({ boardId: autumn.id, boardName: autumn.name })),
      model(({ saving }) => expect(saving).toEqual(Saving.Saved({ boardId: autumn.id, boardName: 'Autumn' }))),
    )
  })

  test('a new board needs a name, and saving says so when it fails', () => {
    story(
      update,
      given(fresh),
      message(Message.SubmittedNewBoard()),
      Command.expectNone(),
      message(Message.UpdatedName({ value: '  Trip ' })),
      message(Message.SubmittedNewBoard()),
      Command.expectExact(SaveTo),
      Command.resolve(SaveTo, Message.FailedSave()),
      model(({ saving, name }) => {
        expect(Saving.guards.Failed(saving)).toBe(true)
        expect(name).toBe('  Trip ')
      }),
    )
  })

  test('the boards that did not load are asked of the app again', () => {
    story(
      update,
      given(fresh),
      message(Message.ClickedRetry()),
      Command.expectNone(),
      expectOutMessage(OutMessage.RequestedBoards()),
      model((current) => expect(current).toEqual(fresh)),
    )
  })
})
