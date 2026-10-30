import { format, type Locale } from '@styld/i18n'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { confirmActions } from '../ConfirmActions.ts'
import { formError } from '../Fields.styles.ts'
import { backIcon, loader } from '../Icon.ts'
import { looksRouter, pieceRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { Deletion, Message, type Model, Shown } from './Look.ts'
import { round } from './PageBar.styles.ts'
import { pieceLabel } from './WardrobeWords.ts'
import { caption, cut, cutImage, grid } from './WardrobeView.styles.ts'
import { couldNotLoad } from './LooksView.ts'
import * as styles from './LooksView.styles.ts'

const backToLooks = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(looksRouter({})), h.AriaLabel(format(locale, 'looks.backToLooks', {})), ...styled(h, round())],
    [backIcon(h)],
  )

const deletion = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  Deletion.match(model.deletion, {
    Idle: () => [
      actionButton(
        { label: format(locale, 'looks.delete', {}), style: secondaryAction(), onClick: Message.ClickedDelete() },
        h,
      ),
    ],
    Failed: () => [
      h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'looks.deleteFailed', {})]),
      actionButton(
        { label: format(locale, 'looks.delete', {}), style: secondaryAction(), onClick: Message.ClickedDelete() },
        h,
      ),
    ],
    Confirming: () => [
      h.p([], [format(locale, 'looks.deleteConfirm', {})]),
      ...confirmActions(
        {
          confirm: format(locale, 'looks.delete', {}),
          cancel: format(locale, 'common.cancel', {}),
          onConfirm: Message.ClickedConfirmDelete(),
          onCancel: Message.ClickedCancelDelete(),
          busy: false,
        },
        h,
      ),
    ],
    Deleting: () =>
      confirmActions(
        {
          confirm: format(locale, 'looks.delete', {}),
          cancel: format(locale, 'common.cancel', {}),
          onConfirm: Message.ClickedConfirmDelete(),
          onCancel: Message.ClickedCancelDelete(),
          busy: true,
        },
        h,
      ),
  })

/** One look: its name and occasion, its pieces, and deleting it. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main'), ...styled(h, styles.looksPage())],
    [
      h.div([], [backToLooks(locale, h)]),
      ...Shown.match(model.shown, {
        Loading: () => [h.p([h.Role('status')], [loader(h)])],
        NotFound: () => [h.h1([], [format(locale, 'looks.notFound', {})])],
        Failed: () => [h.h1([], [format(locale, 'looks.title', {})]), couldNotLoad(locale, h, Message.ClickedRetry())],
        Loaded: ({ look }) => [
          h.h1([], [look.name]),
          look.occasion === null ? h.empty : h.p(styled(h, styles.lede()), [look.occasion]),
          h.ul(
            styled(h, grid()),
            look.pieces.map((piece) =>
              h.keyed('li')(
                piece.id,
                [],
                [
                  h.a(
                    [h.Href(pieceRouter({ pieceId: piece.id })), ...styled(h, cut())],
                    [
                      h.img([
                        h.Src(`/cdn/pieces/${piece.id}/thumb`),
                        h.Alt(pieceLabel(piece, locale)),
                        h.Loading('lazy'),
                        ...styled(h, cutImage()),
                      ]),
                      h.span(styled(h, caption()), [pieceLabel(piece, locale)]),
                    ],
                  ),
                ],
              ),
            ),
          ),
          h.div([], deletion(model, locale, h)),
        ],
      }),
    ],
  ),
)
