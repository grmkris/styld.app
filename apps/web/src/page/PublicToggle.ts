import { format, type Locale } from '@styld/i18n'
import type { CheckStatus } from '@styld/protocol'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { loader } from '../Icon.ts'
import { profileRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { checkNotice } from './CheckNotice.ts'
import * as styles from './PublicToggle.styles.ts'

/** Where making something public stands: nothing asked, asked, or refused (a published profile comes first). */
export type PublicWork = 'idle' | 'sending' | 'failed' | 'needsProfile'

/** Public or private, for a board or a look: the switch, who sees it, Styld's check, and why it did not change. */
export const publicToggle = <Message>(
  config: {
    readonly id: string
    readonly isPublic: boolean
    readonly check: CheckStatus | null
    readonly work: PublicWork
    readonly onToggle: (isPublic: boolean) => Message
  },
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(styled(h, styles.sharing()), [
    h.label(
      [h.For(config.id), ...styled(h, styles.toggle())],
      [
        h.input([
          h.Id(config.id),
          h.Type('checkbox'),
          h.Checked(config.isPublic),
          h.Disabled(config.work === 'sending'),
          h.OnChange(() => config.onToggle(!config.isPublic)),
        ]),
        format(locale, 'share.publicTitle', {}),
      ],
    ),
    h.p(styled(h, styles.meta()), [format(locale, config.isPublic ? 'share.linkTitle' : 'share.linkOff', {})]),
    config.isPublic ? checkNotice(config.check, locale, h) : h.empty,
    config.work === 'sending' ? h.p([h.Role('status')], [loader(h)]) : h.empty,
    config.work === 'needsProfile'
      ? h.p(
          [h.Role('alert'), ...styled(h, styles.problem())],
          [
            format(locale, 'share.publishFirst', {}),
            ' ',
            h.a([h.Href(profileRouter({}))], [format(locale, 'profile.editor.mode.edit', {})]),
          ],
        )
      : h.empty,
    config.work === 'failed'
      ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'share.failed', {})])
      : h.empty,
  ])
