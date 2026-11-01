import { Board, BoardItemId, PieceItem } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { expect, given, inside, Mount, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage } from './AppFixtures.ts'
import { MeasurePaper } from '../src/page/Board/Commands.ts'
import { Message as BoardMessage } from '../src/page/Board/Message.ts'
import { fromBoard, init as boardInit } from '../src/page/Board/Model.ts'
import { view } from '../src/View.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

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
    moods: [],
    visibility: 'private',
    check: null,
    updatedAt: '2026-10-31T09:00:00.000Z',
  })
const editing = (items: ReadonlyArray<PieceItem>) =>
  withPage(at(`/boards/${boardId}/collage`, { signedIn: true }), lenses.board, () =>
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
      inside(role('region', { name: 'Your pieces' }), expect(role('toolbar', { name: 'Selected' })).toExist()),
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
      expect(text('Loading…')).toExist(),
    )
    scene(
      { update, view },
      given(editing([knit])),
      measured,
      expect(role('button', { name: 'Save as a look' })).not.toHaveAttr('aria-disabled', 'true'),
      expect(text('Put some of your pieces on the table first.')).not.toExist(),
    )
  })
})
