import { cx } from 'zyzz'
import { Dialog } from '@foldkit/ui'
import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import { Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { closeIcon } from '../Icon.ts'
import { styled } from '../Styled.ts'
import { quiet } from './AskView.styles.ts'
import { grab, scrim, sheet, sheetHead, sheetTitle } from './Sheet.styles.ts'
import { round } from './PageBar.styles.ts'

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
                      ...styled(h, cx(round(), quiet())),
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

/** A page's bottom sheet folded into it: the sheet's own Messages, and opening and closing it from the page. The page
 * does nothing when it has opened; `onClosed` is for a page that forgets what was left in the sheet. */
export const sheetFolds = <Model, Message>(page: {
  readonly read: (model: Model) => Dialog.Model
  readonly write: (model: Model, dialog: Dialog.Model) => Model
  readonly toParentMessage: (message: Dialog.Message) => Message
  readonly onClosed?: (model: Model) => Model
}) => {
  const fold = {
    read: (model: Model) => Option.some(page.read(model)),
    write: page.write,
    toParentMessage: page.toParentMessage,
    foldOutMessage: Dialog.OutMessage.match<Update.Step<Model, Message>>({
      Opened: () => (stepModel) => ({ model: stepModel }),
      Closed: () => (stepModel) => ({ model: page.onClosed === undefined ? stepModel : page.onClosed(stepModel) }),
    }),
  }
  return {
    update: Update.foldChild({ update: Dialog.update, ...fold }),
    open: Update.foldChildStep({ update: Dialog.open, ...fold }),
    close: Update.foldChildStep({ update: Dialog.close, ...fold }),
  }
}
