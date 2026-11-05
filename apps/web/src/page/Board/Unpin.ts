import { format, type Locale, type MessageKey } from '@styld/i18n'
import type { Pin } from '@styld/protocol'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../../ActionButton.ts'
import { primaryAction, secondaryAction, smallAction } from '../../Actions.styles.ts'
import { closeIcon } from '../../Icon.ts'
import { styled } from '../../Styled.ts'
import { keepPinId, Message, unpinId } from './Chrome.ts'
import * as styles from './PageView.styles.ts'

// Taking a pin off a board: its ×, and the question that asks first, since the pin leaves the table too and a
// picture is deleted.

/** The pin's ×, or, once pressed, the question over the tile: Take off, or Keep. */
type Unpin = { readonly pinId: Pin['id']; readonly label: string; readonly question: MessageKey }

export const unpinButton = (
  { pinId, label, question }: Unpin,
  asking: boolean,
  disabled: boolean,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  asking
    ? h.div(
        [h.Role('group'), h.AriaLabel(label), ...styled(h, styles.unpinAsk())],
        [
          h.p(styled(h, styles.unpinQuestion()), [format(locale, question, {})]),
          actionButton(
            {
              label: format(locale, 'board.unpinConfirm', {}),
              style: cx(primaryAction(), smallAction()),
              onClick: Message.ClickedConfirmUnpin({ pinId }),
              isDisabled: disabled,
            },
            h,
          ),
          h.button(
            [
              h.Type('button'),
              h.Id(keepPinId(pinId)),
              ...styled(h, cx(secondaryAction(), smallAction())),
              h.OnClick(Message.ClickedKeepPin({ pinId })),
            ],
            [format(locale, 'board.unpinKeep', {})],
          ),
        ],
      )
    : h.button(
        [
          h.Type('button'),
          h.Id(unpinId(pinId)),
          h.Disabled(disabled),
          h.AriaLabel(label),
          ...styled(h, styles.unpin()),
          h.OnClick(Message.ClickedUnpin({ pinId })),
        ],
        [closeIcon(h)],
      )
