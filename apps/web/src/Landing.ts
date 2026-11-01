import { format, type Locale } from '@styld/i18n'
import type { FoundBoard } from '@styld/protocol'
import { Array, Option } from 'effect'
import { AsyncData } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from './ActionButton.ts'
import { primaryAction, secondaryAction } from './Actions.styles.ts'
import { Message } from './Message.ts'
import * as styles from './Landing.styles.ts'

import { boards as exploreBoards } from './page/ExploreView.styles.ts'
import { creditedBoardCard, publicFace } from './page/PublicTiles.ts'
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

/** Nothing read yet, and nothing failed: the boards are on their way. */
const isPending = (shown: Visit.ShownData) => Option.isNone(AsyncData.getData(shown)) && !AsyncData.isFailure(shown)

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
const inspirationBoards = (shown: Visit.ShownData, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (isPending(shown)) return loadingBoards(locale, h)
  if (Option.isNone(Visit.exploreOf(shown)) && AsyncData.isFailure(shown))
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
  const boards = Option.match(Visit.exploreOf(shown), {
    onNone: (): ReadonlyArray<FoundBoard> => [],
    onSome: (explore) => (explore.edits.length > 0 ? explore.edits : explore.newest).slice(0, 6),
  })
  return boards.length === 0
    ? h.div(styled(h, inspirationGrid()), [h.p(styled(h, emptyState()), [format(locale, 'landing.feedEmpty', {})])])
    : h.div(styled(h, inspirationGrid()), [
        h.ul(
          styled(h, exploreBoards()),
          boards.map(({ board, by }) => h.keyed('li')(board.id, [], [creditedBoardCard(board, by, locale, h)])),
        ),
        h.a([h.Href(exploreRouter({})), ...styled(h, styles.seeAll())], [format(locale, 'landing.seeAll', {})]),
      ])
}

/** The section is named for what it shows: Styld's edits, or the newest boards before there are any. Until the boards
 * arrive it is unknown which, so a heading's shape holds its place. */
const inspirationTitle = (shown: Visit.ShownData, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (isPending(shown)) return h.span([h.AriaHidden(true), ...styled(h, cx(line(), headingLine()))])
  const title = Option.exists(Visit.exploreOf(shown), (explore) => explore.edits.length === 0)
    ? 'explore.newest'
    : 'explore.edits'
  return h.h2([], [format(locale, title, {})])
}

/** Beside the words on a desktop, the first public board with something to show: its collage as it lies, else its
 * pins on its paper. It draws once the boards arrive (a table's placement is set in the browser), in outline until
 * then, and not at all without one. Its clothes are a picture of what Styld is for; the boards below are the way in. */
const heroBoard = (shown: Visit.ShownData, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (isPending(shown))
    return h.div(styled(h, styles.heroBoard()), [
      h.span([h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, cx(block(), styles.heroSkeleton()))]),
    ])
  const boards = Option.match(Visit.exploreOf(shown), {
    onNone: (): ReadonlyArray<FoundBoard> => [],
    onSome: (explore) => [...explore.edits, ...explore.newest],
  })
  // A collage is the better picture; without one anywhere, a board's pins on its paper.
  const pick = Option.orElse(
    Array.findFirst(boards, ({ board }) => Array.isReadonlyArrayNonEmpty(board.items)),
    () => Array.findFirst(boards, ({ board }) => Array.isReadonlyArrayNonEmpty(board.cover)),
  )
  return Option.match(pick, {
    onNone: () => h.empty,
    onSome: ({ board }) =>
      h.div([h.AriaHidden(true), ...styled(h, styles.heroBoard())], [publicFace(board, locale, h)]),
  })
}

/** The landing: what Styld is, a way in, and the inspiration below. */
/** `explore` is Explore's Model, whose boards the landing shows. */
export const landingView = (explore: Visit.Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
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
          heroBoard(explore.shown, locale, h),
        ],
      ),
      h.section(
        [h.Id('inspiration'), ...styled(h, inspiration())],
        [
          inspirationTitle(explore.shown, locale, h),
          h.p(styled(h, sectionNote()), [format(locale, 'landing.feedDescription', {})]),
          inspirationBoards(explore.shown, locale, h),
        ],
      ),
    ],
  )
}
