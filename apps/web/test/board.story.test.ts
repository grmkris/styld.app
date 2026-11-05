import { Board, BoardImageId, type BoardItem, BoardItemId, LookId, PieceItem, PiecePin, PinId } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { SaveItems, SaveLook, WaitForExit, WaitForToast, WaitToSave } from '../src/page/Board/Editor/Commands.ts'
import { UpdatePaper } from '../src/page/Board/PageCommands.ts'
import * as EditorMessage from '../src/page/Board/Editor/Message.ts'
import * as AddSheet from '../src/page/Board/AddSheet.ts'
import * as Chrome from '../src/page/Board/Chrome.ts'
import { Message } from '../src/page/Board/Message.ts'
import { canChangePins, fromBoard, init, type Model, ownBoard } from '../src/page/Board/Model.ts'
import { Gesture, LookSave, Saving, Ticks, Toast, Upload } from '../src/page/Board/Editor/Model.ts'
import { edit, update, withEditor } from './BoardFixtures.ts'
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
  publicPins: [],
  moods: [],
  visibility: 'private',
  check: null,
  updatedAt: '2026-10-30T08:00:00.000Z',
})

/** A board open in the editor, its paper 500px wide: one page pixel is two table units. */
const open: Model = withEditor(fromBoard(init(board.id), board), (editor) =>
  modifyFields(editor, {
    pxPerUnit: () => 0.5,
    ids: () => [itemId('fresh-1'), itemId('fresh-2'), itemId('fresh-3'), itemId('fresh-4'), itemId('fresh-5')],
  }),
)

const itemIn = (current: Model, id: string): BoardItem => {
  const found = current.editor.items.find((item) => item.id === id)
  if (found === undefined) throw new Error(`No item ${id}`)
  return found
}
const at = (pointerId: number, x: number, y: number) => ({ pointerId, x, y })
/** A stale wait: the save it scheduled is no longer the newest, so nothing more is sent. */
const passedWait = EditorMessage.Message.ElapsedSaveWait({ generation: -1 })

