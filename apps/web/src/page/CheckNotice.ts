import { format, type Locale } from '@styld/i18n'
import type { CheckStatus } from '@styld/protocol'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { styled } from '../Styled.ts'
import * as styles from './CheckNotice.styles.ts'

/** What the owner is told of Styld's check on something they made public: being checked, kept out of discovery,
 * or hidden from others and why. A pass, and something never public, say nothing. */
export const checkNotice = <Message>(check: CheckStatus | null, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (check === null || (check.state === 'passed' && !check.hidden)) return h.empty
  if (check.hidden || check.state === 'failed')
    return h.p(
      [h.Role('alert'), ...styled(h, styles.hidden())],
      [
        check.hidden
          ? format(locale, 'share.check.hidden', {})
          : format(locale, 'share.check.failed', {
              reason: format(locale, `share.check.reasons.${check.reason ?? 'other'}`, {}),
            }),
      ],
    )
  return h.p(
    [h.Role('status'), ...styled(h, styles.note())],
    [format(locale, check.state === 'pending' ? 'share.check.pending' : 'share.check.unsure', {})],
  )
}
