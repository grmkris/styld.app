import { Board } from '@styld/protocol'
import { Schema } from 'effect'
import { Dialog } from '@foldkit/ui'
import { click, Command, expect, given, Mount, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { Message as BoardMessage } from '../src/page/Board/Message.ts'
import { fromBoard, init as boardInit } from '../src/page/Board/Model.ts'
import { FocusPin, UnpinThings } from '../src/page/Board/PageCommands.ts'
import { view } from '../src/View.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage, withPieces } from './AppFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const boardId = `bd_${'weekend'.padEnd(22, 'x')}`
const knit = pieceFixture('knit', { name: 'Cable knit' })
const board = Schema.decodeUnknownSync(Board)({
  id: boardId,
  name: 'Weekend',
  paper: 'paper',
  version: 1,
  items: [],
  pins: [{ _tag: 'PiecePin', id: `pn_${'knit'.padEnd(22, 'x')}`, piece: knit, addedAt: '2026-10-31T09:00:00.000Z' }],
  publicPins: [],
  moods: [],
  visibility: 'private',
  check: null,
  updatedAt: '2026-10-31T09:00:00.000Z',
})
const page = withPage(at(`/boards/${boardId}`, { signedIn: true }), lenses.board, () =>
  fromBoard(boardInit(boardId, true), board),
)

/** The board's page with its picker open over the person's pieces, in `locale`. */
const picking = (locale: 'en' | 'sl') =>
  withPieces(
    withPage(at(`/boards/${boardId}`, { signedIn: true, locale }), lenses.board, () =>
      modifyFields(fromBoard(boardInit(boardId, true), board), { picker: (picker) => ({ ...picker, isOpen: true }) }),
    ),
    [
      knit,
      pieceFixture('tee', { type: 'shirts', colours: ['white', 'blue'] }),
      pieceFixture('shoes', { type: 'flats', colours: ['black'] }),
    ],
  )

describe("a board's page", () => {
  test('keeps the way back and says what it is doing while the board loads', () => {
    scene(
      { update, view },
      given(withPage(page, lenses.board, () => boardInit(boardId, true))),
      expect(role('status')).toHaveText('Opening your board…'),
      expect(role('link', { name: 'All boards' })).toHaveAttr('href', '/boards'),
      expect(role('heading', { level: 1 })).not.toExist(),
    )
  })

  test('says when visitors see fewer pins than are pinned, as the board it read says', () => {
    const shown = withPage(at(`/boards/${boardId}`, { signedIn: true }), lenses.board, () =>
      fromBoard(boardInit(boardId, true), { ...board, visibility: 'public', publicPins: [] }),
    )
    scene(
      { update, view },
      given(shown),
      expect(text('1 pin, 0 of them public on your profile')).toExist(),
      expect(text('Only you see this one until it has its own picture and passes Styld’s check')).toExist(),
    )
  })

  test('marks no pin when visitors see every one of them', () => {
    const shown = withPage(at(`/boards/${boardId}`, { signedIn: true }), lenses.board, () =>
      fromBoard(boardInit(boardId, true), {
        ...board,
        visibility: 'public',
        publicPins: board.pins.map(({ id }) => id),
      }),
    )
    scene(
      { update, view },
      given(shown),
      expect(text('1 pin, 0 of them public on your profile')).not.toExist(),
      expect(text('Only you see this one until it has its own picture and passes Styld’s check')).not.toExist(),
    )
  })

  test('says where it stands under its name, and offers a collage after the pins while there is none', () => {
    scene(
      { update, view },
      given(page),
      expect(text('1 pin, only you can see it')).toExist(),
      expect(text('Lay this pin out on a table.')).toExist(),
      expect(role('link', { name: 'Make a collage' })).toHaveAttr('href', `/boards/${boardId}/collage`),
      expect(role('link', { name: 'Edit collage' })).not.toExist(),
    )
  })

  test('asks before a pin comes off, since it leaves the collage too', () => {
    scene(
      { update, view },
      given(page),
      click(role('button', { name: 'Take Cable knit off the board' })),
      Command.resolve(FocusPin, BoardMessage.CompletedFocusPin()),
      expect(role('group', { name: 'Take Cable knit off the board' })).toHaveText(
        /Take it off the board\? It comes off the collage too\./,
      ),
      click(role('button', { name: 'Keep' })),
      Command.resolve(FocusPin, BoardMessage.CompletedFocusPin()),
      expect(role('button', { name: 'Keep' })).not.toExist(),
      click(role('button', { name: 'Take Cable knit off the board' })),
      Command.resolve(FocusPin, BoardMessage.CompletedFocusPin()),
      click(role('button', { name: 'Take off' })),
      Command.expectExact(UnpinThings),
      Command.resolve(UnpinThings, BoardMessage.SucceededPins({ board: { ...board, pins: [], version: 2 } })),
      expect(role('button', { name: 'Take Cable knit off the board' })).not.toExist(),
    )
  })

  test('the picker tells each piece apart by its name, or what it is and its colours', () => {
    scene(
      { update, view },
      given(picking('en')),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      expect(role('button', { name: 'Shirt (white and blue)' })).toExist(),
      expect(role('button', { name: 'Flats (black)' })).toExist(),
    )
    scene(
      { update, view },
      given(picking('sl')),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      expect(role('button', { name: 'Srajca (bela in modra)' })).toExist(),
      expect(role('button', { name: 'Balerinke (črna)' })).toExist(),
    )
  })
})
