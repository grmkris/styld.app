import { Dialog } from '@foldkit/ui'
import { Board, BoardImageId, BoardItemId, ImageItem, Look, PieceItem, PinId } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { storySheetMoved } from './SheetFixtures.ts'
import * as AddSheet from '../src/page/Board/AddSheet.ts'
import { Message } from '../src/page/Board/Message.ts'
import { BoardData, BoardShown, fromBoard, init, type Model, PinWork, Saving, Upload } from '../src/page/Board/Model.ts'
import { AddGalleryPicture, AddTryOnPicture, MakeIds, WaitToSave } from '../src/page/Board/Commands.ts'
import {
  DeleteBoard,
  FocusName,
  FocusPin,
  LeaveBoard,
  Publishing,
  Removal,
  Rename,
  RenameBoard,
  SetBoardMoods,
  SetBoardVisibility,
} from '../src/page/Board/Chrome.ts'
import * as Chrome from '../src/page/Board/Chrome.ts'
import { PinLook, ReloadBoard, UnpinThings } from '../src/page/Board/PageCommands.ts'
import { update as boardUpdate } from '../src/page/Board/Update.ts'
import { pieceFixture } from './WardrobeFixtures.ts'
import { init as appInit, Message as AppMessage, update as appUpdate } from '../src/App.ts'
import { flags, urlOf } from './AppFixtures.ts'
import { done as doneTryOn, photo } from './TryOnFixtures.ts'

/** The board's page with a session, as its owner opens it. */
const update = (current: Model, sent: Message) => boardUpdate(current, sent, { signedIn: true })

const knit = pieceFixture('knit')
const shoes = pieceFixture('shoes', { type: 'trainers' })
const pinId = (seed: string) => Schema.decodeUnknownSync(PinId)(`pn_${seed.padEnd(22, 'x')}`)
const knitPin = { _tag: 'PiecePin', id: pinId('knit'), piece: knit, addedAt: '2026-10-30T08:00:00.000Z' }
const shoesPin = { _tag: 'PiecePin', id: pinId('shoes'), piece: shoes, addedAt: '2026-10-30T09:00:00.000Z' }
const look = Schema.decodeUnknownSync(Look)({
  id: `lk_${'monday'.padEnd(22, 'x')}`,
  name: 'Monday',
  occasion: null,
  pieces: [knit, shoes],
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
  publicPins: [],
  moods: [],
  visibility: 'private',
  check: null,
  updatedAt: '2026-10-30T08:00:00.000Z',
})
const open: Model = fromBoard(init(board.id), board)
/** A Message of the board's Add sheet, as the board receives it. */
const add = (sheetMessage: AddSheet.Message) => Message.GotAddSheetMessage({ message: sheetMessage })
/** A Message of the board's chrome (its title, public switch and ⋯ sheet), as the board receives it. */
const chrome = (chromeMessage: Chrome.Message) => Message.GotChromeMessage({ message: chromeMessage })
const withPins = (pins: ReadonlyArray<object>, changes: object = {}) =>
  Schema.decodeUnknownSync(Board)({ ...board, pins, ...changes })

/** A table change's wait to save and its fresh ids, answered without saving: these stories are about what lands. */
const tableSettled = [
  Command.resolve(WaitToSave, Message.ElapsedSaveWait({ generation: -1 })),
  Command.resolve(MakeIds, Message.CompletedMakeIds({ ids: [] })),
]

