import { format, type Locale } from '@styld/i18n'
import type { PublicBoard } from '@styld/protocol'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { styled } from '../../Styled.ts'
import { byline, pinTile, tileGrid } from '../PublicTiles.ts'
import { generatedPiecesMark } from './MakeView.ts'
import * as styles from './PageView.styles.ts'
import { fromPublic, stillTable } from './Table.ts'

/** A public board as others see it: its name and whose it is, its collage, then the pins they may see. */
export const visitingView = <Message>(
  board: PublicBoard,
  actions: Html,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(styled(h, styles.page()), [
    h.header(styled(h, styles.head()), [
      h.h1([], [board.name]),
      byline(board.by, locale, h),
      board.generated ? generatedPiecesMark(locale, h) : h.empty,
      actions,
    ]),
    board.items.length === 0
      ? h.empty
      : h.div(styled(h, styles.collage()), [stillTable(board.items, board.paper, [], h, fromPublic)]),
    h.section(
      [h.AriaLabelledBy('board-pins'), ...styled(h, styles.head())],
      [
        h.h2([h.Id('board-pins'), ...styled(h, styles.pinsTitle())], [format(locale, 'board.pinsTitle', {})]),
        tileGrid(
          board.pins.map((pin) => ({ id: pin.id, tile: pinTile(pin, locale, h) })),
          h,
        ),
      ],
    ),
  ])
