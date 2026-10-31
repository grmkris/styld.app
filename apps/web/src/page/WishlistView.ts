import { format, type Locale } from '@styld/i18n'
import type { Wish } from '@styld/protocol'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { addPiecesRouter, exploreRouter } from '../route.ts'
import { block } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { cx } from 'zyzz'
import * as boardStyles from './Board/PageView.styles.ts'
import { couldNotLoad } from './LooksView.ts'
import * as styles from './LooksView.styles.ts'
import { byline, pieceTile } from './PublicTiles.ts'
import { wardrobeMain } from './WardrobeTabs.ts'
import { Message, type Model } from './Wishlist.ts'
import { categoryName } from './WardrobeWords.ts'
import { message as messageSection, messageTitle } from './WardrobeView.styles.ts'

/** A wish: the piece and whose it is while it is public, else what it was; and taking it off the list. */
const wishTile = (wish: Wish, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(wish.id, styled(h, boardStyles.pin()), [
    wish.piece === null
      ? h.span(styled(h, boardStyles.pinFrame()), [
          // What it was, and on its own line that it is no longer shown (DESIGN › Copy: no middle-dot meta).
          h.span(styled(h, boardStyles.pinName()), [wish.name ?? format(locale, categoryName(wish.category), {})]),
          h.span(styled(h, styles.goneNote()), [format(locale, 'people.wishGone', {})]),
        ])
      : pieceTile(wish.piece, locale, h),
    wish.by === null ? h.empty : byline(wish.by, locale, h),
    h.a(
      [
        h.Href(addPiecesRouter({})),
        h.OnClick(Message.ClickedGotIt({ wishId: wish.id })),
        ...styled(h, secondaryAction()),
      ],
      [format(locale, 'people.gotIt', {})],
    ),
    actionButton(
      {
        label: format(locale, 'people.removeWish', {}),
        style: secondaryAction(),
        onClick: Message.ClickedRemove({ wishId: wish.id }),
      },
      h,
    ),
  ])

/** Four pins in shape while the wishlist loads, and what is loading for assistive technology. */
const loadingView = (locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.p([h.Role('status'), ...styled(h, visuallyHidden())], [format(locale, 'common.loading', {})]),
  h.ul(
    [h.AriaHidden(true), ...styled(h, boardStyles.grid())],
    [0, 1, 2, 3].map((index) =>
      h.keyed('li')(String(index), [], [h.span(styled(h, cx(block(), styles.collageSkeleton())))]),
    ),
  ),
]

/** The wishlist tab: pieces the person wants one like. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  wardrobeMain(
    'wishlist',
    styles.looksPage(),
    AsyncData.matchData(model.wishes, {
      onEmpty: () => loadingView(locale, h),
      onFailure: () => [couldNotLoad(format(locale, 'people.wishlistFailed', {}), locale, h, Message.ClickedRetry())],
      onData: (wishes) =>
        wishes.length === 0
          ? [
              // Empty, the one action that fills it (DESIGN › Copy): wishes come from other people's pieces.
              h.section(styled(h, messageSection()), [
                h.h2(styled(h, messageTitle()), [format(locale, 'wardrobe.wishlistEmptyTitle', {})]),
                h.p([], [format(locale, 'people.wishlistEmptyHint', {})]),
                h.a(
                  [h.Href(exploreRouter({})), ...styled(h, secondaryAction())],
                  [format(locale, 'people.wishlistExplore', {})],
                ),
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
