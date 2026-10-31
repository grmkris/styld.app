import { catalogVersion } from '@styld/i18n'
import { Explore, PublicBoard, PublicLookPage, PublicPiecePage, PublicProfile, Relation } from '@styld/protocol'
import { Schema } from 'effect'
import { click, Command, expect, given, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { init, Message, type Model, Session, update } from '../src/App.ts'
import { BoardState } from '../src/page/Board/Model.ts'
import { Shown as LookShown } from '../src/page/Look.ts'
import { Message as PeopleMessage } from '../src/page/People.ts'
import { LoadExplore, Message as VisitMessage, Shown } from '../src/page/Visit.ts'
import { view } from '../src/View.ts'

const knit = { id: `pc_${'knit'.padEnd(22, 'x')}`, name: 'Navy knit', category: 'top', subcategory: null, colours: [] }
const nika = Schema.decodeUnknownSync(PublicProfile)({
  handle: 'nika.kovac',
  name: 'Nika Kovač',
  city: 'Maribor',
  bio: 'Red, black and one good coat.',
  tone: 'clay',
  boards: [
    {
      id: `bd_${'coats'.padEnd(22, 'x')}`,
      name: 'Coats',
      paper: 'paper',
      items: [],
      cover: [
        {
          _tag: 'PublicPiecePin',
          id: `pn_${'knit'.padEnd(22, 'x')}`,
          piece: knit,
          addedAt: '2026-10-30T08:00:00.000Z',
        },
      ],
      pinCount: 1,
      publishedAt: '2026-10-30T08:00:00.000Z',
    },
  ],
  looks: [],
  pieces: [knit],
})

const opened = (pathname: string) =>
  modifyFields(
    init({
      locale: 'en',
      catalogVersion,
      timeZone: 'UTC',
      referenceTime: 0,
      pathname,
      origin: 'https://styld.test',
      telemetryConsent: 'denied',
    }).model,
    { session: () => Session.SignedOut() },
  )
const visiting = (pathname: string, shown: Shown) =>
  modifyFields(opened(pathname), { visit: (visit) => modifyFields(visit, { shown: () => shown }) })
const by = { handle: 'nika.kovac', name: 'Nika Kovač', tone: 'clay' }
const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }
const signedIn = (model: Model): Model => ({ ...model, session: Session.SignedIn({ claims }) })

