import { format, type Locale } from '@styld/i18n'
import type { Paper, PublicBoard } from '@styld/protocol'
import { Option } from 'effect'
import { AsyncData } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { backIcon } from '../../Icon.ts'
import { boardsRouter } from '../../route.ts'
import { block, line } from '../../Skeleton.styles.ts'
import { styled } from '../../Styled.ts'
import { visuallyHidden } from '../../VisuallyHidden.styles.ts'
import { cx } from 'zyzz'
import { Message } from './Message.ts'
import { type BoardData, BoardShown } from './Model.ts'
import { retryView } from '../Retry.ts'
import * as styles from './View.styles.ts'

const backToBoards = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a([h.Href(boardsRouter({})), ...styled(h, styles.back())], [backIcon(h), format(locale, 'studio.backToBoards', {})])

/** While the board loads: the way back (for someone with boards of their own), then its name, its line and its pins
 * in shape (DESIGN › States). */
const loading = (withBack: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.page()), [
    withBack ? backToBoards(locale, h) : h.empty,
    h.div(
      [h.AriaHidden(true), ...styled(h, styles.loadingShape())],
      [
        h.span(styled(h, cx(line(), styles.titleLine()))),
        h.span(styled(h, cx(line(), styles.metaLine()))),
        h.span(
          styled(h, styles.loadingPins()),
          [0, 1, 2, 3].map(() => h.span(styled(h, cx(block(), styles.pinSkeleton())))),
        ),
      ],
    ),
    h.p([h.Role('status'), ...styled(h, visuallyHidden())], [format(locale, 'board.loading', {})]),
  ])

/** A board that is not there, or not the visitor's to edit: the way back and a line saying so. */
const missing = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.page()), [
    backToBoards(locale, h),
    h.p([h.Role('status')], [format(locale, 'board.missing', {})]),
  ])

/** A board that could not be read: the way back and Try again. */
const failed = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.page()), [
    backToBoards(locale, h),
    retryView(format(locale, 'board.failed', {}), locale, Message.ClickedRetry(), h),
  ])

/** A board's page while the board loads, if it failed to (with Try again) or is gone; the board itself once
 * it is read. The page and its collage editor show these alike; someone else's public board shows as `visiting`
 * has it, and in the editor as gone. */
export const boardStateView = (
  board: BoardData,
  ready: (name: string, paper: Paper) => Html,
  locale: Locale,
  h: HtmlBuilder<Message>,
  /** Someone else's public board: the page shows it as visitors see it; the editor, which only edits, as gone. */
  visiting: Option.Option<(board: PublicBoard) => Html>,
  signedIn: boolean,
): Html =>
  h.main(
    [h.Id('main')],
    [
      AsyncData.matchData(board, {
        // Signed out there are no boards to go back to: the shape is the public board's.
        onEmpty: () => loading(signedIn, locale, h),
        onFailure: (error) => (error === 'NotFound' ? missing(locale, h) : failed(locale, h)),
        onData: BoardShown.match({
          Own: ({ name, paper }) => ready(name, paper),
          Visiting: ({ board: shown }) =>
            Option.match(visiting, { onNone: () => missing(locale, h), onSome: (visit) => visit(shown) }),
        }),
      }),
    ],
  )
