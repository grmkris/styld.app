import { format, type Locale } from '@styld/i18n'
import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from './ActionButton.ts'
import { primaryAction, secondaryAction } from './Actions.styles.ts'
import type { Model } from './App.ts'
import { Message } from './Message.ts'
import * as styles from './Landing.styles.ts'
import { fromPublic, stillTable } from './page/Board/Table.ts'
import { boards as exploreBoards } from './page/ExploreView.styles.ts'
import { creditedBoardCard } from './page/PublicTiles.ts'
import { block, headingLine, line } from './Skeleton.styles.ts'
import { visuallyHidden } from './VisuallyHidden.styles.ts'
import { cx } from 'zyzz'
import * as Visit from './page/Visit.ts'
import { exploreRouter, signInHref } from './route.ts'
import { styled } from './Styled.ts'
import {
  boardSkeleton,
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

/** Two board cards' shapes while the boards load, and what is loading for assistive technology. */
const loadingBoards = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, inspirationGrid()), [
    h.ul(
      [h.AriaHidden(true), ...styled(h, exploreBoards())],
      [0, 1].map((index) => h.keyed('li')(String(index), [], [h.span(styled(h, cx(block(), boardSkeleton())))])),
    ),
    h.p([h.Role('status'), ...styled(h, visuallyHidden())], [format(locale, 'common.loading', {})]),
  ])

/** The landing's inspiration: Edits from Styld, or the newest public boards before there are any. */
const inspirationBoards = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const shown = model.visit.shown
  if (Visit.Shown.guards.Loading(shown)) return loadingBoards(locale, h)
  if (Visit.Shown.guards.Failed(shown))
    return h.div(styled(h, inspirationGrid()), [
      h.p([h.Role('alert'), ...styled(h, emptyState())], [format(locale, 'landing.feedFailed', {})]),
      actionButton(
        {
          label: format(locale, 'landing.retry', {}),
          style: secondaryAction(),
          onClick: Message.ClickedRetryLanding(),
        },
        h,
      ),
    ])
  const boards = Visit.Shown.guards.Explore(shown)
    ? (shown.explore.edits.length > 0 ? shown.explore.edits : shown.explore.newest).slice(0, 6)
    : []
  return boards.length === 0
    ? h.div(styled(h, inspirationGrid()), [h.p(styled(h, emptyState()), [format(locale, 'landing.feedEmpty', {})])])
    : h.div(styled(h, inspirationGrid()), [
        h.ul(
          styled(h, exploreBoards()),
          boards.map(({ board, by }) => h.keyed('li')(board.id, [], [creditedBoardCard(board, by, locale, h)])),
        ),
        h.a([h.Href(exploreRouter({}))], [format(locale, 'explore.title', {})]),
      ])
}

/** The section is named for what it shows: Styld's edits, or the newest boards before there are any. Until the boards
 * arrive it is unknown which, so a heading's shape holds its place. */
const inspirationTitle = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const shown = model.visit.shown
  if (Visit.Shown.guards.Loading(shown)) return h.span([h.AriaHidden(true), ...styled(h, cx(line(), headingLine()))])
  const title =
    Visit.Shown.guards.Explore(shown) && shown.explore.edits.length === 0 ? 'explore.newest' : 'explore.edits'
  return h.h2([], [format(locale, title, {})])
}

/** Beside the words on a desktop, the first public board with something on its table, as it lies. It draws once the
 * boards arrive (a table's placement is set in the browser), in outline until then, and not at all without one. Its
 * clothes are a picture of what Styld is for; the boards below are the way into them. */
const heroBoard = (shown: Visit.Shown, h: HtmlBuilder<Message>): Html => {
  if (Visit.Shown.guards.Loading(shown))
    return h.div(styled(h, styles.heroBoard()), [
      h.span([h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, cx(block(), styles.heroSkeleton()))]),
    ])
  const boards = Visit.Shown.guards.Explore(shown) ? [...shown.explore.edits, ...shown.explore.newest] : []
  return Option.match(
    Array.findFirst(boards, ({ board }) => Array.isReadonlyArrayNonEmpty(board.items)),
    {
      onNone: () => h.empty,
      onSome: ({ board }) =>
        h.div(styled(h, styles.heroBoard()), [
          stillTable(board.items, board.paper, [h.AriaHidden(true)], h, fromPublic),
        ]),
    },
  )
}

/** The landing: what Styld is, a way in, and the inspiration below. */
export const landingView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  return h.main(
    [h.Id('main')],
    [
      h.section(
        [h.AriaLabelledBy('landing-title'), ...styled(h, styles.hero())],
        [
          h.div(styled(h, intro()), [
            h.h1([h.Id('landing-title'), ...styled(h, heroTitle())], [format(locale, 'landing.title', {})]),
            h.p(styled(h, lead()), [format(locale, 'landing.description', {})]),
            h.div(styled(h, heroActions()), [
              // The bar already offers Sign in; this is the way in for someone new (one code signs in and signs up), so
              // it carries the ink. Browsing the boards below is the second way.
              h.a([h.Href(signInHref), ...styled(h, primaryAction())], [format(locale, 'landing.start', {})]),
              h.a([h.Href(browseAnchor), ...styled(h, secondaryAction())], [format(locale, 'landing.browse', {})]),
            ]),
          ]),
          heroBoard(model.visit.shown, h),
        ],
      ),
      h.section(
        [h.Id('inspiration'), ...styled(h, inspiration())],
        [
          inspirationTitle(model, locale, h),
          h.p(styled(h, sectionNote()), [format(locale, 'landing.feedDescription', {})]),
          inspirationBoards(model, locale, h),
        ],
      ),
    ],
  )
}
