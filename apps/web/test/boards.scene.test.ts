import { Board, BoardSummary, OperationId } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { click, Command, expect, given, role, scene, selector, text } from 'foldkit/scene'
import { describe, test } from 'vitest'
import { Message as AppMessage, update } from '../src/App.ts'
import { at, withBoards } from './AppFixtures.ts'
import { CreateBoard, Message as BoardsMessage } from '../src/page/Boards.ts'
import { Navigate } from '../src/Navigation.ts'
import { BoardsData, ListBoards, Message as DataMessage } from '../src/ServerData.ts'
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
    generated: false,
    addedAt: '2026-10-31T07:00:00.000Z',
  },
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
      expect(selector(`img[src="/cdn/pieces/${knit.id}/thumb"]`)).toExist(),
      expect(selector(`img[src="/cdn/boards/images/${pictureId}/thumb"]`)).toExist(),
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

  test('starts a new board from the round + at the top, under the default name, and opens it', () => {
    scene(
      { update, view },
      given(boardsPage([summary('Sea', {})])),
      expect(role('textbox')).toBeAbsent(),
      click(role('button', { name: 'New board' })),
      expect(role('button', { name: 'Creating…' })).toBeDisabled(),
      Command.resolve(
        CreateBoard({ name: 'My board', maybeOperationId: Option.none() }),
        BoardsMessage.SucceededCreateBoard({ board: created }),
      ),
      Command.resolve(Navigate({ href: `/boards/${created.id}` }), AppMessage.CompletedNavigate()),
    )
  })

  test('says when a new board was not made, and the + asks again', () => {
    scene(
      { update, view },
      given(boardsPage([])),
      click(role('button', { name: 'New board' })),
      Command.resolve(
        CreateBoard,
        BoardsMessage.FailedCreateBoard({ operationId: OperationId.make('create-board-1'), name: 'My board' }),
      ),
      expect(role('alert')).toHaveText('The board wasn’t created. Try again.'),
      expect(role('button', { name: 'New board' })).toBeEnabled(),
      expect(text('No boards yet. Make one and lay out an outfit, a trip or a season.')).toExist(),
      click(role('button', { name: 'New board' })),
      Command.expectExact(
        CreateBoard({ name: 'My board', maybeOperationId: Option.some(OperationId.make('create-board-1')) }),
      ),
      Command.resolve(CreateBoard, BoardsMessage.SucceededCreateBoard({ board: created })),
      Command.resolve(Navigate, AppMessage.CompletedNavigate()),
    )
  })
})
