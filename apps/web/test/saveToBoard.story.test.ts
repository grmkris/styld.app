import { Dialog } from '@foldkit/ui'
import { BoardSummary } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { init, ListBoardsToSaveTo, Message, SaveTo, Saving, update } from '../src/page/SaveToBoard.ts'

const autumn = Schema.decodeUnknownSync(BoardSummary)({
  id: `bd_${'autumn'.padEnd(22, 'x')}`,
  name: 'Autumn',
  paper: 'paper',
  items: [],
  cover: [],
  pinCount: 3,
  updatedAt: '2026-10-30T08:00:00.000Z',
})
const fresh = init({ kind: 'piece', id: `pc_${'knit'.padEnd(22, 'x')}` })

describe('save to board', () => {
  test('opens on the person’s boards and pins the piece on the one tapped', () => {
    story(
      update,
      given(fresh),
      message(Message.ClickedSave()),
      model(({ sheet, boards }) => {
        expect(sheet.isOpen).toBe(true)
        expect(AsyncData.isLoading(boards)).toBe(true)
      }),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Command.resolve(ListBoardsToSaveTo, Message.SucceededListBoards({ boards: [autumn] })),
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

  test('the boards that did not load are asked for again', () => {
    story(
      update,
      given(fresh),
      message(Message.FailedListBoards()),
      message(Message.ClickedRetry()),
      Command.expectExact(ListBoardsToSaveTo),
      Command.resolve(ListBoardsToSaveTo, Message.SucceededListBoards({ boards: [] })),
      model(({ boards }) => expect(AsyncData.getData(boards)).toEqual(Option.some([]))),
    )
  })
})
