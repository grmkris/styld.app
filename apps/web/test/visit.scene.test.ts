import { PublicBoard, PublicLookPage, PublicPiecePage } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { click, Command, expect, given, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { BoardData, BoardShown } from '../src/page/Board/Model.ts'
import { LookData, LookShown } from '../src/page/Look.ts'
import { Message as PeopleMessage, SetSaved, Subject } from '../src/page/People.ts'
import { view } from '../src/View.ts'
import { by, knit, nika, opened, shownAs, signedIn, visiting } from './VisitFixtures.ts'
import { withPage } from './AppFixtures.ts'
import { lenses } from '../src/Page.ts'

describe('a public profile', () => {
  test('shows the person and their public boards and looks, signed out', () => {
    scene(
      { update, view },
      given(visiting('/@nika.kovac', shownAs.Person({ profile: nika }))),
      expect(role('heading', { name: 'Nika Kovač' })).toExist(),
      expect(text('@nika.kovac, Maribor')).toExist(),
      expect(text('Red, black and one good coat.')).toExist(),
      // Follow looks as it does signed in, and sign-in brings the visitor back here.
      expect(role('link', { name: 'Sign in to follow' })).toHaveAttr('href', '/login?next=%2F%40nika.kovac%23follow'),
      expect(role('link', { name: 'Sign in to follow' })).toHaveText('Follow'),
      expect(role('link', { name: /Coats/ })).toHaveAttr('href', `/boards/bd_${'coats'.padEnd(22, 'x')}`),
      click(role('button', { name: 'Looks' })),
      expect(role('button', { name: 'Looks' })).toHaveAttr('aria-pressed', 'true'),
      expect(text('No public looks yet.')).toExist(),
      expect(role('button', { name: 'Pieces' })).toBeAbsent(),
    )
  })

  test('a missing profile says so', () => {
    scene(
      { update, view },
      given(visiting('/@nobody', shownAs.Missing())),
      expect(role('heading', { name: 'Page not found' })).toExist(),
    )
  })

  test('shows a public piece with whose it is', () => {
    const page = Schema.decodeUnknownSync(PublicPiecePage)({
      yours: false,
      piece: knit,
      by: { handle: 'nika.kovac', name: 'Nika Kovač', tone: 'clay' },
    })
    scene(
      { update, view },
      given(visiting(`/pieces/${knit.id}`, shownAs.Piece({ page }))),
      expect(role('heading', { name: 'Navy knit' })).toExist(),
      expect(text('T-shirt')).toExist(),
      expect(role('img', { name: 'Navy knit' })).toHaveAttr('src', `/cdn/public/pieces/${knit.id}/full`),
      expect(role('link', { name: /By Nika Kovač/ })).toHaveAttr('href', '/@nika.kovac'),
      expect(role('link', { name: 'Sign in to save' })).toHaveAttr('href', `/login?next=%2Fpieces%2F${knit.id}`),
      expect(role('button', { name: 'Report piece' })).toBeAbsent(),
      // From a shared link Back goes to whose it is; opened from a board, Back returns to the board.
      expect(role('link', { name: 'Back' })).toHaveAttr('href', '/@nika.kovac'),
    )
    const board = `/boards/bd_${'coats'.padEnd(22, 'x')}`
    scene(
      { update, view },
      given(
        withPage(visiting(`/pieces/${knit.id}`, shownAs.Piece({ page })), lenses.visit, (visit) =>
          modifyFields(visit, { cameFrom: () => Option.some(board) }),
        ),
      ),
      expect(role('link', { name: 'Back' })).toHaveAttr('href', board),
    )
  })

  test('one’s own public piece says so and opens in the wardrobe, with no byline and nothing to save or report', () => {
    const page = Schema.decodeUnknownSync(PublicPiecePage)({ yours: true, piece: knit, by })
    scene(
      { update, view },
      given(signedIn(visiting(`/pieces/${knit.id}`, shownAs.Piece({ page })))),
      expect(text('This piece is yours')).toExist(),
      expect(role('link', { name: 'Open in your wardrobe' })).toHaveAttr('href', `/wardrobe/${knit.id}`),
      expect(role('link', { name: /By Nika Kovač/ })).toBeAbsent(),
      expect(role('button', { name: 'Report piece' })).toBeAbsent(),
    )
  })

  test('shows someone else’s public board and shared look to a visitor, read only, with a round Save', () => {
    const board = Schema.decodeUnknownSync(PublicBoard)({
      ...nika.boards[0],
      pins: nika.boards[0]?.cover ?? [],
      by,
    })
    scene(
      { update, view },
      given(
        withPage(signedIn(opened(`/boards/${board.id}`)), lenses.board, (page) =>
          modifyFields(page, { board: () => BoardData.Success({ data: BoardShown.Visiting({ board }) }) }),
        ),
      ),
      expect(role('heading', { name: 'Coats' })).toExist(),
      expect(role('link', { name: /By Nika Kovač/ })).toHaveAttr('href', '/@nika.kovac'),
      expect(role('link', { name: 'Navy knit' })).toHaveAttr('href', `/pieces/${knit.id}`),
      expect(role('button', { name: 'Board options' })).toBeAbsent(),
      expect(role('button', { name: 'Save' })).toHaveAttr('aria-pressed', 'false'),
      click(role('button', { name: 'Save' })),
      Command.resolve(
        SetSaved({ subject: Subject.Board({ boardId: board.id }), saved: true }),
        PeopleMessage.SucceededSetSaved({ saved: true }),
      ),
      expect(role('button', { name: 'Save' })).toHaveAttr('aria-pressed', 'true'),
      expect(role('button', { name: 'Report board' })).toExist(),
    )
    const page = Schema.decodeUnknownSync(PublicLookPage)({
      look: {
        id: `lk_${'monday'.padEnd(22, 'x')}`,
        name: 'Monday',
        occasion: 'Office',
        pieces: [knit],
        sharedAt: '2026-10-30T08:00:00.000Z',
        generated: false,
      },
      by,
    })
    scene(
      { update, view },
      given(
        withPage(signedIn(opened(`/looks/${page.look.id}`)), lenses.look, (look) =>
          modifyFields(look, { look: () => LookData.Success({ data: LookShown.Visiting({ page }) }) }),
        ),
      ),
      expect(role('heading', { name: 'Monday' })).toExist(),
      expect(text('Office')).toExist(),
      expect(role('link', { name: 'Navy knit' })).toHaveAttr('href', `/pieces/${knit.id}`),
      expect(role('button', { name: 'Delete' })).toBeAbsent(),
      expect(role('button', { name: 'Report look' })).toExist(),
    )
  })

  test('while a profile or a piece loads, its shape holds the page and a status says it is loading', () => {
    scene(
      { update, view },
      given(visiting('/@nika.kovac', shownAs.Loading())),
      expect(role('status')).toHaveText('Loading…'),
    )
    scene(
      { update, view },
      given(visiting(`/pieces/${knit.id}`, shownAs.Loading())),
      expect(role('status')).toHaveText('Loading…'),
    )
  })
})
