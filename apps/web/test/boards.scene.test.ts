import { Board, BoardSummary } from '@styld/protocol'
import { Schema } from 'effect'
import { click, Command, expect, given, role, scene, selector, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Message as AppMessage, update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage } from './AppFixtures.ts'
import { BoardsData, CreateBoard, Message as BoardsMessage } from '../src/page/Boards.ts'
import { Navigate } from '../src/Navigation.ts'
import { view } from '../src/View.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const boardId = (name: string) => `bd_${name.padEnd(22, 'x')}`
const summary = (name: string, changes: object) =>
  Schema.decodeUnknownSync(BoardSummary)({
    id: boardId(name),
    name,
    paper: 'paper',
    items: [],
    cover: [],
    pinCount: 0,
    visibility: 'private',
    updatedAt: '2026-10-31T08:00:00.000Z',
    ...changes,
  })
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

const boardsPage = (boards: ReadonlyArray<BoardSummary>) =>
  withPage(at('/boards', { signedIn: true }), lenses.boards, (current) =>
    modifyFields(current, { boards: () => BoardsData.Success({ data: boards }) }),
  )

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

  test('starts a new board from the round + at the top, under the default name, and opens it', () => {
    scene(
      { update, view },
      given(boardsPage([summary('Sea', {})])),
      expect(role('textbox')).toBeAbsent(),
      click(role('button', { name: 'New board' })),
      expect(role('button', { name: 'Creating…' })).toBeDisabled(),
      Command.resolve(CreateBoard({ name: 'My board' }), BoardsMessage.SucceededCreateBoard({ board: created })),
      Command.resolve(Navigate({ href: `/boards/${created.id}` }), AppMessage.CompletedNavigate()),
    )
  })

  test('says when a new board was not made, and the + asks again', () => {
    scene(
      { update, view },
      given(boardsPage([])),
      click(role('button', { name: 'New board' })),
      Command.resolve(CreateBoard, BoardsMessage.FailedCreateBoard()),
      expect(role('alert')).toHaveText('The board wasn’t created. Try again.'),
      expect(role('button', { name: 'New board' })).toBeEnabled(),
      expect(text('No boards yet. Make one and lay out an outfit, a trip or a season.')).toExist(),
    )
  })
})
