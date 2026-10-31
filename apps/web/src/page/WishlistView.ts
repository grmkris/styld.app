import { format, type Locale } from '@styld/i18n'
import type { Wish } from '@styld/protocol'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { loader } from '../Icon.ts'
import { styled } from '../Styled.ts'
import * as boardStyles from './Board/PageView.styles.ts'
import { couldNotLoad } from './LooksView.ts'
import * as styles from './LooksView.styles.ts'
import { byline, pieceTile } from './PublicTiles.ts'
import { wardrobeMain } from './WardrobeTabs.ts'
import { Message, type Model } from './Wishlist.ts'
import { categoryName } from './WardrobeWords.ts'

/** A wish: the piece and whose it is while it is public, else what it was; and taking it off the list. */
const wishTile = (wish: Wish, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(wish.id, styled(h, boardStyles.pin()), [
    wish.piece === null
      ? h.span(styled(h, boardStyles.pinFrame()), [
          h.span(styled(h, boardStyles.pinName()), [
            wish.name ?? format(locale, categoryName(wish.category), {}),
            ' · ',
            format(locale, 'people.wishGone', {}),
          ]),
        ])
      : pieceTile(wish.piece, locale, h),
    wish.by === null ? h.empty : byline(wish.by, locale, h),
    actionButton(
      {
        label: format(locale, 'people.removeWish', {}),
        style: secondaryAction(),
        onClick: Message.ClickedRemove({ wishId: wish.id }),
      },
      h,
    ),
  ])

/** The wishlist tab: pieces the person wants one like. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  wardrobeMain(
    'wishlist',
    styles.looksPage(),
    AsyncData.matchData(model.wishes, {
      onEmpty: () => [h.p([h.Role('status')], [loader(h)])],
      onFailure: () => [couldNotLoad(format(locale, 'people.wishlistFailed', {}), locale, h, Message.ClickedRetry())],
      onData: (wishes) =>
        wishes.length === 0
          ? [
              h.section(styled(h, styles.lede()), [
                h.h2([], [format(locale, 'wardrobe.wishlistEmptyTitle', {})]),
                h.p([], [format(locale, 'people.wishlistEmptyHint', {})]),
              ]),
            ]
          : [
              h.ul(
                styled(h, boardStyles.grid()),
                wishes.map((wish) => wishTile(wish, locale, h)),
              ),
            ],
    }),
    locale,
    h,
  ),
)
