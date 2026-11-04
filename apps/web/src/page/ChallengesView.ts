import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { styled } from '../Styled.ts'
import * as styles from './ChallengesView.styles.ts'

// Challenges on Home (Eva's sketch, owner 4 November): shown as coming soon, with her three examples. Nothing to tap
// and nothing stored until challenges are built.

const challenges = [
  { key: 'red', title: 'today.challengeRed', tint: 'clay' },
  { key: 'witch', title: 'today.challengeWitch', tint: 'slate' },
  { key: 'onePiece', title: 'today.challengeOnePiece', tint: 'sage' },
] as const

export const challengesView = <Message>(locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabelledBy('challenges'), ...styled(h, styles.section())],
    [
      h.div(styled(h, styles.head()), [
        h.h2([h.Id('challenges'), ...styled(h, styles.title())], [format(locale, 'today.challenges', {})]),
        h.span(styled(h, styles.soon()), [format(locale, 'today.comingSoon', {})]),
      ]),
      h.ul(
        styled(h, styles.row()),
        challenges.map(({ key, title, tint }) =>
          h.keyed('li')(key, [h.DataAttribute('tint', tint), ...styled(h, styles.card())], [format(locale, title, {})]),
        ),
      ),
    ],
  )