describe('the board editor', () => {
  test('an item follows the pointer exactly, and the finished move is saved from the version the editor had', () => {
    story(
      update,
      given(open),
      message(edit(EditorMessage.Message.PressedItem({ id: knit.id, pointer: at(1, 100, 100), isTouch: false }))),
      message(edit(EditorMessage.Message.MovedPointer({ pointer: at(1, 150, 120) }))),
      model((current) => {
        expect(itemIn(current, knit.id).x).toBe(knit.x + 100)
        expect(itemIn(current, knit.id).y).toBe(knit.y + 40)
        expect(itemIn(current, knit.id).z).toBe(1)
      }),
      message(edit(EditorMessage.Message.ReleasedPointer({ pointerId: 1 }))),
      Command.expectExact(WaitToSave),
      Command.resolve(WaitToSave, EditorMessage.Message.ElapsedSaveWait({ generation: 1 })),
      Command.expectExact(SaveItems),
      Command.resolve(SaveItems, EditorMessage.Message.SucceededSaveItems({ board: { ...board, version: 4 } })),
      model((current) => {
        expect(current.editor.version).toBe(4)
        expect(Saving.guards.Saved(current.editor.saving)).toBe(true)
        expect(current.editor.past).toHaveLength(1)
      }),
    )
  })

  test('a chosen layer survives a press, move and save, and undo restores the previous order', () => {
    const front = update(open, edit(EditorMessage.Message.ClickedLayer({ id: knit.id }))).model
    expect(itemIn(front, knit.id).z).toBe(2)
    const back = update(front, edit(EditorMessage.Message.ClickedLayer({ id: knit.id }))).model
    expect(itemIn(back, knit.id).z).toBe(1)
    const held = update(
      back,
      edit(EditorMessage.Message.PressedItem({ id: knit.id, pointer: at(1, 100, 100), isTouch: false })),
    ).model
    expect(itemIn(held, knit.id).z).toBe(1)
    const moved = update(held, edit(EditorMessage.Message.MovedPointer({ pointer: at(1, 150, 120) }))).model
    const released = update(moved, edit(EditorMessage.Message.ReleasedPointer({ pointerId: 1 }))).model
    const saved = update(
      released,
      edit(EditorMessage.Message.SucceededSaveItems({ board: { ...board, version: 4, items: released.editor.items } })),
    ).model
    expect(itemIn(saved, knit.id)).toMatchObject({ z: 1, x: 400, y: 360 })
    const undoMove = update(saved, edit(EditorMessage.Message.ClickedUndo())).model
    const undoLayer = update(undoMove, edit(EditorMessage.Message.ClickedUndo())).model
    expect(itemIn(undoLayer, knit.id).z).toBe(2)
  })

  test('a second finger turns the move into a pinch that resizes the item, and lifting it carries on as a move', () => {
    story(
      update,
      given(open),
      message(edit(EditorMessage.Message.PressedItem({ id: shorts.id, pointer: at(1, 100, 100), isTouch: true }))),
      message(edit(EditorMessage.Message.PressedPaper({ pointer: at(2, 140, 100) }))),
      model((current) => expect(Gesture.guards.Pinching(current.editor.gesture)).toBe(true)),
      message(edit(EditorMessage.Message.MovedPointer({ pointer: at(2, 180, 100) }))),
      model((current) => expect(itemIn(current, shorts.id).size).toBeCloseTo(shorts.size * 2)),
      message(edit(EditorMessage.Message.ReleasedPointer({ pointerId: 2 }))),
      model((current) => expect(Gesture.guards.Dragging(current.editor.gesture)).toBe(true)),
      message(edit(EditorMessage.Message.ReleasedPointer({ pointerId: 1 }))),
      Command.resolve(WaitToSave, passedWait),
      model((current) => expect(Gesture.guards.Idle(current.editor.gesture)).toBe(true)),
    )
  })

  test('Escape puts a moving item back where it was', () => {
    story(
      update,
      given(open),
      message(edit(EditorMessage.Message.PressedItem({ id: knit.id, pointer: at(1, 100, 100), isTouch: false }))),
      message(edit(EditorMessage.Message.MovedPointer({ pointer: at(1, 300, 300) }))),
      message(edit(EditorMessage.Message.PressedEscape())),
      Command.expectNone(),
      model((current) => {
        expect(current.editor.items).toEqual(open.editor.items)
        expect(Gesture.guards.Idle(current.editor.gesture)).toBe(true)
      }),
    )
  })

  test('the keyboard moves the focused item one step, as one undo step', () => {
    story(
      update,
      given(open),
      message(edit(EditorMessage.Message.PressedItemKey({ id: knit.id, step: 'right', isShifted: false }))),
      Command.resolve(WaitToSave, passedWait),
      model((current) => expect(itemIn(current, knit.id).x).toBe(knit.x + 10)),
      message(edit(EditorMessage.Message.ClickedUndo())),
      Command.resolve(WaitToSave, passedWait),
      model((current) => expect(itemIn(current, knit.id).x).toBe(knit.x)),
    )
  })

  test('taking an item off plays its exit and offers it back, and Undo brings it back', () => {
    story(
      update,
      given(open),
      message(edit(EditorMessage.Message.ClickedRemove({ id: knit.id }))),
      Command.expectExact(WaitToSave, WaitForExit, WaitForToast),
      model((current) => {
        expect(current.editor.items.map((item) => item.id)).toEqual([shorts.id])
        expect(current.editor.leaving.map((item) => item.id)).toEqual([knit.id])
        expect(Toast.guards.Removed(current.editor.toast)).toBe(true)
      }),
      Command.resolve(WaitForExit, EditorMessage.Message.CompletedExit({ id: knit.id })),
      Command.resolve(WaitToSave, passedWait),
      // An older toast's time running out leaves this one showing.
      Command.resolve(WaitForToast, EditorMessage.Message.ElapsedToast({ generation: 0 })),
      model((current) => expect(Toast.guards.Removed(current.editor.toast)).toBe(true)),
      message(edit(EditorMessage.Message.ClickedUndoRemove())),
      Command.resolve(WaitToSave, passedWait),
      model((current) => {
        expect(current.editor.items.map((item) => item.id)).toEqual([knit.id, shorts.id])
        expect(current.editor.leaving).toEqual([])
        expect(Toast.guards.Hidden(current.editor.toast)).toBe(true)
      }),
    )
  })

  test('a new wardrobe piece lands above the existing stack, and selecting it again does not remove it', () => {
    const fresh = pieceFixture('boots', { type: 'boots' })
    const added = update(
      open,
      edit(EditorMessage.Message.GotAddSheetMessage({ message: AddSheet.Message.ClickedPiece({ pieceId: fresh.id }) })),
    ).model
    expect(added.editor.items).toHaveLength(3)
    expect(added.editor.items.at(-1)).toMatchObject({ pieceId: fresh.id, z: 3 })
    expect(
      update(
        added,
        edit(
          EditorMessage.Message.GotAddSheetMessage({ message: AddSheet.Message.ClickedPiece({ pieceId: fresh.id }) }),
        ),
      ).model.editor.items,
    ).toEqual(added.editor.items)
  })

  test('a label added from the toolbar is selected, with a fresh id', () => {
    story(
      update,
      given(open),
      message(edit(EditorMessage.Message.ClickedAddText({ text: 'Weekend in Piran' }))),
      Command.resolve(WaitToSave, passedWait),
      model((current) => {
        expect(current.editor.items).toHaveLength(3)
        expect(current.editor.maybeSelectedId).toEqual(Option.some(itemId('fresh-1')))
      }),
    )
  })
})

