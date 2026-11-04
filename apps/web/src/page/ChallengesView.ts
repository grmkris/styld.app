import { format, type Locale } from '@styld/i18n'
import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { boardRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { boardOf, type Model } from './Challenges.ts'
import * as styles from './ChallengesView.styles.ts'

// Challenges on Home (Eva's sketch, owner 4 November): her three examples. Each opens the house board made for it once
// the house boards are seeded; until then it is a quiet card, nothing to tap, and the head says "coming soon".

const challenges = [
  { key: 'red', title: 'today.challengeRed', tint: 'clay' },
  { key: 'witch', title: 'today.challengeWitch', tint: 'slate' },
  { key: 'onePiece', title: 'today.challengeOnePiece', tint: 'sage' },
] as const

export const challengesView = <Message>(model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const cards = challenges.map((challenge) => ({ ...challenge, board: boardOf(model, challenge.key) }))
  return h.section(
    [h.AriaLabelledBy('challenges'), ...styled(h, styles.section())],
    [
      h.div(styled(h, styles.head()), [
        h.h2([h.Id('challenges'), ...styled(h, styles.title())], [format(locale, 'today.challenges', {})]),
        Array.some(cards, ({ board }) => Option.isSome(board))
          ? h.empty
          : h.span(styled(h, styles.soon()), [format(locale, 'today.comingSoon', {})]),
      ]),
      h.ul(
        styled(h, styles.row()),
        cards.map(({ key, title, tint, board }) =>
          h.keyed('li')(
            key,
            [h.DataAttribute('tint', tint), ...styled(h, styles.card())],
            [
              Option.match(board, {
                onNone: () => format(locale, title, {}),
                onSome: (boardId) =>
                  h.a([h.Href(boardRouter({ boardId })), ...styled(h, styles.open())], [format(locale, title, {})]),
              }),
            ],
          ),
        ),
      ),
    ],
  )
}
