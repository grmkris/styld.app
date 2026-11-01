import { defineTaggedUnion } from 'foldkit/schema'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from './ActionButton.ts'
import { primaryAction, secondaryAction } from './Actions.styles.ts'
import { loader } from './Icon.ts'

// Deleting something (a piece, a photo, a look, a board, the account) is asked once more in the page before it is sent:
// one union for where that stands, and one pair of buttons for the question.

/** A deletion: nothing asked, asked once more, on its way, or refused. */
export const Deletion = defineTaggedUnion({ Idle: {}, Confirming: {}, Deleting: {}, Failed: {} })
export type Deletion = typeof Deletion.Type

/** The confirm and cancel pair of an in-page confirmation. While the confirmed action runs, both
 * stay focusable but refuse clicks, and the confirm button shows the loader. */
export const confirmActions = <Message>(
  options: {
    readonly confirm: string
    readonly cancel: string
    readonly onConfirm: Message
    readonly onCancel: Message
    readonly busy: boolean
  },
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  actionButton(
    {
      label: options.confirm,
      style: primaryAction(),
      onClick: options.onConfirm,
      isDisabled: options.busy,
      leading: options.busy ? loader(h) : h.empty,
    },
    h,
  ),
  actionButton(
    { label: options.cancel, style: secondaryAction(), onClick: options.onCancel, isDisabled: options.busy },
    h,
  ),
]