const picture = (name: string) => new File(['x'], name, { type: 'image/png' })
const imageId = Schema.decodeUnknownSync(BoardImageId)(`bm_${'sea'.padEnd(22, 'x')}`)

describe('pictures sent to the board', () => {
  test('one that fails leaves the others counted on their way, and the board says so once all have settled', () => {
    const sending = update(
      open,
      edit(EditorMessage.Message.DroppedFiles({ files: [picture('a.png'), picture('b.png')] })),
    ).model
    expect(sending.editor.upload).toEqual(Upload.Sending({ count: 2, problem: Option.none() }))
    const oneFailed = update(sending, edit(EditorMessage.Message.FailedAddImage({ problem: 'refused' }))).model
    expect(oneFailed.editor.upload).toEqual(Upload.Sending({ count: 1, problem: Option.some('refused') }))
    const settled = update(oneFailed, edit(EditorMessage.Message.SucceededAddImage({ imageId }))).model
    expect(settled.editor.upload).toEqual(Upload.Failed({ problem: 'refused' }))
    expect(settled.editor.items).toHaveLength(3)
  })

  test('all of them reaching the board leaves nothing to say', () => {
    const sending = update(open, edit(EditorMessage.Message.DroppedFiles({ files: [picture('a.png')] }))).model
    expect(update(sending, edit(EditorMessage.Message.SucceededAddImage({ imageId }))).model.editor.upload).toEqual(
      Upload.Idle(),
    )
  })

  test('paste reads the clipboard first: an empty one leaves what the board said, pictures on it go up', () => {
    const failed = withEditor(open, (editor) =>
      modifyFields(editor, { upload: () => Upload.Failed({ problem: 'failed' }) }),
    )
    const paste = Message.GotChromeMessage({ message: Chrome.Message.ClickedMoreAction({ action: 'paste' }) })
    const pasting = update(failed, paste).model
    expect(pasting.editor.upload).toEqual(Upload.Pasting({ problem: Option.some('failed') }))
    expect(canChangePins(pasting)).toBe(false)
    expect(
      update(pasting, edit(EditorMessage.Message.CompletedReadClipboard({ files: [] }))).model.editor.upload,
    ).toEqual(Upload.Failed({ problem: 'failed' }))
    expect(
      update(pasting, edit(EditorMessage.Message.CompletedReadClipboard({ files: [picture('a.png')] }))).model.editor
        .upload,
    ).toEqual(Upload.Sending({ count: 1, problem: Option.none() }))
  })
})

const withPaper = (current: Model) => Option.map(ownBoard(current.board), ({ paper }) => paper)

