import { BoardId, OperationId, PublicBoard } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { click, Command, expect, given, role, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { BoardData, BoardShown } from '../src/page/Board/Model.ts'
import { Message as TryMessage, TryIt } from '../src/page/Board/TryIt.ts'
import { lenses } from '../src/Page.ts'
import { view } from '../src/View.ts'
import { withPage } from './AppFixtures.ts'
import { by, nika, opened, signedIn } from './VisitFixtures.ts'

// Try with my wardrobe (owner, 4 November 2026): on a public board that shows generated pieces, a new private board
// of the visitor's own pieces, and how many came from their wardrobe. Signed out it leads to sign-in and back.

const generatedBoard = Schema.decodeUnknownSync(PublicBoard)({
  ...nika.boards[0],
  pins: nika.boards[0]?.cover ?? [],
  by,
  generated: true,
})
const tried = BoardId.make(`bd_${'mine'.padEnd(22, 'x')}`)

const visitingBoard = (board: PublicBoard, signedInToo: boolean) => {
  const page = opened(`/boards/${board.id}`)
  return withPage(signedInToo ? signedIn(page) : page, lenses.board, (current) =>
    modifyFields(current, { board: () => BoardData.Success({ data: BoardShown.Visiting({ board }) }) }),
  )
}

describe('Try with my wardrobe', () => {
  test('makes the visitor’s own board and says how many pieces came from their wardrobe', () => {
    scene(
      { update, view },
      given(visitingBoard(generatedBoard, true)),
      click(role('button', { name: 'Try with my wardrobe' })),
      Command.resolve(
        TryIt({ boardId: generatedBoard.id, maybeOperationId: Option.none() }),
        TryMessage.SucceededTry({ tried: { boardId: tried, fromWardrobe: 2, of: 3 } }),
      ),
      expect(role('status')).toHaveText('2 of 3 from your wardrobe'),
      expect(role('link', { name: 'Open your board' })).toHaveAttr('href', `/boards/${tried}`),
    )
  })

  test('tried again after a failure, it sends the same operation, so a lost answer makes no second board', () => {
    const operationId = OperationId.make('try-lost-answer')
    scene(
      { update, view },
      given(visitingBoard(generatedBoard, true)),
      click(role('button', { name: 'Try with my wardrobe' })),
      Command.resolve(
        TryIt({ boardId: generatedBoard.id, maybeOperationId: Option.none() }),
        TryMessage.FailedTry({ operationId }),
      ),
      expect(role('alert')).toHaveText("That didn't work. Try again."),
      click(role('button', { name: 'Try with my wardrobe' })),
      Command.resolve(
        TryIt({ boardId: generatedBoard.id, maybeOperationId: Option.some(operationId) }),
        TryMessage.SucceededTry({ tried: { boardId: tried, fromWardrobe: 1, of: 3 } }),
      ),
      expect(role('status')).toHaveText('1 of 3 from your wardrobe'),
    )
  })

  test('signed out, leads to sign-in and back to the board', () => {
    scene(
      { update, view },
      given(visitingBoard(generatedBoard, false)),
      expect(role('link', { name: 'Try with my wardrobe' })).toHaveAttr(
        'href',
        `/login?next=${encodeURIComponent(`/boards/${generatedBoard.id}`)}`,
      ),
    )
  })

  test('is not offered on a board with nothing generated', () => {
    const board = Schema.decodeUnknownSync(PublicBoard)({ ...generatedBoard, generated: false })
    scene(
      { update, view },
      given(visitingBoard(board, true)),
      expect(role('button', { name: 'Try with my wardrobe' })).toBeAbsent(),
    )
  })

  test('says it in Slovenian to a Slovenian reader', () => {
    scene(
      { update, view },
      given(
        modifyFields(visitingBoard(generatedBoard, true), {
          context: (context) => ({ ...context, locale: 'sl' as const }),
        }),
      ),
      click(role('button', { name: 'Preizkusi s svojo omaro' })),
      Command.resolve(
        TryIt({ boardId: generatedBoard.id, maybeOperationId: Option.none() }),
        TryMessage.SucceededTry({ tried: { boardId: tried, fromWardrobe: 5, of: 7 } }),
      ),
      expect(role('status')).toHaveText('5 od 7 iz tvoje omare'),
    )
  })
})
