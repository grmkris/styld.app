import { Board, BoardSummary, OperationId } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { click, Command, expect, given, Mount, role, scene, selector, text } from 'foldkit/scene'
import { describe, test } from 'vitest'
import { Message as AppMessage, update } from '../src/App.ts'
import { at, withBoards, withPieces } from './AppFixtures.ts'
import { CreateBoard, Message as BoardsMessage } from '../src/page/Boards.ts'
import { CreateOutfitBoard, Message as StartMessage } from '../src/page/BoardStart.ts'
import { Dialog } from '@foldkit/ui'
import { sceneSheetMoved, sceneSheetOpened } from './SheetFixtures.ts'
import { Navigate } from '../src/Navigation.ts'
import { BoardsData, ListBoards, ListPieces, Message as DataMessage } from '../src/ServerData.ts'
import { modifyFields } from 'foldkit/struct'
import { view } from '../src/View.ts'
import { boardSummaryFixture } from './BoardFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const boardId = (name: string) => `bd_${name.padEnd(22, 'x')}`
const summary = boardSummaryFixture
const knit = pieceFixture('knit', { name: 'Cable knit' })
const pictureId = `bm_${'sea'.padEnd(22, 'x')}`
const pins = [
  { _tag: 'PiecePin', id: `pn_${'knit'.padEnd(22, 'x')}`, piece: knit, addedAt: '2026-10-31T08:00:00.000Z' },
  {
    _tag: 'PicturePin',
    id: `pn_${'sea'.padEnd(22, 'x')}`,
    imageId: pictureId,
    image: { thumb: '/granted-board-thumbnail', full: '/granted-board-picture' },
    generated: false,
    addedAt: '2026-10-31T07:00:00.000Z',
  },
]
/** The new-board sheet opening on a click, and closing. */
const sheetOpening = [
  Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
  Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
  ...sceneSheetOpened,
]
const sheetClosing = [
  ...sceneSheetMoved(2),
  Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
  Mount.expectEnded(Dialog.AcquireResources),
]

const created = Schema.decodeUnknownSync(Board)({
  id: boardId('new'),
  name: 'My board',
  paper: 'paper',
  version: 0,
  items: [],
  pins: [],
  publicPins: [],
  moods: [],
  visibility: 'private',
  check: null,
  updatedAt: '2026-10-31T09:00:00.000Z',
})

const boardsPage = (boards: ReadonlyArray<BoardSummary>) => withBoards(at('/boards', { signedIn: true }), boards)

describe('the boards list', () => {
  test('reads each board as its name and how many pins it holds, and opens its page', () => {
    scene(
      { update, view },
      given(boardsPage([summary('Sea', { pinCount: 3 })])),
      expect(role('link', { name: /^Sea\s*3 pins$/ })).toHaveAttr('href', `/boards/${boardId('Sea')}`),
    )
  })

  test('shows a board without a collage as its newest pins, and one with no pins as its paper saying so', () => {
    scene(
      { update, view },
      given(boardsPage([summary('Sea', { cover: pins, pinCount: 2 }), summary('Empty', {})])),
      expect(selector(`img[src="${knit.images?.thumb ?? ''}"]`)).toExist(),
      expect(selector('img[src="/granted-board-thumbnail"]')).toExist(),
      expect(text('Nothing pinned yet')).toExist(),
      expect(role('link', { name: /^Empty\s*0 pins$/ })).toExist(),
    )
  })

  test('a list that did not load says so, and Try again reads the app’s boards again', () => {
    scene(
      { update, view },
      given(
        modifyFields(at('/boards', { signedIn: true }), {
          data: (data) => modifyFields(data, { boards: () => BoardsData.Failure({ error: 'Unavailable' }) }),
        }),
      ),
      expect(role('alert')).toHaveText('Your boards didn’t load.'),
      click(role('button', { name: 'Try again' })),
      Command.resolve(ListBoards, DataMessage.SucceededListBoards({ boards: [summary('Sea', { pinCount: 3 })] })),
      expect(role('link', { name: /^Sea\s*3 pins$/ })).toExist(),
    )
  })

  test('the round + opens the new-board sheet; Blank makes a board under the default name and opens it (F-26)', () => {
    scene(
      { update, view },
      given(boardsPage([summary('Sea', {})])),
      click(role('button', { name: 'New board' })),
      ...sheetOpening,
      expect(role('dialog', { name: 'New board' })).toExist(),
      expect(role('button', { name: /^One piece, many outfits/ })).toExist(),
      click(role('button', { name: /^Blank board/ })),
      ...sheetClosing,
      Command.resolve(
        CreateBoard({ name: 'My board', maybeOperationId: Option.none() }),
        BoardsMessage.SucceededCreateBoard({ board: created }),
      ),
      Command.resolve(Navigate({ href: `/boards/${created.id}` }), AppMessage.CompletedNavigate()),
    )
  })

  test('says when a blank board was not made, and asks again under the same operation', () => {
    scene(
      { update, view },
      given(boardsPage([])),
      click(role('button', { name: 'New board' })),
      ...sheetOpening,
      click(role('button', { name: /^Blank board/ })),
      ...sheetClosing,
      Command.resolve(
        CreateBoard,
        BoardsMessage.FailedCreateBoard({ operationId: OperationId.make('create-board-1'), name: 'My board' }),
      ),
      expect(role('alert')).toHaveText('The board wasn’t created. Try again.'),
      expect(text('No boards yet. Make one and lay out an outfit, a trip or a season.')).toExist(),
      Mount.expectEnded(Dialog.AcquireResources),
    )
  })

  test('One piece, many outfits: a piece and a season make the board, and a wardrobe with no outfit says what to add', () => {
    const jeans = pieceFixture('jeans', { type: 'jeans', name: 'Dark jeans' })
    scene(
      { update, view },
      given(withPieces(boardsPage([]), [jeans])),
      click(role('button', { name: 'New board' })),
      ...sheetOpening,
      click(role('button', { name: /^One piece, many outfits/ })),
      Command.resolve(ListPieces, DataMessage.SucceededListPieces({ pieces: [jeans] })),
      expect(text('Pick the piece to build outfits around.')).toExist(),
      expect(role('button', { name: 'Make the outfits' })).toHaveAttr('aria-disabled', 'true'),
      click(role('button', { name: /Dark jeans/ })),
      click(role('button', { name: 'Summer' })),
      click(role('button', { name: 'Make the outfits' })),
      Command.resolve(
        CreateOutfitBoard({
          name: 'Dark jeans: outfits',
          anchorPieceId: jeans.id,
          maybeSeason: Option.some('summer'),
          maybeOperationId: Option.none(),
        }),
        StartMessage.FailedCreateOutfitBoard({
          problem: 'noOutfits',
          missing: ['top', 'shoes'],
          operationId: Option.none(),
        }),
      ),
      expect(role('alert')).toHaveText(
        'Your wardrobe has no complete outfit around this piece yet. Add a top. Add shoes.',
      ),
      click(role('button', { name: 'Make the outfits' })),
      Command.resolve(CreateOutfitBoard, StartMessage.SucceededCreateOutfitBoard({ board: created })),
      ...sheetClosing,
      Command.resolve(Navigate({ href: `/boards/${created.id}` }), AppMessage.CompletedNavigate()),
      Mount.expectEnded(Dialog.AcquireResources),
    )
  })
})
