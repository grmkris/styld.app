import { format, type Locale } from '@styld/i18n'
import type { FeedItem } from '@styld/protocol'
import { Match, Option } from 'effect'
import { AsyncData } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { exploreRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import * as styles from './FeedView.styles.ts'
import { boardCard, byline, lookTile, pieceTile, pinTile, tileGrid } from './PublicTiles.ts'
import type { FeedData } from './Today.ts'

/** One thing someone followed made public, with whose it is. */
const itemTile = <Message>(item: FeedItem, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    styled(h, styles.item()),
    Match.value(item).pipe(
      Match.tagsExhaustive({
        BoardWentPublic: ({ board, by }) => [boardCard(board, locale, h), byline(by, locale, h)],
        PinnedOnBoard: ({ pin, by }) => [pinTile(pin, locale, h), byline(by, locale, h)],
        SharedLook: ({ look, by }) => [lookTile(look, h), byline(by, locale, h)],
        AddedPiece: ({ piece, by }) => [pieceTile(piece, locale, h), byline(by, locale, h)],
      }),
    ),
  )

const itemKey = (item: FeedItem) =>
  Match.value(item).pipe(
    Match.tagsExhaustive({
      BoardWentPublic: ({ board }) => `board:${board.id}`,
      PinnedOnBoard: ({ pin }) => `pin:${pin.id}`,
      SharedLook: ({ look }) => `look:${look.id}`,
      AddedPiece: ({ piece }) => `piece:${piece.id}`,
    }),
  )

/** The way to Explore, under the feed or in its place. */
const exploreLink = <Message>(locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a([h.Href(exploreRouter({})), ...styled(h, styles.explore())], [format(locale, 'explore.title', {})])

/** From people you follow: what they made public lately, once there is something; then the way to Explore. */
export const feedView = <Message>(feed: FeedData, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Option.match(AsyncData.getData(feed), {
    // Drawn once the feed has answered, below everything else, so that nothing moves.
    onNone: () => h.empty,
    onSome: ({ items }) =>
      items.length === 0
        ? exploreLink(locale, h)
        : h.section(
            [h.AriaLabelledBy('following-feed'), ...styled(h, styles.feed())],
            [
              h.h2([h.Id('following-feed')], [format(locale, 'people.fromFollowing', {})]),
              tileGrid(
                items.map((item) => ({ id: itemKey(item), tile: itemTile(item, locale, h) })),
                h,
              ),
              exploreLink(locale, h),
            ],
          ),
  })
