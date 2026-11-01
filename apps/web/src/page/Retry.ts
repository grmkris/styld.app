import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { styled } from '../Styled.ts'
import { message as messageSection, messageTitle } from './WardrobeView.styles.ts'

// The one view every page shows when what it asked for did not come, or when it stopped following work after polls
// that did not get through: what went wrong in a heading, and Try again.

/** Something that could not be read, with Try again. */
export const retryView = <Message>(title: string, locale: Locale, onRetry: Message, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Role('alert'), ...styled(h, messageSection())],
    [
      h.h2(styled(h, messageTitle()), [title]),
      actionButton({ label: format(locale, 'common.tryAgain', {}), style: secondaryAction(), onClick: onRetry }, h),
    ],
  )