describe('a public profile', () => {
  test('shows the person and their public boards, looks and pieces, signed out', () => {
    scene(
      { update, view },
      given(visiting('/@nika.kovac', Shown.Person({ profile: nika }))),
      expect(role('heading', { name: 'Nika Kovač' })).toExist(),
      expect(text('@nika.kovac · Maribor')).toExist(),
      expect(text('Red, black and one good coat.')).toExist(),
      expect(role('link', { name: 'Sign in to follow' })).toHaveAttr('href', '/login'),
      expect(role('link', { name: /Coats/ })).toHaveAttr('href', `/boards/bd_${'coats'.padEnd(22, 'x')}`),
      click(role('button', { name: 'Looks' })),
      expect(role('button', { name: 'Looks' })).toHaveAttr('aria-pressed', 'true'),
      expect(text('Nothing here yet.')).toExist(),
      click(role('button', { name: 'Pieces' })),
      expect(role('link', { name: 'Navy knit' })).toHaveAttr('href', `/pieces/${knit.id}`),
    )
  })

  test('keeps the wardrobe off when its owner hides it, and a missing profile says so', () => {
    scene(
      { update, view },
      given(visiting('/@nika.kovac', Shown.Person({ profile: { ...nika, pieces: null } }))),
      expect(role('button', { name: 'Pieces' })).toBeAbsent(),
    )
    scene(
      { update, view },
      given(visiting('/@nobody', Shown.Missing())),
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
      given(visiting(`/pieces/${knit.id}`, Shown.Piece({ page }))),
      expect(role('heading', { name: 'Navy knit' })).toExist(),
      expect(role('img', { name: 'Navy knit' })).toHaveAttr('src', `/cdn/public/pieces/${knit.id}/full`),
      expect(role('link', { name: /By Nika Kovač/ })).toHaveAttr('href', '/@nika.kovac'),
      expect(role('link', { name: 'Sign in to save' })).toHaveAttr('href', '/login'),
      expect(role('button', { name: 'Save to wishlist' })).toBeAbsent(),
      expect(role('button', { name: 'Report piece' })).toBeAbsent(),
    )
  })

  test('one’s own public piece opens in the wardrobe, with nothing to save or report', () => {
    const page = Schema.decodeUnknownSync(PublicPiecePage)({ yours: true, piece: knit, by })
    scene(
      { update, view },
      given(signedIn(visiting(`/pieces/${knit.id}`, Shown.Piece({ page })))),
      expect(role('link', { name: 'Yours: open it in your wardrobe' })).toHaveAttr('href', `/wardrobe/${knit.id}`),
      expect(role('button', { name: 'Save to wishlist' })).toBeAbsent(),
      expect(role('button', { name: 'Report piece' })).toBeAbsent(),
    )
  })

  test('shows someone else’s public board and shared look to a visitor, read only', () => {
    const board = Schema.decodeUnknownSync(PublicBoard)({
      ...nika.boards[0],
      pins: nika.boards[0]?.cover ?? [],
      by,
    })
    scene(
      { update, view },
      given(
        modifyFields(signedIn(opened(`/boards/${board.id}`)), {
          board: (page) => modifyFields(page, { board: () => BoardState.Visiting({ board }) }),
        }),
      ),
      expect(role('heading', { name: 'Coats' })).toExist(),
      expect(role('link', { name: /By Nika Kovač/ })).toHaveAttr('href', '/@nika.kovac'),
      expect(role('link', { name: 'Navy knit' })).toHaveAttr('href', `/pieces/${knit.id}`),
      expect(role('button', { name: 'Board settings' })).toBeAbsent(),
      expect(role('button', { name: 'Save' })).toHaveAttr('aria-pressed', 'false'),
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
        modifyFields(signedIn(opened(`/looks/${page.look.id}`)), {
          look: (look) => modifyFields(look, { shown: () => LookShown.Visiting({ page }) }),
        }),
      ),
      expect(role('heading', { name: 'Monday' })).toExist(),
      expect(text('Office')).toExist(),
      expect(role('link', { name: 'Navy knit' })).toHaveAttr('href', `/pieces/${knit.id}`),
      expect(role('button', { name: 'Delete' })).toBeAbsent(),
      expect(role('button', { name: 'Report look' })).toExist(),
    )
  })

  test('offers a signed-in visitor Follow, Report and Block, and a piece Save', () => {
    const relation = Schema.decodeUnknownSync(Relation)({ handle: 'nika.kovac', following: false, blocked: false })
    const shown = signedIn(visiting('/@nika.kovac', Shown.Person({ profile: nika })))
    const known = update(
      shown,
      Message.GotVisitMessage({
        message: VisitMessage.GotPeopleMessage({ message: PeopleMessage.SucceededLoadRelation({ relation }) }),
      }),
    ).model
    scene(
      { update, view },
      given(known),
      expect(role('button', { name: 'Follow' })).toHaveAttr('aria-pressed', 'false'),
      expect(role('button', { name: 'Report profile' })).toExist(),
      expect(role('button', { name: 'Block @nika.kovac' })).toExist(),
      click(role('button', { name: 'Report profile' })),
      expect(text("What's wrong with it?")).toExist(),
      expect(role('radio', { name: 'Spam or a scam' })).toExist(),
      expect(role('button', { name: 'Send report' })).toHaveAttr('aria-disabled', 'true'),
    )
  })

  test('Explore shows Edits from Styld, people to follow and the newest boards, and filters by mood', () => {
    const found = { board: nika.boards[0], by, moods: ['rain'] }
    const explore = Schema.decodeUnknownSync(Explore)({ edits: [found], featured: [], people: [by], newest: [found] })
    scene(
      { update, view },
      given(visiting('/explore', Shown.Explore({ explore }))),
      expect(role('heading', { name: 'Explore' })).toExist(),
      expect(role('heading', { name: 'Edits from Styld' })).toExist(),
      expect(role('heading', { name: 'People to follow' })).toExist(),
      expect(role('link', { name: /^Nika Kovač/ })).toHaveAttr('href', '/@nika.kovac'),
      expect(role('button', { name: 'All' })).toHaveAttr('aria-pressed', 'true'),
      click(role('button', { name: 'Rain' })),
      Command.resolve(LoadExplore, VisitMessage.SucceededLoadExplore({ explore })),
      expect(role('button', { name: 'Rain' })).toHaveAttr('aria-pressed', 'true'),
    )
  })

  test('a board’s card is one link, and a mood with no boards yet says so', () => {
    const found = { board: nika.boards[0], by, moods: [] }
    const explore = Schema.decodeUnknownSync(Explore)({ edits: [found], featured: [], people: [], newest: [] })
    scene(
      { update, view },
      given(visiting('/explore', Shown.Explore({ explore }))),
      expect(role('link', { name: /Coats/ })).toHaveAttr('href', `/boards/bd_${'coats'.padEnd(22, 'x')}`),
      expect(role('link', { name: 'Navy knit' })).toBeAbsent(),
      click(role('button', { name: 'Rain' })),
      Command.resolve(LoadExplore, VisitMessage.SucceededLoadExplore({ explore })),
      expect(text('No public boards in this mood yet.')).toExist(),
    )
  })

  test('the landing shows Edits from Styld to someone signed out', () => {
    const found = { board: nika.boards[0], by, moods: [] }
    const explore = Schema.decodeUnknownSync(Explore)({ edits: [found], featured: [], people: [], newest: [] })
    scene(
      { update, view },
      given(visiting('/', Shown.Explore({ explore }))),
      expect(role('heading', { name: 'A place to begin' })).toExist(),
      expect(role('link', { name: /Coats/ })).toHaveAttr('href', `/boards/bd_${'coats'.padEnd(22, 'x')}`),
      expect(role('link', { name: 'Explore' })).toHaveAttr('href', '/explore'),
    )
  })
})
