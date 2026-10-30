import { Dialog } from '@foldkit/ui'
import { Board, BoardItemId, Look, PieceItem, PinId } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { Message } from '../src/page/Board/Message.ts'
import {
  BoardState,
  fromBoard,
  init,
  type Model,
  PinWork,
  Publishing,
  Removal,
  Saving,
} from '../src/page/Board/Model.ts'
import {
  DeleteBoard,
  LeaveBoard,
  LoadLooks,
  PinThings,
  ReloadBoard,
  RenameBoard,
  SetBoardMoods,
  SetBoardVisibility,
  UnpinThings,
} from '../src/page/Board/PageCommands.ts'
import { update } from '../src/page/Board/Update.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const knit = pieceFixture('knit')
const shoes = pieceFixture('shoes', { category: 'shoes' })
const pinId = (seed: string) => Schema.decodeUnknownSync(PinId)(`pn_${seed.padEnd(22, 'x')}`)
const knitPin = { _tag: 'PiecePin', id: pinId('knit'), piece: knit, addedAt: '2026-10-30T08:00:00.000Z' }
const shoesPin = { _tag: 'PiecePin', id: pinId('shoes'), piece: shoes, addedAt: '2026-10-30T09:00:00.000Z' }
const look = Schema.decodeUnknownSync(Look)({
  id: `lk_${'monday'.padEnd(22, 'x')}`,
  name: 'Monday',
  occasion: null,
  pieces: [knit],
  shared: false,
  check: null,
  createdAt: '2026-10-30T07:00:00.000Z',
})
const knitOnTable = PieceItem.make({
  id: Schema.decodeUnknownSync(BoardItemId)(`bi_${'knit'.padEnd(22, 'x')}`),
  pieceId: knit.id,
  x: 300,
  y: 320,
  size: 400,
  turn: 0,
  z: 1,
  flipped: false,
})
const board = Schema.decodeUnknownSync(Board)({
  id: `bd_${'autumn'.padEnd(22, 'x')}`,
  name: 'Autumn',
  paper: 'paper',
  version: 2,
  items: [knitOnTable],
  pins: [knitPin],
  moods: [],
  visibility: 'private',
  check: null,
  updatedAt: '2026-10-30T08:00:00.000Z',
})
const open: Model = fromBoard(init(board.id), board)
const withPins = (pins: ReadonlyArray<object>, changes: object = {}) =>
  Schema.decodeUnknownSync(Board)({ ...board, pins, ...changes })