describe('the board’s paper', () => {
  test('shows at once, and goes back to the one before when it does not save', () => {
    story(
      update,
      given(open),
      message(edit(EditorMessage.Message.SelectedPaper({ paper: 'sand' }))),
      model((current) => expect(withPaper(current)).toEqual(Option.some('sand'))),
      Command.expectExact(UpdatePaper({ boardId: board.id, paper: 'sand', previous: 'paper' })),
      Command.resolve(UpdatePaper, Message.FailedUpdatePaper({ attempted: 'sand', previous: 'paper' })),
      model((current) => expect(withPaper(current)).toEqual(Option.some('paper'))),
    )
  })

  test('an older paper’s failure or answer does not undo the one chosen since', () => {
    const first = update(open, edit(EditorMessage.Message.SelectedPaper({ paper: 'sand' }))).model
    const second = update(first, edit(EditorMessage.Message.SelectedPaper({ paper: 'sage' }))).model
    const failedFirst = update(second, Message.FailedUpdatePaper({ attempted: 'sand', previous: 'paper' })).model
    expect(withPaper(failedFirst)).toEqual(Option.some('sage'))
    const answeredFirst = update(
      second,
      Message.SucceededUpdatePaper({ board: Schema.decodeUnknownSync(Board)({ ...board, paper: 'sand' }) }),
    ).model
    expect(withPaper(answeredFirst)).toEqual(Option.some('sage'))
  })
})

describe('saving a look from the board (T-16)', () => {
  const lookId = LookId.make(`lk_${'weekend'.padEnd(22, 'x')}`)
  const pinned = PiecePin.make({
    id: PinId.make(`pn_${'knit'.padEnd(22, 'x')}`),
    piece: pieceFixture('knit'),
    addedAt: '2026-11-04T08:00:00.000Z',
  })

  test('Save as a look ticks every piece first, a tap leaves one out, and Save keeps the rest, then pins the look', () => {
    story(
      update,
      given(open),
      message(edit(EditorMessage.Message.ClickedSaveLook({ name: 'Weekend' }))),
      Command.expectNone(),
      model((current) => expect(current.editor.ticks).toEqual(Ticks.On({ itemIds: [knit.id, shorts.id] }))),
      message(edit(EditorMessage.Message.ToggledTick({ id: knit.id }))),
      model((current) => expect(current.editor.ticks).toEqual(Ticks.On({ itemIds: [shorts.id] }))),
      message(edit(EditorMessage.Message.ClickedSaveLook({ name: 'Weekend' }))),
      Command.expectExact(SaveLook({ boardId: board.id, name: 'Weekend', pieceIds: [shorts.pieceId] })),
      model((current) => {
        expect(Ticks.guards.Off(current.editor.ticks)).toBe(true)
        expect(LookSave.guards.Saving(current.editor.look)).toBe(true)
      }),
      Command.resolve(
        SaveLook,
        EditorMessage.Message.SucceededSaveLook({ lookId, board: { ...board, pins: [pinned] } }),
      ),
      model((current) => {
        expect(current.editor.look).toEqual(LookSave.Saved({ lookId }))
        expect(current.pins).toEqual([pinned])
        expect(current.editor.items).toEqual(open.editor.items)
      }),
    )
  })

  test('with every piece left ticked, the whole table is saved, top of the stack first', () => {
    story(
      update,
      given(open),
      message(edit(EditorMessage.Message.ClickedSaveLook({ name: 'Weekend' }))),
      message(edit(EditorMessage.Message.ClickedSaveLook({ name: 'Weekend' }))),
      Command.expectExact(SaveLook({ boardId: board.id, name: 'Weekend', pieceIds: [shorts.pieceId, knit.pieceId] })),
      Command.resolve(SaveLook, EditorMessage.Message.FailedSaveLook()),
      model((current) => expect(LookSave.guards.Failed(current.editor.look)).toBe(true)),
    )
  })

  test('with every piece left out nothing is saved, a tap moves nothing, and Cancel leaves it', () => {
    story(
      update,
      given(open),
      message(edit(EditorMessage.Message.ClickedSaveLook({ name: 'Weekend' }))),
      message(edit(EditorMessage.Message.ToggledTick({ id: knit.id }))),
      message(edit(EditorMessage.Message.ToggledTick({ id: shorts.id }))),
      message(edit(EditorMessage.Message.ClickedSaveLook({ name: 'Weekend' }))),
      Command.expectNone(),
      model((current) => {
        expect(LookSave.guards.NoPieces(current.editor.look)).toBe(true)
        expect(current.editor.items).toEqual(open.editor.items)
      }),
      message(edit(EditorMessage.Message.ClickedCancelSelecting())),
      model((current) => expect(Ticks.guards.Off(current.editor.ticks)).toBe(true)),
    )
  })
})
