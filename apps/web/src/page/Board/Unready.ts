import { format, type Locale } from '@styld/i18n'
import type { Paper } from '@styld/protocol'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../../ActionButton.ts'
import { secondaryAction } from '../../Actions.styles.ts'
import { backIcon, loader } from '../../Icon.ts'
import { boardsRouter } from '../../route.ts'
import { styled } from '../../Styled.ts'
import { Message } from './Message.ts'
import { BoardState } from './Model.ts'
import * as styles from './View.styles.ts'

const notReady = (text: string, retry: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.page()), [
    h.a(
      [h.Href(boardsRouter({})), ...styled(h, styles.back())],
      [backIcon(h), format(locale, 'studio.backToBoards', {})],
    ),
    h.p([h.Role(retry ? 'alert' : 'status')], [text]),
    retry
      ? actionButton(
          { label: format(locale, 'board.retry', {}), style: secondaryAction(), onClick: Message.ClickedRetry() },
          h,
        )
      : h.empty,
  ])

/** A board's page while the board loads, if it failed to (with Try again) or is gone; the board itself once
 * it is ready. The page and its collage editor show these alike. */
export const boardStateView = (
  board: BoardState,
  ready: (name: string, paper: Paper) => Html,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.main(
    [h.Id('main')],
    [
      BoardState.match(board, {
        Loading: () =>
          h.div(styled(h, styles.page()), [h.p([h.Role('status')], [loader(h), format(locale, 'board.loading', {})])]),
        Failed: () => notReady(format(locale, 'board.failed', {}), true, locale, h),
        Missing: () => notReady(format(locale, 'board.missing', {}), false, locale, h),
        Ready: ({ name, paper }) => ready(name, paper),
      }),
    ],
  )
