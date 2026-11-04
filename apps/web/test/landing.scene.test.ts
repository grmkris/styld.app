import { Explore } from '@styld/protocol'
import { Schema } from 'effect'
import { click, Command, expect, given, inside, role, scene, selector } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { BoardsData, LoadLanding, Message as LandingMessage } from '../src/page/LandingBoards.ts'
import { lenses } from '../src/Page.ts'
import { view } from '../src/View.ts'
import { withPage } from './AppFixtures.ts'
import { by, knit, nika, opened } from './VisitFixtures.ts'

// Home for someone signed out: what Styld is, and public boards to begin with (Styld's edits, else the newest).

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

/** Explore's answer with these boards among Styld's edits and the newest. */
const exploreOf = (edits: ReadonlyArray<object>, newest: ReadonlyArray<object>) =>
  Schema.decodeUnknownSync(Explore)({ edits, featured: [], people: [], newest })

const coats = { board: nika.boards[0], by, moods: [] }

/** The landing with its boards as given. */
const landing = (boards: BoardsData) =>
  withPage(opened('/'), lenses.landing, (current) => modifyFields(current, { boards: () => boards }))

const shown = (explore: Explore) => BoardsData.Success({ data: explore })

describe('the landing', () => {
  test('shows Edits from Styld to someone signed out, with no way to an Explore page', () => {
    scene(
      { update, view },
      given(landing(shown(exploreOf([coats], [])))),
      expect(role('heading', { name: 'Edits from Styld' })).toExist(),
      expect(role('link', { name: /Coats.*By Nika Kovač$/ })).toHaveAttr(
        'href',
        `/boards/bd_${'coats'.padEnd(22, 'x')}`,
      ),
      expect(role('link', { name: 'Explore' })).not.toExist(),
    )
  })

  test('names its boards once they arrive, the newest while Styld has no edits', () => {
    scene(
      { update, view },
      given(landing(BoardsData.Loading())),
      expect(role('heading', { name: 'Edits from Styld' })).not.toExist(),
      expect(role('heading', { name: 'Newest boards' })).not.toExist(),
      expect(role('status')).toHaveText('Loading…'),
    )
    scene(
      { update, view },
      given(landing(shown(exploreOf([], [coats])))),
      expect(role('heading', { name: 'Newest boards' })).toExist(),
      expect(role('heading', { name: 'Edits from Styld' })).not.toExist(),
    )
  })

  test('lays the first public board with something on its table beside its words, in outline until then', () => {
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
      given(landing(BoardsData.Loading())),
      inside(hero, expect(selector('[data-skeleton]')).toExist(), expect(selector('[data-paper]')).not.toExist()),
    )
    scene(
      { update, view },
      given(landing(shown(exploreOf([coats], [layered])))),
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
      given(landing(shown(exploreOf([coats], [])))),
      inside(
        hero,
        expect(selector('[data-skeleton]')).not.toExist(),
        expect(selector('[data-paper]')).toHaveAttr('data-paper', 'paper'),
      ),
    )
  })

  test('says when its boards did not load, and reads them again on Try again', () => {
    scene(
      { update, view },
      given(landing(BoardsData.Failure({ error: 'Unavailable' }))),
      expect(role('alert')).toHaveText("The boards didn't load."),
      expect(role('link', { name: 'Start free' })).toHaveAttr('href', '/login'),
      click(role('button', { name: 'Try again' })),
      Command.resolve(LoadLanding, LandingMessage.SucceededLoadLanding({ explore: exploreOf([coats], []) })),
      expect(role('heading', { name: 'Edits from Styld' })).toExist(),
    )
  })

  test('signed out, the bar offers Sign in, except on the sign-in page itself', () => {
    scene(
      { update, view },
      given(opened('/')),
      inside(
        role('banner'),
        expect(role('link', { name: 'Sign in' })).toHaveAttr('href', '/login'),
        expect(role('link', { name: 'Explore' })).not.toExist(),
      ),
    )
    scene(
      { update, view },
      given(opened('/login')),
      inside(role('banner'), expect(role('link', { name: 'Sign in' })).not.toExist()),
    )
  })
})
