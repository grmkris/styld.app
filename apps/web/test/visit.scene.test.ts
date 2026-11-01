import { Explore, PublicBoard, PublicLookPage, PublicPiecePage, SearchResults } from '@styld/protocol'
import { Option, Schema } from 'effect'
import {
  all,
  click,
  Command,
  expect,
  given,
  inside,
  nth,
  role,
  scene,
  selector,
  submit,
  text,
  type,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { BoardData, BoardShown } from '../src/page/Board/Model.ts'
import { LookData, LookShown } from '../src/page/Look.ts'
import { Message as PeopleMessage, SetSaved, Subject } from '../src/page/People.ts'
import {
  FocusExploreResults,
  FocusExploreSearch,
  FollowSuggested,
  LoadExplore,
  Message as VisitMessage,
  SearchExplore,
} from '../src/page/Visit.ts'
import { view } from '../src/View.ts'
import { by, knit, nika, opened, shownAs, signedIn, suggested, visiting } from './VisitFixtures.ts'
import { withPage } from './AppFixtures.ts'
import { lenses } from '../src/Page.ts'

/** The knit as it lies on a board's table. */
const knitItem = {
  _tag: 'PieceItem',
  id: `bi_${'knit'.padEnd(22, 'x')}`,
  pieceId: knit.id,
  x: 500,
  y: 600,
  size: 400,
  turn: 0,
  z: 1,
  flipped: false,
}
/** Explore with these boards among Styld's edits and the newest. */
const exploreOf = (edits: ReadonlyArray<object>, newest: ReadonlyArray<object>) =>
  Schema.decodeUnknownSync(Explore)({ edits, featured: [], people: [], newest })

/** Explore with one rainy board among Styld's edits and the newest, and one person to follow. */
const rainyExplore = () => {
  const found = { board: nika.boards[0], by, moods: ['rain'] }
  return Schema.decodeUnknownSync(Explore)({ edits: [found], featured: [], people: [suggested], newest: [found] })
}

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
      expect(text('Top')).toExist(),
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
      expect(role('button', { name: 'Board settings' })).toBeAbsent(),
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

  test('Explore shows Edits from Styld, people to follow and the newest boards, and filters by mood', () => {
    const explore = rainyExplore()
    scene(
      { update, view },
      given(visiting('/explore', shownAs.Explore({ explore }))),
      expect(role('heading', { name: 'Explore' })).toExist(),
      expect(role('heading', { name: 'Edits from Styld' })).toExist(),
      expect(role('heading', { name: 'People to follow' })).toExist(),
      expect(role('link', { name: /^Nika Kovač/ })).toHaveAttr('href', '/@nika.kovac'),
      inside(
        role('group', { name: 'Moods for Explore' }),
        expect(role('button', { name: 'All' })).toHaveAttr('aria-pressed', 'true'),
      ),
      click(role('button', { name: 'Rain' })),
      Command.resolve(LoadExplore, VisitMessage.SucceededLoadExplore({ explore })),
      expect(role('button', { name: 'Rain' })).toHaveAttr('aria-pressed', 'true'),
    )
  })

  test('Explore reads search, Edits from Styld, the newest boards with their moods under the head, then people', () => {
    const explore = rainyExplore()
    const headings = all.role('heading', { level: 2 })
    scene(
      { update, view },
      given(visiting('/explore', shownAs.Explore({ explore }))),
      inside(
        role('main'),
        expect(role('search')).toExist(),
        expect(role('searchbox', { name: 'Search people and boards' })).toExist(),
        expect(nth(headings, 0)).toHaveText('Edits from Styld'),
        expect(nth(headings, 1)).toHaveText('Newest boards'),
        expect(nth(headings, 2)).toHaveText('People to follow'),
      ),
      inside(role('region', { name: 'Newest boards' }), expect(role('group', { name: 'Moods for Explore' })).toExist()),
    )
  })

  test('Explore’s search finds people and boards signed out, and clearing brings the sections back', () => {
    const found = { board: nika.boards[0], by, moods: [] }
    const explore = Schema.decodeUnknownSync(Explore)({ edits: [found], featured: [], people: [], newest: [found] })
    const results = Schema.decodeUnknownSync(SearchResults)({ people: [by], boards: [found] })
    const nothing = Schema.decodeUnknownSync(SearchResults)({ people: [], boards: [] })
    scene(
      { update, view },
      given(visiting('/explore', shownAs.Explore({ explore }))),
      type(role('searchbox', { name: 'Search people and boards' }), 'nika'),
      submit(role('search')),
      expect(role('status')).toHaveText('Searching…'),
      Command.resolve(
        SearchExplore({ query: 'nika' }),
        VisitMessage.SucceededSearchExplore({ query: 'nika', results }),
      ),
      Command.resolve(FocusExploreResults, VisitMessage.CompletedFocusExploreResults()),
      inside(
        role('region', { name: 'Found for “nika”' }),
        expect(role('heading', { name: 'People' })).toExist(),
        expect(role('link', { name: /^Nika Kovač/ })).toHaveAttr('href', '/@nika.kovac'),
        expect(role('heading', { name: 'Boards' })).toExist(),
        expect(role('link', { name: /Coats/ })).toHaveAttr('href', `/boards/bd_${'coats'.padEnd(22, 'x')}`),
      ),
      expect(role('heading', { name: 'Edits from Styld' })).not.toExist(),
      click(role('button', { name: 'Clear the search' })),
      Command.resolve(FocusExploreSearch, VisitMessage.CompletedFocusExploreSearch()),
      expect(role('heading', { name: 'Edits from Styld' })).toExist(),
      type(role('searchbox', { name: 'Search people and boards' }), 'zzz'),
      submit(role('search')),
      Command.resolve(SearchExplore({ query: 'zzz' }), VisitMessage.FailedSearchExplore({ query: 'zzz' })),
      expect(role('alert')).toHaveText('The search didn’t go through.'),
      click(role('button', { name: 'Try again' })),
      Command.resolve(
        SearchExplore({ query: 'zzz' }),
        VisitMessage.SucceededSearchExplore({ query: 'zzz', results: nothing }),
      ),
      Command.resolve(FocusExploreResults, VisitMessage.CompletedFocusExploreResults()),
      expect(role('status')).toHaveText('No people or boards match “zzz”.'),
    )
  })

  test('People to follow are cards with a city, a line of bio and Follow, which signed out signs in and returns', () => {
    const explore = Schema.decodeUnknownSync(Explore)({ edits: [], featured: [], people: [suggested], newest: [] })
    scene(
      { update, view },
      given(visiting('/explore', shownAs.Explore({ explore }))),
      inside(
        role('region', { name: 'People to follow' }),
        expect(role('link', { name: /^Nika Kovač/ })).toHaveAttr('href', '/@nika.kovac'),
        expect(text('Maribor')).toExist(),
        expect(text('Red, black and one good coat.')).toExist(),
        expect(role('link', { name: 'Sign in to follow' })).toHaveAttr('href', '/login?next=%2F%40nika.kovac%23follow'),
        expect(role('link', { name: 'Sign in to follow' })).toHaveText('Follow'),
        expect(role('button', { name: 'Follow' })).not.toExist(),
      ),
    )
  })

  test('signed in, Follow on a card follows, shows Following pressed, and says when a change failed', () => {
    const explore = Schema.decodeUnknownSync(Explore)({ edits: [], featured: [], people: [suggested], newest: [] })
    scene(
      { update, view },
      given(signedIn(visiting('/explore', shownAs.Explore({ explore })))),
      inside(
        role('region', { name: 'People to follow' }),
        expect(role('button', { name: 'Follow' })).toHaveAttr('aria-pressed', 'false'),
        expect(role('button', { name: 'Follow' })).toHaveAttr('aria-describedby', 'explore-person-nika.kovac'),
        click(role('button', { name: 'Follow' })),
        expect(role('button', { name: 'Follow' })).toHaveAttr('aria-disabled', 'true'),
        Command.resolve(
          FollowSuggested({ handle: 'nika.kovac', following: true }),
          VisitMessage.SucceededFollowSuggested({ handle: 'nika.kovac', following: true }),
        ),
        expect(role('button', { name: 'Following' })).toHaveAttr('aria-pressed', 'true'),
        click(role('button', { name: 'Following' })),
        Command.resolve(
          FollowSuggested({ handle: 'nika.kovac', following: false }),
          VisitMessage.FailedFollowSuggested({ handle: 'nika.kovac' }),
        ),
        expect(role('alert')).toHaveText("Couldn't update who you follow. Try again."),
        expect(role('button', { name: 'Following' })).toHaveAttr('aria-pressed', 'true'),
      ),
    )
  })

  test('a board’s card is one link, and a mood with no boards yet says so', () => {
    const found = { board: nika.boards[0], by, moods: [] }
    const explore = Schema.decodeUnknownSync(Explore)({ edits: [found], featured: [], people: [], newest: [] })
    scene(
      { update, view },
      given(visiting('/explore', shownAs.Explore({ explore }))),
      expect(role('link', { name: /Coats/ })).toHaveAttr('href', `/boards/bd_${'coats'.padEnd(22, 'x')}`),
      // Whose it is reads inside the card, which stays the one link.
      expect(role('link', { name: /By Nika Kovač$/ })).toHaveAttr('href', `/boards/bd_${'coats'.padEnd(22, 'x')}`),
      expect(role('link', { name: 'Navy knit' })).toBeAbsent(),
      click(role('button', { name: 'Rain' })),
      Command.resolve(LoadExplore, VisitMessage.SucceededLoadExplore({ explore })),
      expect(text('No public boards in this mood yet.')).toExist(),
    )
  })

  test('while Explore, a profile or a piece loads, its shape holds the page and a status says it is loading', () => {
    scene(
      { update, view },
      given(visiting('/explore', shownAs.Loading())),
      expect(role('heading', { name: 'Explore', level: 1 })).toExist(),
      expect(role('search')).toExist(),
      expect(role('status')).toHaveText('Loading…'),
      expect(role('heading', { level: 2 })).not.toExist(),
    )
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

  test('the landing shows Edits from Styld to someone signed out', () => {
    const found = { board: nika.boards[0], by, moods: [] }
    const explore = Schema.decodeUnknownSync(Explore)({ edits: [found], featured: [], people: [], newest: [] })
    scene(
      { update, view },
      given(visiting('/', shownAs.Explore({ explore }))),
      expect(role('heading', { name: 'Edits from Styld' })).toExist(),
      expect(role('link', { name: /Coats.*By Nika Kovač$/ })).toHaveAttr(
        'href',
        `/boards/bd_${'coats'.padEnd(22, 'x')}`,
      ),
      expect(role('link', { name: 'Explore' })).toHaveAttr('href', '/explore'),
    )
  })

  test('the landing names its boards once they arrive, the newest while Styld has no edits', () => {
    const found = { board: nika.boards[0], by, moods: [] }
    const explore = Schema.decodeUnknownSync(Explore)({ edits: [], featured: [], people: [], newest: [found] })
    scene(
      { update, view },
      given(visiting('/', shownAs.Loading())),
      expect(role('heading', { name: 'Edits from Styld' })).not.toExist(),
      expect(role('heading', { name: 'Newest boards' })).not.toExist(),
      expect(role('status')).toHaveText('Loading…'),
    )
    scene(
      { update, view },
      given(visiting('/', shownAs.Explore({ explore }))),
      expect(role('heading', { name: 'Newest boards' })).toExist(),
      expect(role('heading', { name: 'Edits from Styld' })).not.toExist(),
    )
  })

  test('the landing lays the first public board with something on its table beside its words, in outline until then', () => {
    const coats = { board: nika.boards[0], by, moods: [] }
    const layered = {
      board: {
        ...nika.boards[0],
        id: `bd_${'layers'.padEnd(22, 'x')}`,
        name: 'Layers',
        paper: 'sage',
        items: [knitItem],
      },
      by,
      moods: [],
    }
    const hero = role('region', { name: 'A wardrobe shaped by you.' })
    scene(
      { update, view },
      given(visiting('/', shownAs.Loading())),
      inside(hero, expect(selector('[data-skeleton]')).toExist(), expect(selector('[data-paper]')).not.toExist()),
    )
    scene(
      { update, view },
      given(visiting('/', shownAs.Explore({ explore: exploreOf([coats], [layered]) }))),
      inside(
        hero,
        expect(selector('[data-skeleton]')).not.toExist(),
        expect(selector('[data-paper]')).toHaveAttr('data-paper', 'sage'),
        expect(selector('[data-paper] img')).toHaveAttr('src', `/cdn/public/pieces/${knit.id}/thumb`),
      ),
    )
    scene(
      { update, view },
      // Without a collage anywhere, a board's pins on its paper.
      given(visiting('/', shownAs.Explore({ explore: exploreOf([coats], []) }))),
      inside(
        hero,
        expect(selector('[data-skeleton]')).not.toExist(),
        expect(selector('[data-paper]')).toHaveAttr('data-paper', 'paper'),
      ),
    )
  })

  test('the landing says when its boards did not load, and reads them again on Try again', () => {
    const found = { board: nika.boards[0], by, moods: [] }
    const explore = Schema.decodeUnknownSync(Explore)({ edits: [found], featured: [], people: [], newest: [] })
    scene(
      { update, view },
      given(visiting('/', shownAs.Failed())),
      expect(role('alert')).toHaveText("The boards didn't load."),
      expect(role('link', { name: 'Start free' })).toHaveAttr('href', '/login'),
      click(role('button', { name: 'Try again' })),
      Command.resolve(LoadExplore, VisitMessage.SucceededLoadExplore({ explore })),
      expect(role('heading', { name: 'Edits from Styld' })).toExist(),
    )
  })

  test('signed out, the sign-in page keeps Explore in the bar and drops Sign in', () => {
    scene(
      { update, view },
      given(opened('/login')),
      inside(
        role('banner'),
        expect(role('link', { name: 'Explore' })).toHaveAttr('href', '/explore'),
        expect(role('link', { name: 'Sign in' })).not.toExist(),
      ),
    )
  })
})