describe('a board page', () => {
  test('renaming from its settings sends the typed name and shows it once saved', () => {
    story(
      update,
      given(open),
      message(Message.ClickedSettings()),
      model(({ settings, nameDraft }) => {
        expect(settings.isOpen).toBe(true)
        expect(nameDraft).toBe('Autumn')
      }),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      message(Message.UpdatedNameDraft({ value: '  Late autumn ' })),
      message(Message.SubmittedRename()),
      Command.expectExact(RenameBoard),
      Command.resolve(RenameBoard, Message.SucceededRename({ board: withPins([knitPin], { name: 'Late autumn' }) })),
      model(({ board: state, settings }) => {
        expect(state).toEqual(BoardState.Ready({ name: 'Late autumn', paper: 'paper' }))
        expect(settings.isOpen).toBe(false)
      }),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
    )
  })

  test('going public needs a published profile, and then shows what Styld’s check says', () => {
    const pending = { state: 'pending', reason: null, hidden: false } as const
    story(
      update,
      given(open),
      message(Message.ToggledPublic({ isPublic: true })),
      Command.expectExact(SetBoardVisibility({ boardId: board.id, isPublic: true })),
      Command.resolve(
        SetBoardVisibility({ boardId: board.id, isPublic: true }),
        Message.FailedSetVisibility({ needsProfile: true }),
      ),
      model(({ visibility, publishing }) => {
        expect(visibility).toBe('private')
        expect(publishing).toEqual(Publishing.Failed({ needsProfile: true }))
      }),
      message(Message.ToggledPublic({ isPublic: true })),
      Command.resolve(
        SetBoardVisibility({ boardId: board.id, isPublic: true }),
        Message.SucceededSetVisibility({ board: withPins([knitPin], { visibility: 'public', check: pending }) }),
      ),
      model(({ visibility, check, publishing, version }) => {
        expect(visibility).toBe('public')
        expect(check).toEqual(Option.some(pending))
        expect(Publishing.guards.Idle(publishing)).toBe(true)
        expect(version).toBe(2)
      }),
    )
  })

  test('moods are saved as they are picked, at most three', () => {
    story(
      update,
      given(modifyFields(open, { moods: () => ['rain', 'office', 'weekend'] })),
      message(Message.ToggledMood({ mood: 'sport' })),
      model(({ moods }) => expect(moods).toEqual(['rain', 'office', 'weekend'])),
      message(Message.ToggledMood({ mood: 'office' })),
      Command.expectExact(SetBoardMoods({ boardId: board.id, moods: ['rain', 'weekend'] })),
      Command.resolve(
        SetBoardMoods({ boardId: board.id, moods: ['rain', 'weekend'] }),
        Message.SucceededSetMoods({ board: withPins([knitPin], { moods: ['rain', 'weekend'] }) }),
      ),
      model(({ moods }) => expect(moods).toEqual(['rain', 'weekend'])),
    )
  })

  test('deleting asks once more, then leaves for the boards', () => {
    story(
      update,
      given(open),
      message(Message.ClickedDeleteBoard()),
      model(({ removal }) => expect(Removal.guards.Confirming(removal)).toBe(true)),
      message(Message.ClickedKeepBoard()),
      model(({ removal }) => expect(Removal.guards.Idle(removal)).toBe(true)),
      message(Message.ClickedDeleteBoard()),
      message(Message.ClickedConfirmDelete()),
      Command.expectExact(DeleteBoard),
      Command.resolve(DeleteBoard, Message.SucceededDeleteBoard()),
      Command.expectExact(LeaveBoard),
      Command.resolve(LeaveBoard, Message.CompletedLeaveBoard()),
    )
  })

  test('the picker pins what is ticked, pieces and looks alike, and the board keeps its table version', () => {
    story(
      update,
      given(open),
      message(Message.ClickedAddPins()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Command.expectExact(LoadLooks),
      Command.resolve(LoadLooks, Message.SucceededLoadLooks({ looks: [look] })),
      model(({ looks }) => expect(AsyncData.getData(looks)).toEqual(Option.some([look]))),
      message(Message.ToggledPick({ pick: `piece:${shoes.id}` })),
      message(Message.ToggledPick({ pick: `look:${look.id}` })),
      message(Message.ToggledPick({ pick: `piece:${knit.id}` })),
      message(Message.ToggledPick({ pick: `piece:${knit.id}` })),
      model(({ picks }) => expect(picks).toEqual([`piece:${shoes.id}`, `look:${look.id}`])),
      message(Message.SubmittedPicks()),
      Command.expectExact(PinThings),
      model(({ pinWork }) => expect(PinWork.guards.Sending(pinWork)).toBe(true)),
      Command.resolve(PinThings, Message.SucceededPins({ board: withPins([shoesPin, knitPin]) })),
      model(({ pins, picks, picker, version, items }) => {
        expect(pins.map(({ id }) => id)).toEqual([shoesPin.id, knitPin.id])
        expect(picks).toEqual([])
        expect(picker.isOpen).toBe(false)
        expect(version).toBe(2)
        expect(items).toEqual([knitOnTable])
      }),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
    )
  })

  test('taking a pin off also takes it off the table, as the server answers', () => {
    story(
      update,
      given(open),
      message(Message.ClickedUnpin({ pinId: knitPin.id })),
      Command.expectExact(UnpinThings),
      Command.resolve(UnpinThings, Message.SucceededPins({ board: withPins([], { version: 3, items: [] }) })),
      model(({ pins, items, version }) => {
        expect(pins).toEqual([])
        expect(items).toEqual([])
        expect(version).toBe(3)
      }),
    )
  })

  test('a pin that could not be taken off stays, and says so', () => {
    story(
      update,
      given(open),
      message(Message.ClickedUnpin({ pinId: knitPin.id })),
      Command.resolve(UnpinThings, Message.FailedPins()),
      model(({ pins, pinWork }) => {
        expect(pins).toHaveLength(1)
        expect(PinWork.guards.Failed(pinWork)).toBe(true)
      }),
    )
  })
})

describe('coming back to a board', () => {
  test('reads it again, and a newer table from elsewhere replaces this one with a fresh history', () => {
    story(
      update,
      given(modifyFields(open, { past: () => [[]] })),
      message(Message.BecameVisible()),
      Command.expectExact(ReloadBoard),
      Command.resolve(
        ReloadBoard,
        Message.SucceededReloadBoard({ board: withPins([shoesPin, knitPin], { version: 5, items: [] }) }),
      ),
      model(({ version, items, pins, past }) => {
        expect(version).toBe(5)
        expect(items).toEqual([])
        expect(pins).toHaveLength(2)
        expect(past).toEqual([])
      }),
    )
  })

  test('leaves a table alone while a change of its own is waiting to be saved', () => {
    story(
      update,
      given(modifyFields(open, { saving: () => Saving.Waiting({ generation: 1 }) })),
      message(Message.BecameVisible()),
      Command.expectNone(),
      model(({ items, saving }) => {
        expect(items).toEqual([knitOnTable])
        expect(Saving.guards.Waiting(saving)).toBe(true)
      }),
    )
  })
})

describe('the board editor', () => {
  test('a saved table brings the pins the server added for the pieces it placed', () => {
    const saving = modifyFields(open, { saving: () => Saving.InFlight({ dirty: false }) })
    story(
      update,
      given(saving),
      message(Message.SucceededSaveItems({ board: withPins([shoesPin, knitPin], { version: 3 }) })),
      model(({ pins, version }) => {
        expect(pins.map(({ id }) => id)).toEqual([shoesPin.id, knitPin.id])
        expect(version).toBe(3)
      }),
    )
  })
})
