import { Board, BoardItemId, PieceItem } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { click, Command, expect, given, Mount, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage, withPieces } from './AppFixtures.ts'
import { MeasurePaper } from '../src/page/Board/Commands.ts'
import { Message as BoardMessage } from '../src/page/Board/Message.ts'
import { fromBoard, init as boardInit } from '../src/page/Board/Model.ts'
import { view } from '../src/View.ts'
import { pieceFixture } from './WardrobeFixtures.ts'
import { Dialog } from '@foldkit/ui'
import { sceneSheetOpened } from './SheetFixtures.ts'

const boardId = `bd_${'weekend'.padEnd(22, 'x')}`
const knit = PieceItem.make({
  id: Schema.decodeUnknownSync(BoardItemId)(`bi_${'knit'.padEnd(22, 'x')}`),
  pieceId: pieceFixture('knit').id,
  x: 300,
  y: 320,
  size: 400,
  turn: 0,
  z: 1,
  flipped: false,
})
const boardWith = (items: ReadonlyArray<PieceItem>) =>
  Schema.decodeUnknownSync(Board)({
    id: boardId,
    name: 'Weekend',
    paper: 'paper',
    version: 1,
    items,
    pins: [],
    publicPins: [],
    moods: [],
    visibility: 'private',
    check: null,
    updatedAt: '2026-10-31T09:00:00.000Z',
  })
const editing = (items: ReadonlyArray<PieceItem>, locale: 'en' | 'sl' = 'en') =>
  withPage(at(`/boards/${boardId}/collage`, { signedIn: true, locale }), lenses.board, () =>
    fromBoard(boardInit(boardId, true), boardWith(items)),
  )

/** The table reports its width once it is on the page. */
const measured = Mount.resolve(MeasurePaper, BoardMessage.MeasuredPaper({ width: 500 }))

describe('the collage editor', () => {
  test('puts the selected piece’s actions in the tray, in view, and the paper under the table otherwise', () => {
    scene(
      { update, view },
      given(editing([knit])),
      measured,
      expect(role('group', { name: 'Paper' })).toExist(),
      expect(role('toolbar', { name: 'Selected' })).not.toExist(),
    )
    scene(
      { update, view },
      given(
        withPage(editing([knit]), lenses.board, (board) =>
          modifyFields(board, { maybeSelectedId: () => Option.some(knit.id) }),
        ),
      ),
      measured,
      expect(role('toolbar', { name: 'Selected' })).toExist(),
      expect(role('button', { name: 'Send to back' })).toExist(),
      expect(role('button', { name: 'Forward' })).not.toExist(),
      expect(role('group', { name: 'Paper' })).not.toExist(),
    )
  })

  test('names every tool, and holds Save as a look until a piece is on the table', () => {
    scene(
      { update, view },
      given(editing([])),
      measured,
      expect(role('toolbar', { name: 'Board tools' })).toExist(),
      expect(role('button', { name: 'Undo' })).toExist(),
      expect(role('button', { name: 'Add text' })).toExist(),
      expect(role('button', { name: 'Paste' })).toExist(),
      expect(role('button', { name: 'Save as a look' })).toHaveAttr('aria-disabled', 'true'),
      expect(role('button', { name: 'Save as a look' })).toHaveAttr('aria-describedby', 'board-look-hint'),
      expect(text('Put some of your pieces on the table first.')).toExist(),
      expect(role('button', { name: 'Add your piece' })).toExist(),
    )
    scene(
      { update, view },
      given(editing([knit])),
      measured,
      expect(role('button', { name: 'Save as a look' })).not.toHaveAttr('aria-disabled', 'true'),
      expect(text('Put some of your pieces on the table first.')).not.toExist(),
    )
  })

  test('Select pieces turns taps into ticks for a look, holds Save until one is ticked, and Done leaves it', () => {
    scene(
      { update, view },
      given(editing([knit])),
      measured,
      expect(role('button', { name: 'Select pieces' })).toHaveAttr('aria-pressed', 'false'),
      click(role('button', { name: 'Select pieces' })),
      expect(role('button', { name: 'Done' })).toHaveAttr('aria-pressed', 'true'),
      expect(text('Tap the pieces that make the look.')).toExist(),
      expect(role('button', { name: 'Save as a look' })).toHaveAttr('aria-disabled', 'true'),
      click(role('button', { name: 'Done' })),
      expect(role('button', { name: 'Select pieces' })).toExist(),
      expect(role('button', { name: 'Save as a look' })).not.toHaveAttr('aria-disabled', 'true'),
    )
  })

  test('tells every piece in its tray apart: its name, or what it is and its colours, in both languages', () => {
    const wardrobe = [
      pieceFixture('knit', { type: 'knitwear', colours: ['white', 'navy'] }),
      pieceFixture('tee', { type: 'shirts', colours: ['black'] }),
      pieceFixture('plain', { type: 'shirts' }),
      pieceFixture('coat', { name: 'Navy wool coat', type: 'coats', colours: ['navy'] }),
    ]
    scene(
      { update, view },
      given(withPieces(editing([knit]), wardrobe)),
      measured,
      click(role('button', { name: 'Add your piece' })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      ...sceneSheetOpened,
      expect(role('button', { name: 'Select Knit (white and navy)' })).toExist(),
      expect(role('button', { name: 'Put Shirt (black) on the table' })).toExist(),
      expect(role('button', { name: 'Put Shirt on the table' })).toExist(),
      expect(role('button', { name: 'Put Navy wool coat on the table' })).toExist(),
    )
    scene(
      { update, view },
      given(withPieces(editing([knit], 'sl'), wardrobe)),
      measured,
      click(role('button', { name: 'Dodaj svoj kos' })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      ...sceneSheetOpened,
      expect(role('button', { name: 'Izberi: Pletenina (bela in mornarsko modra)' })).toExist(),
      expect(role('button', { name: 'Položi na mizo: Srajca (črna)' })).toExist(),
      expect(role('button', { name: 'Položi na mizo: Navy wool coat' })).toExist(),
    )
  })
  test('filters the sheet by category and type, and clears the type when the category changes', () => {
    const wardrobe = [
      pieceFixture('boot', { type: 'boots', name: 'Walking boots' }),
      pieceFixture('heel', { type: 'heels', name: 'Evening heels' }),
      pieceFixture('pants', { type: 'trousers', name: 'Blue trousers' }),
    ]
    scene(
      { update, view },
      given(withPieces(editing([]), wardrobe)),
      measured,
      click(role('button', { name: 'Add your piece' })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      ...sceneSheetOpened,
      click(role('button', { name: 'Shoes' })),
      expect(role('button', { name: 'Put Blue trousers on the table' })).not.toExist(),
      click(role('button', { name: 'Boots' })),
      expect(role('button', { name: 'Put Walking boots on the table' })).toExist(),
      expect(role('button', { name: 'Put Evening heels on the table' })).not.toExist(),
      click(role('button', { name: 'Clothing' })),
      expect(role('button', { name: 'Put Blue trousers on the table' })).toExist(),
      expect(role('button', { name: 'Put Walking boots on the table' })).not.toExist(),
    )
  })
})
