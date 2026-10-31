import { Dialog } from '@foldkit/ui'
import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { closeIcon } from '../Icon.ts'
import { styled } from '../Styled.ts'
import { grab, quiet, scrim, sheet, sheetHead, sheetTitle } from './AskView.styles.ts'

/** A sheet is drawn while it is open and while it eases out after closing (its Dialog is animated): it leaves with a
 * short drop and fade rather than vanishing. */
export const sheetShown = (dialog: Dialog.Model) => dialog.isOpen || dialog.animation.transitionState !== 'Idle'

/** A sheet from the bottom edge (DESIGN.md › Surfaces), after Ask's: a title, a close button and its body. Drawn
 * only while shown (`sheetShown`); the dialog's own layout is set in the browser. */
export const bottomSheet = <Message>(
  config: {
    readonly dialog: Dialog.Model
    readonly title: string
    readonly body: (info: Dialog.RenderInfo) => ReadonlyArray<Html>
    readonly toParentMessage: (message: Dialog.Message) => Message
    readonly locale: Locale
  },
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: config.dialog.id,
    model: config.dialog,
    view: Dialog.view,
    viewInputs: {
      toView: (info: Dialog.RenderInfo) =>
        h.dialog(
          [...info.dialog],
          [
            h.div([...info.backdrop, ...styled(h, scrim())]),
            h.div(
              [...info.panel, ...styled(h, sheet())],
              [
                h.span([h.AriaHidden(true), ...styled(h, grab())]),
                h.div(styled(h, sheetHead()), [
                  h.h2([...info.title, ...styled(h, sheetTitle())], [config.title]),
                  h.button(
                    [
                      ...info.closeButton,
                      h.AriaLabel(format(config.locale, 'common.close', {})),
                      ...styled(h, quiet()),
                    ],
                    [closeIcon(h)],
                  ),
                ]),
                ...config.body(info),
              ],
            ),
          ],
        ),
    },
    toParentMessage: config.toParentMessage,
  })
