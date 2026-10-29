import type { Look } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { loader } from '../Icon.ts'
import { lookRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { Message, type Model, Saved } from './Looks.ts'
import { pieceLabel } from './WardrobeView.ts'
import { message as messageSection, messageTitle } from './WardrobeView.styles.ts'
import * as styles from './LooksView.styles.ts'

/** Up to four of a look's pieces, laid out together. */
const collage = <Message>(look: Look, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    styled(h, styles.collage()),
    look.pieces
      .slice(0, 4)
      .map((piece) =>
        h.img([
          h.Src(`/cdn/pieces/${piece.id}/thumb`),
          h.Alt(pieceLabel(piece, locale)),
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
          collage(look, locale, h),
          h.span(styled(h, styles.cardName()), [look.name]),
          h.span(styled(h, styles.cardMeta()), [
            look.occasion ?? format(locale, 'looks.pieceCount', { count: look.pieces.length }),
          ]),
        ],
      ),
    ],
  )

/** The looks assistants put together; the website shows, opens and deletes them. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main'), ...styled(h, styles.looksPage())],
    [
      h.h1([], [format(locale, 'looks.title', {})]),
      ...Saved.match(model.saved, {
        Loading: () => [h.p([h.Role('status')], [loader(h)])],
        Failed: () => [
          h.section(
            [h.Role('alert'), ...styled(h, messageSection())],
            [
              h.h2(styled(h, messageTitle()), [format(locale, 'looks.loadFailed', {})]),
              actionButton(
                {
                  label: format(locale, 'common.tryAgain', {}),
                  style: secondaryAction(),
                  onClick: Message.ClickedRetry(),
                },
                h,
              ),
            ],
          ),
        ],
        Loaded: ({ looks }) =>
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
  ),
)
