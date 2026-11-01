import { Board, BoardImageId, type BoardItem, BoardItemId, PieceItem } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { SaveItems, UpdatePaper, WaitForExit, WaitForToast, WaitToSave } from '../src/page/Board/Commands.ts'
import { Message } from '../src/page/Board/Message.ts'
import { fromBoard, Gesture, init, type Model, ownBoard, Saving, Toast, Upload } from '../src/page/Board/Model.ts'
import { update } from '../src/page/Board/Update.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const itemId = (seed: string) => Schema.decodeUnknownSync(BoardItemId)(`bi_${seed.padEnd(22, 'x')}`)
const knit = PieceItem.make({
  id: itemId('knit'),
  pieceId: pieceFixture('knit').id,
  x: 300,
  y: 320,
  size: 400,
  turn: 0,
  z: 1,
  flipped: false,
})
const shorts = PieceItem.make({
  id: itemId('shorts'),
  pieceId: pieceFixture('shorts', { type: 'trousers' }).id,
  x: 320,
  y: 860,
  size: 400,
  turn: 0,
  z: 2,
  flipped: false,
})
const board = Schema.decodeUnknownSync(Board)({
  id: `bd_${'weekend'.padEnd(22, 'x')}`,
  name: 'Weekend',
  paper: 'paper',
  version: 3,
  items: [knit, shorts],
  pins: [],
  moods: [],
  visibility: 'private',
  check: null,
  updatedAt: '2026-10-30T08:00:00.000Z',
})

/** A board open in the editor, its paper 500px wide: one page pixel is two table units. */
const open: Model = modifyFields(fromBoard(init(board.id, true), board), {
  pxPerUnit: () => 0.5,
  ids: () => [itemId('fresh-1'), itemId('fresh-2'), itemId('fresh-3'), itemId('fresh-4'), itemId('fresh-5')],
})

const itemIn = (current: Model, id: string): BoardItem => {
  const found = current.items.find((item) => item.id === id)
  if (found === undefined) throw new Error(`No item ${id}`)
  return found
}
const at = (pointerId: number, x: number, y: number) => ({ pointerId, x, y })
/** A stale wait: the save it scheduled is no longer the newest, so nothing more is sent. */
const passedWait = Message.ElapsedSaveWait({ generation: -1 })

describe('the board editor', () => {
  test('an item follows the pointer exactly, and the finished move is saved from the version the editor had', () => {
    story(
      update,
      given(open),
      message(Message.PressedItem({ id: knit.id, pointer: at(1, 100, 100), isTouch: false })),
      message(Message.MovedPointer({ pointer: at(1, 150, 120) })),
      model((current) => {
        expect(itemIn(current, knit.id).x).toBe(knit.x + 100)
        expect(itemIn(current, knit.id).y).toBe(knit.y + 40)
        expect(itemIn(current, knit.id).z).toBe(2)
      }),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      Command.expectExact(WaitToSave),
      Command.resolve(WaitToSave, Message.ElapsedSaveWait({ generation: 1 })),
      Command.expectExact(SaveItems),
      Command.resolve(SaveItems, Message.SucceededSaveItems({ board: { ...board, version: 4 } })),
      model((current) => {
        expect(current.version).toBe(4)
        expect(Saving.guards.Saved(current.saving)).toBe(true)
        expect(current.past).toHaveLength(1)
      }),
    )
  })

  test('a second finger turns the move into a pinch that resizes the item, and lifting it carries on as a move', () => {
    story(
      update,
      given(open),
      message(Message.PressedItem({ id: shorts.id, pointer: at(1, 100, 100), isTouch: true })),
      message(Message.PressedPaper({ pointer: at(2, 140, 100) })),
      model((current) => expect(Gesture.guards.Pinching(current.gesture)).toBe(true)),
      message(Message.MovedPointer({ pointer: at(2, 180, 100) })),
      model((current) => expect(itemIn(current, shorts.id).size).toBeCloseTo(shorts.size * 2)),
      message(Message.ReleasedPointer({ pointerId: 2 })),
      model((current) => expect(Gesture.guards.Dragging(current.gesture)).toBe(true)),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      Command.resolve(WaitToSave, passedWait),
      model((current) => expect(Gesture.guards.Idle(current.gesture)).toBe(true)),
    )
  })

  test('Escape puts a moving item back where it was', () => {
    story(
      update,
      given(open),
      message(Message.PressedItem({ id: knit.id, pointer: at(1, 100, 100), isTouch: false })),
      message(Message.MovedPointer({ pointer: at(1, 300, 300) })),
      message(Message.PressedEscape()),
      Command.expectNone(),
      model((current) => {
        expect(current.items).toEqual(open.items)
        expect(Gesture.guards.Idle(current.gesture)).toBe(true)
      }),
    )
  })

  test('the keyboard moves the focused item one step, as one undo step', () => {
    story(
      update,
      given(open),
      message(Message.PressedItemKey({ id: knit.id, step: 'right', isShifted: false })),
      Command.resolve(WaitToSave, passedWait),
      model((current) => expect(itemIn(current, knit.id).x).toBe(knit.x + 10)),
      message(Message.ClickedUndo()),
      Command.resolve(WaitToSave, passedWait),
      model((current) => expect(itemIn(current, knit.id).x).toBe(knit.x)),
    )
  })

  test('taking an item off plays its exit and offers it back, and Undo brings it back', () => {
    story(
      update,
      given(open),
      message(Message.ClickedRemove({ id: knit.id })),
      Command.expectExact(WaitToSave, WaitForExit, WaitForToast),
      model((current) => {
        expect(current.items.map((item) => item.id)).toEqual([shorts.id])
        expect(current.leaving.map((item) => item.id)).toEqual([knit.id])
        expect(Toast.guards.Removed(current.toast)).toBe(true)
      }),
      Command.resolve(WaitForExit, Message.CompletedExit({ id: knit.id })),
      Command.resolve(WaitToSave, passedWait),
      // An older toast's time running out leaves this one showing.
      Command.resolve(WaitForToast, Message.ElapsedToast({ generation: 0 })),
      model((current) => expect(Toast.guards.Removed(current.toast)).toBe(true)),
      message(Message.ClickedUndoRemove()),
      Command.resolve(WaitToSave, passedWait),
      model((current) => {
        expect(current.items.map((item) => item.id)).toEqual([knit.id, shorts.id])
        expect(current.leaving).toEqual([])
        expect(Toast.guards.Hidden(current.toast)).toBe(true)
      }),
    )
  })

  test('a label added from the toolbar is selected, with a fresh id', () => {
    story(
      update,
      given(open),
      message(Message.ClickedAddText({ text: 'Weekend in Piran' })),
      Command.resolve(WaitToSave, passedWait),
      model((current) => {
        expect(current.items).toHaveLength(3)
        expect(current.maybeSelectedId).toEqual(Option.some(itemId('fresh-1')))
      }),
    )
  })
})

