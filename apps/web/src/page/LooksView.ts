import { cdn } from '../Cdn.ts'
import type { Look } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { secondaryAction } from '../Actions.styles.ts'
import { boardsRouter, lookRouter } from '../route.ts'
import { block, line } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { retryView } from './Retry.ts'
import { wardrobeMain } from './WardrobeTabs.ts'
import { Message, type Model } from './Looks.ts'
import { message as messageSection, messageTitle } from './WardrobeView.styles.ts'
import * as styles from './LooksView.styles.ts'

/** Up to four of a look's pieces, laid out together. */
export const collage = <Message>(look: Look, h: HtmlBuilder<Message>): Html =>
  h.div(
    styled(h, styles.collage()),
    look.pieces.slice(0, 4).map((piece) =>
      h.img([
        h.Src(cdn.piece(piece.id)),
        // The card's name says what the look is; listing every piece would drown it.
        h.Alt(''),
        h.Loading('lazy'),
        ...styled(h, styles.collageImage()),
      ]),
    ),
  )

const card = (look: Look, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    look.id,
    [],
    [
      h.a(
        [h.Href(lookRouter({ lookId: look.id })), ...styled(h, styles.card())],
        [
          collage(look, h),
          h.span(styled(h, styles.cardName()), [look.name]),
          h.span(styled(h, styles.cardMeta()), [
            look.occasion ?? format(locale, 'looks.pieceCount', { count: look.pieces.length }),
          ]),
        ],
      ),
    ],
  )

const skeletonCards = ['a', 'b'] as const

/** The shape of what is coming: two cards with a square for the pieces, a name and a line. */
const loadingView = (locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.p([h.Role('status'), ...styled(h, visuallyHidden())], [format(locale, 'common.loading', {})]),
  h.ul(
    [h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, styles.grid())],
    skeletonCards.map((slot) =>
      h.keyed('li')(slot, styled(h, styles.card()), [
        h.span(styled(h, cx(block(), styles.collageSkeleton()))),
        h.span(styled(h, cx(line(), styles.nameSkeleton()))),
        h.span(styled(h, cx(line(), styles.metaSkeleton()))),
      ]),
    ),
  ),
]

const looksPage = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  wardrobeMain(
    'looks',
    styles.looksPage(),
    AsyncData.matchData(model.saved, {
      onEmpty: () => loadingView(locale, h),
      onFailure: () => [retryView(format(locale, 'looks.loadFailed', {}), locale, Message.ClickedRetry(), h)],
      onData: (looks) =>
        looks.length === 0
          ? [
              // Empty, the one action that fills it (DESIGN › Copy): a board's table is where a look is made.
              h.section(styled(h, messageSection()), [
                h.h2(styled(h, messageTitle()), [format(locale, 'looks.emptyTitle', {})]),
                h.p([], [format(locale, 'looks.emptyHint', {})]),
                h.a(
                  [h.Href(boardsRouter({})), ...styled(h, secondaryAction())],
                  [format(locale, 'looks.toBoards', {})],
                ),
              ]),
            ]
          : [
              h.ul(
                styled(h, styles.grid()),
                looks.map((look) => card(look, locale, h)),
              ),
            ],
    }),
    locale,
    h,
  )

/** The looks assistants put together; the website shows, opens and deletes them. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  looksPage(model, locale, h),
)
