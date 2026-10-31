import { Switch } from '@foldkit/ui'
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

/** Public or private, for a board or a look: Foldkit UI's switch, who sees it, Styld's check, and why it did not
 * change. A page that says where the thing stands under its title passes `describe: false`, so it is said once. */
export const publicToggle = <Message>(
  config: {
    readonly id: string
    readonly isPublic: boolean
    readonly check: CheckStatus | null
    readonly work: PublicWork
    readonly describe: boolean
    readonly onToggle: (isPublic: boolean) => Message
  },
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(styled(h, styles.sharing()), [
    Switch.view(
      {
        id: config.id,
        isChecked: config.isPublic,
        isDisabled: config.work === 'sending',
        hasDescription: config.describe,
        onToggle: config.onToggle,
        toView: (attributes) =>
          h.div(styled(h, styles.toggle()), [
            h.div(styled(h, styles.toggleText()), [
              h.span(
                [...attributes.label, ...styled(h, styles.toggleLabel())],
                [format(locale, 'share.publicTitle', {})],
              ),
              config.describe
                ? h.span(
                    [...attributes.description, ...styled(h, styles.meta())],
                    [format(locale, config.isPublic ? 'share.linkTitle' : 'share.linkOff', {})],
                  )
                : h.empty,
            ]),
            h.button([...attributes.button, ...styled(h, styles.track())], [h.span(styled(h, styles.thumb()))]),
          ]),
      },
      h,
    ),
    config.describe && config.isPublic ? checkNotice(config.check, locale, h) : h.empty,
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