const picture = (name: string) => new File(['x'], name, { type: 'image/png' })
const imageId = Schema.decodeUnknownSync(BoardImageId)(`bm_${'sea'.padEnd(22, 'x')}`)

describe('pictures sent to the board', () => {
  test('one that fails leaves the others counted on their way, and the board says so once all have settled', () => {
    const sending = update(open, Message.DroppedFiles({ files: [picture('a.png'), picture('b.png')] })).model
    expect(sending.upload).toEqual(Upload.Sending({ count: 2, problem: Option.none() }))
    const oneFailed = update(sending, Message.FailedAddImage({ problem: 'refused' })).model
    expect(oneFailed.upload).toEqual(Upload.Sending({ count: 1, problem: Option.some('refused') }))
    const settled = update(oneFailed, Message.SucceededAddImage({ imageId })).model
    expect(settled.upload).toEqual(Upload.Failed({ problem: 'refused' }))
    expect(settled.items).toHaveLength(3)
  })

  test('all of them reaching the board leaves nothing to say', () => {
    const sending = update(open, Message.DroppedFiles({ files: [picture('a.png')] })).model
    expect(update(sending, Message.SucceededAddImage({ imageId })).model.upload).toEqual(Upload.Idle())
  })
})

const withPaper = (current: Model) => Option.map(ownBoard(current.board), ({ paper }) => paper)

describe('the board’s paper', () => {
  test('shows at once, and goes back to the one before when it does not save', () => {
    story(
      update,
      given(open),
      message(Message.SelectedPaper({ paper: 'sand' })),
      model((current) => expect(withPaper(current)).toEqual(Option.some('sand'))),
      Command.expectExact(UpdatePaper({ boardId: board.id, paper: 'sand', previous: 'paper' })),
      Command.resolve(UpdatePaper, Message.FailedUpdatePaper({ attempted: 'sand', previous: 'paper' })),
      model((current) => expect(withPaper(current)).toEqual(Option.some('paper'))),
    )
  })

  test('an older paper’s failure or answer does not undo the one chosen since', () => {
    const first = update(open, Message.SelectedPaper({ paper: 'sand' })).model
    const second = update(first, Message.SelectedPaper({ paper: 'sage' })).model
    const failedFirst = update(second, Message.FailedUpdatePaper({ attempted: 'sand', previous: 'paper' })).model
    expect(withPaper(failedFirst)).toEqual(Option.some('sage'))
    const answeredFirst = update(
      second,
      Message.SucceededUpdatePaper({ board: Schema.decodeUnknownSync(Board)({ ...board, paper: 'sand' }) }),
    ).model
    expect(withPaper(answeredFirst)).toEqual(Option.some('sage'))
  })
})
