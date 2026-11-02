import { format, type Locale } from '@styld/i18n'
import type { SavedThing } from '@styld/protocol'
import { Match } from 'effect'
import { AsyncData } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { styled } from '../Styled.ts'
import type { SavedData } from './Boards.ts'
import * as styles from './FeedView.styles.ts'
import { boardCard, byline, lookTile, pieceTile, tileGrid } from './PublicTiles.ts'
import { retryView } from './Retry.ts'

const savedTile = <Message>(thing: SavedThing, locale: Locale, h: HtmlBuilder<Message>) =>
  Match.value(thing).pipe(
    Match.tagsExhaustive({
      SavedPiece: ({ piece, by }) => ({
        id: `piece:${piece.id}`,
        tile: h.div(styled(h, styles.item()), [pieceTile(piece, locale, h), byline(by, locale, h)]),
      }),
      SavedLook: ({ look, by }) => ({
        id: `look:${look.id}`,
        tile: h.div(styled(h, styles.item()), [lookTile(look, h), byline(by, locale, h)]),
      }),
      SavedBoard: ({ board, by }) => ({
        id: `board:${board.id}`,
        tile: h.div(styled(h, styles.item()), [boardCard(board, locale, h), byline(by, locale, h)]),
      }),
    }),
  )

/** Saved from others: what the person saved, while its owners keep it public, once there is something. */
export const savedView = <Message>(saved: SavedData, locale: Locale, onRetry: Message, h: HtmlBuilder<Message>): Html =>
  AsyncData.matchData(saved, {
    onEmpty: () => h.empty,
    onFailure: () => retryView(format(locale, 'common.error', {}), locale, onRetry, h),
    onData: (things) =>
      things.length === 0
        ? h.empty
        : h.section(
            [h.AriaLabelledBy('saved-from-others'), ...styled(h, styles.feed())],
            [
              h.h2([h.Id('saved-from-others')], [format(locale, 'people.savedFromOthers', {})]),
              tileGrid(
                things.map((thing) => savedTile(thing, locale, h)),
                h,
              ),
            ],
          ),
  })
