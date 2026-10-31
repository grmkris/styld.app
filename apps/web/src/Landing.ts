import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { primaryAction, secondaryAction } from './Actions.styles.ts'
import type { Model } from './App.ts'
import type { Message } from './Message.ts'
import { boards as exploreBoards } from './page/ExploreView.styles.ts'
import { boardCard, byline } from './page/PublicTiles.ts'
import * as Visit from './page/Visit.ts'
import { exploreRouter, loginRouter } from './route.ts'
import { styled } from './Styled.ts'
import {
  emptyState,
  heroActions,
  heroTitle,
  inspiration,
  inspirationGrid,
  intro,
  lead,
  sectionNote,
} from './View.styles.ts'

// Home for someone signed out: what Styld is, and Edits from Styld to begin with.

const browseAnchor = '#inspiration'

/** The landing's inspiration: Edits from Styld, or the newest public boards before there are any. */
const inspirationBoards = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const shown = model.visit.shown
  const boards = Visit.Shown.guards.Explore(shown)
    ? (shown.explore.edits.length > 0 ? shown.explore.edits : shown.explore.newest).slice(0, 6)
    : []
  return boards.length === 0
    ? h.div(styled(h, inspirationGrid()), [h.p(styled(h, emptyState()), [format(locale, 'landing.feedEmpty', {})])])
    : h.div(styled(h, inspirationGrid()), [
        h.ul(
          styled(h, exploreBoards()),
          boards.map(({ board, by }) =>
            h.keyed('li')(board.id, [], [boardCard(board, locale, h), byline(by, locale, h)]),
          ),
        ),
        h.a([h.Href(exploreRouter({}))], [format(locale, 'explore.title', {})]),
      ])
}

/** The landing: what Styld is, a way in, and the inspiration below. */
export const landingView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  return h.main(
    [h.Id('main')],
    [
      h.section(styled(h, intro()), [
        h.h1(styled(h, heroTitle()), [format(locale, 'landing.title', {})]),
        h.p(styled(h, lead()), [format(locale, 'landing.description', {})]),
        h.div(styled(h, heroActions()), [
          h.a([h.Href(browseAnchor), ...styled(h, primaryAction())], [format(locale, 'landing.browse', {})]),
          h.a([h.Href(loginRouter({})), ...styled(h, secondaryAction())], [format(locale, 'auth.signInWithEmail', {})]),
        ]),
      ]),
      h.section(
        [h.Id('inspiration'), ...styled(h, inspiration())],
        [
          h.h2([], [format(locale, 'landing.feedTitle', {})]),
          h.p(styled(h, sectionNote()), [format(locale, 'landing.feedDescription', {})]),
          inspirationBoards(model, locale, h),
        ],
      ),
    ],
  )
}