describe('a board page', () => {
  test('pin mutations wait for the local table save, then discard history of removed pins', () => {
    const edited: Model = modifyFields(open, {
      saving: () => Saving.Waiting({ generation: 1 }),
      past: () => [board.items],
      maybeSelectedId: () => Option.some(knitOnTable.id),
    })
    const waiting = update(edited, chrome(Chrome.Message.ClickedConfirmUnpin({ pinId: knitPin.id })))
    expect(waiting.model).toEqual(edited)
    expect(waiting.commands ?? []).toEqual([])
    const settled = modifyFields(edited, { saving: () => Saving.Saved() })
    const sending = update(settled, chrome(Chrome.Message.ClickedConfirmUnpin({ pinId: knitPin.id })))
    expect(PinWork.guards.Sending(sending.model.pinWork)).toBe(true)
    expect(
      update(sending.model, chrome(Chrome.Message.ClickedConfirmUnpin({ pinId: knitPin.id }))).commands ?? [],
    ).toEqual([])
    const removed = update(
      sending.model,
      Message.SucceededPins({
        board: withPins([], { version: 3, items: [] }),
      }),
    ).model
    expect(removed.items).toEqual([])
    expect(removed.past).toEqual([])
    expect(removed.future).toEqual([])
    expect(removed.maybeSelectedId).toEqual(Option.none())
    expect(removed.version).toBe(3)
  })

  test('renaming on the title sends the typed name and shows it once saved', () => {
    story(
      update,
      given(open),
      message(chrome(Chrome.Message.ClickedRename({ name: 'Autumn', fromSheet: false }))),
      Command.expectExact(FocusName),
      Command.resolve(FocusName, Chrome.Message.CompletedFocusName()),
      model(({ chrome: { rename, nameDraft } }) => {
        expect(Rename.guards.Editing(rename)).toBe(true)
        expect(nameDraft).toBe('Autumn')
      }),
      message(chrome(Chrome.Message.UpdatedNameDraft({ value: '  Late autumn ' }))),
      message(chrome(Chrome.Message.SubmittedRename())),
      Command.expectExact(RenameBoard),
      Command.resolve(
        RenameBoard,
        Chrome.Message.SucceededRename({ board: withPins([knitPin], { name: 'Late autumn' }) }),
      ),
      model(({ board: state, chrome: { rename } }) => {
        expect(state).toEqual(BoardData.Success({ data: BoardShown.Own({ name: 'Late autumn', paper: 'paper' }) }))
        expect(Rename.guards.Idle(rename)).toBe(true)
      }),
    )
  })

  test('the ⋯ sheet closes before the board tidies its table', () => {
    story(
      update,
      given(open),
      message(chrome(Chrome.Message.ClickedMore())),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      ...storySheetMoved(1),
      message(chrome(Chrome.Message.ClickedMoreAction({ action: 'tidy' }))),
      model(({ chrome: { more } }) => expect(more.isOpen).toBe(false)),
      ...storySheetMoved(2),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
      Command.resolve(WaitToSave, Message.ElapsedSaveWait({ generation: -1 })),
    )
  })

  test('going public needs a published profile, and then shows what Styld’s check says', () => {
    const pending = { state: 'pending', reason: null, hidden: false } as const
    story(
      update,
      given(open),
      message(chrome(Chrome.Message.ToggledPublic({ isPublic: true }))),
      Command.expectExact(SetBoardVisibility({ boardId: board.id, isPublic: true })),
      Command.resolve(
        SetBoardVisibility({ boardId: board.id, isPublic: true }),
        Chrome.Message.FailedSetVisibility({ needsProfile: true }),
      ),
      model(({ visibility, chrome: { publishing } }) => {
        expect(visibility).toBe('private')
        expect(publishing).toEqual(Publishing.Failed({ needsProfile: true }))
      }),
      message(chrome(Chrome.Message.ToggledPublic({ isPublic: true }))),
      Command.resolve(
        SetBoardVisibility({ boardId: board.id, isPublic: true }),
        Chrome.Message.SucceededSetVisibility({
          board: withPins([knitPin, shoesPin], { visibility: 'public', check: pending, publicPins: [knitPin.id] }),
        }),
      ),
      // The board the server answers says which pins others see: a piece shows them only with a picture of its own.
      Command.expectNone(),
      model(({ visibility, check, chrome: { publishing }, version, publicPins }) => {
        expect(visibility).toBe('public')
        expect(check).toEqual(Option.some(pending))
        expect(Publishing.guards.Idle(publishing)).toBe(true)
        expect(version).toBe(2)
        expect(publicPins).toEqual([knitPin.id])
      }),
    )
  })

  test('moods are saved as they are picked, at most three', () => {
    story(
      update,
      given(modifyFields(open, { chrome: (current) => Chrome.withMoods(current, ['rain', 'office', 'weekend']) })),
      message(chrome(Chrome.Message.ToggledMood({ mood: 'sport' }))),
      model(({ chrome: { moods } }) => expect(moods).toEqual(['rain', 'office', 'weekend'])),
      message(chrome(Chrome.Message.ToggledMood({ mood: 'office' }))),
      Command.expectExact(
        SetBoardMoods({ boardId: board.id, moods: ['rain', 'weekend'], previous: ['rain', 'office', 'weekend'] }),
      ),
      Command.resolve(
        SetBoardMoods({ boardId: board.id, moods: ['rain', 'weekend'], previous: ['rain', 'office', 'weekend'] }),
        Chrome.Message.SucceededSetBoardMoods({ board: withPins([knitPin], { moods: ['rain', 'weekend'] }) }),
      ),
      model(({ chrome: { moods } }) => expect(moods).toEqual(['rain', 'weekend'])),
    )
  })

  test('moods that do not save go back to the ones before, unless they were changed again since', () => {
    const picked = update(open, chrome(Chrome.Message.ToggledMood({ mood: 'rain' }))).model
    expect(picked.chrome.moods).toEqual(['rain'])
    const failed = update(
      picked,
      chrome(Chrome.Message.FailedSetBoardMoods({ attempted: ['rain'], previous: [] })),
    ).model
    expect(failed.chrome.moods).toEqual([])
    const changedAgain = update(picked, chrome(Chrome.Message.ToggledMood({ mood: 'office' }))).model
    const olderFailed = update(
      changedAgain,
      chrome(Chrome.Message.FailedSetBoardMoods({ attempted: ['rain'], previous: [] })),
    )
    expect(olderFailed.model.chrome.moods).toEqual(['rain', 'office'])
  })

  test('deleting asks once more, then leaves for the boards', () => {
    story(
      update,
      given(open),
      message(chrome(Chrome.Message.ClickedDeleteBoard())),
      model(({ chrome: { removal } }) => expect(Removal.guards.Confirming(removal)).toBe(true)),
      message(chrome(Chrome.Message.ClickedKeepBoard())),
      model(({ chrome: { removal } }) => expect(Removal.guards.Idle(removal)).toBe(true)),
      message(chrome(Chrome.Message.ClickedDeleteBoard())),
      message(chrome(Chrome.Message.ClickedConfirmDelete())),
      Command.expectExact(DeleteBoard),
      Command.resolve(DeleteBoard, Chrome.Message.SucceededDeleteBoard()),
      Command.expectExact(LeaveBoard),
      Command.resolve(LeaveBoard, Chrome.Message.CompletedLeaveBoard()),
    )
  })

  test('a look from the Add sheet lays its pieces on the table as one step, and is pinned', () => {
    const withIds = modifyFields(open, {
      ids: () => [Schema.decodeUnknownSync(BoardItemId)(`bi_${'fresh'.padEnd(22, 'x')}`)],
    })
    story(
      update,
      given(withIds),
      message(add(AddSheet.Message.ClickedAdd())),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      ...storySheetMoved(1),
      message(add(AddSheet.Message.SelectedKind({ kind: 'looks' }))),
      Command.expectExact(AddSheet.LoadLooks),
      Command.resolve(AddSheet.LoadLooks, AddSheet.Message.SucceededLoadLooks({ looks: [look] })),
      message(add(AddSheet.Message.ClickedLook({ lookId: look.id }))),
      Command.expectHas(PinLook({ boardId: board.id, lookId: look.id })),
      ...tableSettled,
      ...storySheetMoved(2),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
      model(({ items, past, addSheet }) => {
        // The knit was on the table already and stays where it is; the shoes join it, and undo takes them off again.
        expect(items.filter(Schema.is(PieceItem)).map(({ pieceId }) => pieceId)).toEqual([knit.id, shoes.id])
        expect(past).toEqual([[knitOnTable]])
        expect(addSheet.picker.sheet.isOpen).toBe(false)
      }),
      Command.resolve(
        PinLook({ boardId: board.id, lookId: look.id }),
        Message.CompletedPinLook({
          maybeBoard: Option.some(
            withPins([{ _tag: 'LookPin', id: pinId('look'), look, addedAt: '2026-10-30T10:00:00.000Z' }, knitPin]),
          ),
        }),
      ),
      model(({ pins, items }) => {
        expect(pins).toHaveLength(2)
        expect(items).toHaveLength(2)
      }),
    )
  })

  test('a Gallery cut-out and a try-on go up as pictures and land on the table when the board holds them', () => {
    const cutout = { ...photo, hasCutout: true }
    const imageId = Schema.decodeUnknownSync(BoardImageId)(`bm_${'cutout'.padEnd(22, 'x')}`)
    const withIds = modifyFields(open, {
      ids: () => [Schema.decodeUnknownSync(BoardItemId)(`bi_${'fresh'.padEnd(22, 'x')}`)],
    })
    const galleryAdd = AddGalleryPicture({ boardId: board.id, photoId: cutout.id, picture: 'cutout' })
    const tryOnAdd = AddTryOnPicture({ boardId: board.id, tryOnId: doneTryOn.id })
    story(
      update,
      given(withIds),
      message(add(AddSheet.Message.SelectedKind({ kind: 'gallery' }))),
      Command.expectExact(AddSheet.LoadPhotos),
      Command.resolve(AddSheet.LoadPhotos, AddSheet.Message.SucceededLoadPhotos({ photos: [cutout] })),
      message(add(AddSheet.Message.ClickedGalleryPhoto({ photoId: cutout.id, picture: 'cutout' }))),
      Command.expectHas(galleryAdd),
      model(({ upload }) => expect(upload).toEqual(Upload.Sending({ count: 1, problem: Option.none() }))),
      Command.resolve(galleryAdd, Message.SucceededAddImage({ imageId })),
      ...tableSettled,
      model(({ items, upload }) => {
        expect(items.filter(Schema.is(ImageItem)).map((item) => item.imageId)).toEqual([imageId])
        expect(Upload.guards.Idle(upload)).toBe(true)
      }),
      message(add(AddSheet.Message.SelectedKind({ kind: 'tryOns' }))),
      Command.expectExact(AddSheet.LoadTryOns),
      Command.resolve(AddSheet.LoadTryOns, AddSheet.Message.SucceededLoadTryOns({ tryOns: [doneTryOn] })),
      message(add(AddSheet.Message.ClickedTryOn({ tryOnId: doneTryOn.id }))),
      Command.expectHas(tryOnAdd),
      Command.resolve(tryOnAdd, Message.FailedAddImage({ problem: 'failed' })),
      model(({ upload }) => expect(upload).toEqual(Upload.Failed({ problem: 'failed' }))),
    )
  })

  test('the × asks first, and Keep leaves the pin where it is', () => {
    story(
      update,
      given(open),
      message(chrome(Chrome.Message.ClickedUnpin({ pinId: knitPin.id }))),
      Command.expectExact(FocusPin),
      model(({ chrome: { unpinning } }) => expect(unpinning).toEqual(Option.some(knitPin.id))),
      Command.resolve(FocusPin, Chrome.Message.CompletedFocusPin()),
      message(chrome(Chrome.Message.ClickedKeepPin({ pinId: knitPin.id }))),
      Command.expectExact(FocusPin),
      Command.resolve(FocusPin, Chrome.Message.CompletedFocusPin()),
      model(({ chrome: { unpinning }, pins }) => {
        expect(unpinning).toEqual(Option.none())
        expect(pins).toHaveLength(1)
      }),
    )
  })

  test('taking a pin off also takes it off the table, as the server answers', () => {
    story(
      update,
      given(open),
      message(chrome(Chrome.Message.ClickedUnpin({ pinId: knitPin.id }))),
      Command.resolve(FocusPin, Chrome.Message.CompletedFocusPin()),
      message(chrome(Chrome.Message.ClickedConfirmUnpin({ pinId: knitPin.id }))),
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
      message(chrome(Chrome.Message.ClickedUnpin({ pinId: knitPin.id }))),
      Command.resolve(FocusPin, Chrome.Message.CompletedFocusPin()),
      message(chrome(Chrome.Message.ClickedConfirmUnpin({ pinId: knitPin.id }))),
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
        Message.CompletedReloadBoard({
          maybeBoard: Option.some(withPins([shoesPin, knitPin], { version: 5, items: [] })),
        }),
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

/** The names of the Commands an update sent. */
const names = (result: { readonly commands?: ReadonlyArray<{ readonly name: string }> }) =>
  (result.commands ?? []).map(({ name }) => name)

describe('a board opened with a session cookie that turns out stale', () => {
  test('is read as the person’s own at first, and as visitors read it once the session is read signed out', () => {
    const opened = appInit(flags(true), urlOf(`/boards/${board.id}`))
    // The cookie's hint is all the page has at first: the board is read as the person's own.
    expect(names(opened)).toContain('LoadBoard')
    const signedOut = appUpdate(opened.model, AppMessage.ReceivedSession({ claims: null })).model
    const failed = appUpdate(
      signedOut,
      AppMessage.GotBoardMessage({ message: Message.FailedLoadBoard({ error: 'Unavailable' }) }),
    ).model
    // Try again goes by the session as the app now knows it, not the cookie the page opened with.
    expect(names(appUpdate(failed, AppMessage.GotBoardMessage({ message: Message.ClickedRetry() })))).toEqual([
      'VisitBoard',
    ])
  })
})
