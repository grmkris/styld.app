import type { Look } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { lookRouter } from '../route.ts'
import { block, line } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { wardrobeTabs } from './WardrobeTabs.ts'
import { Message, type Model } from './Looks.ts'
import { message as messageSection, messageTitle } from './WardrobeView.styles.ts'
import * as styles from './LooksView.styles.ts'
import { addPiecesAction, pageHead, pageTitle } from './PageHead.ts'

/** Up to four of a look's pieces, laid out together. */
const collage = <Message>(look: Look, h: HtmlBuilder<Message>): Html =>
  h.div(
    styled(h, styles.collage()),
    look.pieces.slice(0, 4).map((piece) =>
      h.img([
        h.Src(`/cdn/pieces/${piece.id}/thumb`),
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

/** Looks that could not be read, and trying again. */
export const couldNotLoad = <Message>(locale: Locale, h: HtmlBuilder<Message>, onRetry: Message): Html =>
  h.section(
    [h.Role('alert'), ...styled(h, messageSection())],
    [
      h.h2(styled(h, messageTitle()), [format(locale, 'looks.loadFailed', {})]),
      actionButton({ label: format(locale, 'common.tryAgain', {}), style: secondaryAction(), onClick: onRetry }, h),
    ],
  )

const skeletonCards = ['a', 'b'] as const

/** The shape of what is coming: the hint, and two cards with a square for the pieces, a name and a line. */
const loadingView = (locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.p([h.Role('status'), ...styled(h, visuallyHidden())], [format(locale, 'common.loading', {})]),
  h.span([h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, cx(line(), styles.ledeSkeleton()))]),
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
  h.main(
    [h.Id('main'), ...styled(h, styles.looksPage())],
    [
      pageHead(pageTitle(format(locale, 'wardrobe.title', {}), h), Option.some(addPiecesAction(locale, h)), h),
      wardrobeTabs('looks', locale, h),
      ...AsyncData.matchData(model.saved, {
        onEmpty: () => loadingView(locale, h),
        onFailure: () => [couldNotLoad(locale, h, Message.ClickedRetry())],
        onData: (looks) =>
          looks.length === 0
            ? [
                h.section(styled(h, messageSection()), [
                  h.h2(styled(h, messageTitle()), [format(locale, 'looks.emptyTitle', {})]),
                  h.p([], [format(locale, 'looks.emptyHint', {})]),
                ]),
              ]
            : [
                h.p(styled(h, styles.lede()), [format(locale, 'looks.hint', {})]),
                h.ul(
                  styled(h, styles.grid()),
                  looks.map((look) => card(look, locale, h)),
                ),
              ],
      }),
    ],
  )

/** The looks assistants put together; the website shows, opens and deletes them. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  looksPage(model, locale, h),
)
