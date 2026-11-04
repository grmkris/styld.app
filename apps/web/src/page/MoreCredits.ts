import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { linkAction } from '../Actions.styles.ts'
import { accountRouter, creditsSection } from '../route.ts'
import { styled } from '../Styled.ts'

/** A refusal's words, and when the day's credits stopped it, the way to more of them: the account's Credits, where the
 * premium week is (owner, 4 November 2026). */
export const spentWords = <Message>(
  text: string,
  spent: boolean,
  locale: Locale,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html | string> =>
  spent
    ? [
        text,
        ' ',
        h.a(
          [h.Href(`${accountRouter({})}#${creditsSection}`), ...styled(h, linkAction())],
          [format(locale, 'account.credits.more', {})],
        ),
      ]
    : [text]
