import { Dialog } from '@foldkit/ui'
import { OperationId } from '@styld/protocol'
import { Option } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { storySheetMoved } from './SheetFixtures.ts'
import { init, Message, OutMessage, SaveTo, Saving, update } from '../src/page/SaveToBoard.ts'
import { boardSummaryFixture } from './BoardFixtures.ts'

const autumn = boardSummaryFixture('autumn', { name: 'Autumn', pinCount: 3 })
const fresh = init({ kind: 'piece', id: `pc_${'knit'.padEnd(22, 'x')}` })

/** A new board named Trip, made before its pin failed: what the next try to Trip resumes. */
const trip = { boardId: Option.none<string>(), boardName: 'Trip' }
const tripBoard = `bd_${'trip'.padEnd(22, 'x')}`
const failedPin = {
  destination: trip,
  createOperationId: OperationId.make('op-board-0001'),
  pinOperationId: OperationId.make('op-pin-0001'),
  createdBoardId: Option.some(tripBoard),
}

describe('save to board', () => {
  test('while saving, another click or reopening cannot submit another save', () => {
    story(
      update,
      given({ ...fresh, saving: Saving.Sending(), name: 'Trip' }),
      message(Message.ClickedBoard({ boardId: autumn.id, boardName: autumn.name })),
      Command.expectNone(),
      message(Message.SubmittedNewBoard()),
      Command.expectNone(),
      message(Message.ClickedSave()),
      Command.expectNone(),
      model(({ saving, name }) => {
        expect(Saving.guards.Sending(saving)).toBe(true)
        expect(name).toBe('Trip')
      }),
    )
  })
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
      Command.expectExact(SaveTo({ target: fresh.target, destination: trip, resume: Option.none() })),
      Command.resolve(SaveTo, Message.FailedSave({ resume: failedPin })),
      model(({ saving, name }) => {
        expect(Saving.guards.Failed(saving)).toBe(true)
        expect(name).toBe('  Trip ')
      }),
    )
  })

  test('a board made before its pin failed is resumed, not made again, under the same operations', () => {
    story(
      update,
      given(fresh),
      message(Message.UpdatedName({ value: 'Trip' })),
      message(Message.SubmittedNewBoard()),
      Command.resolve(SaveTo, Message.FailedSave({ resume: failedPin })),
      message(Message.SubmittedNewBoard()),
      Command.expectExact(SaveTo({ target: fresh.target, destination: trip, resume: Option.some(failedPin) })),
      Command.resolve(SaveTo, Message.SucceededSave({ boardId: tripBoard, boardName: 'Trip' })),
      model(({ resume, saving }) => {
        expect(resume).toEqual(Option.none())
        expect(saving).toEqual(Saving.Saved({ boardId: tripBoard, boardName: 'Trip' }))
      }),
    )
  })

  test('a save somewhere else after a failure starts afresh', () => {
    story(
      update,
      given(fresh),
      message(Message.UpdatedName({ value: 'Trip' })),
      message(Message.SubmittedNewBoard()),
      Command.resolve(SaveTo, Message.FailedSave({ resume: failedPin })),
      message(Message.ClickedBoard({ boardId: autumn.id, boardName: autumn.name })),
      Command.expectExact(
        SaveTo({
          target: fresh.target,
          destination: { boardId: Option.some(autumn.id), boardName: autumn.name },
          resume: Option.none(),
        }),
      ),
      Command.resolve(SaveTo, Message.SucceededSave({ boardId: autumn.id, boardName: autumn.name })),
      model(({ resume }) => expect(resume).toEqual(Option.none())),
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
