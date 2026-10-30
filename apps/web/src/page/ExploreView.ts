import { format, type Locale } from '@styld/i18n'
import { type Author, type Explore, type FoundBoard, Mood } from '@styld/protocol'
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { avatar } from '../Avatar.ts'
import { personRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import * as styles from './ExploreView.styles.ts'
import * as feedStyles from './FeedView.styles.ts'
import { boardCard, byline } from './PublicTiles.ts'
import { Message } from './Visit.ts'

const boardsRow = (
  id: string,
  title: string,
  boards: ReadonlyArray<FoundBoard>,
  locale: Locale,
  h: HtmlBuilder<Message>,
) =>
  boards.length === 0
    ? h.empty
    : h.section(
        [h.AriaLabelledBy(id), ...styled(h, styles.section())],
        [
          h.h2([h.Id(id)], [title]),
          h.ul(
            styled(h, styles.boards()),
            boards.map(({ board, by }) =>
              h.keyed('li')(board.id, styled(h, feedStyles.item()), [
                boardCard(board, locale, h),
                byline(by, locale, h),
              ]),
            ),
          ),
        ],
      )

const personTile = (person: Author, h: HtmlBuilder<Message>) =>
  h.keyed('li')(
    person.handle,
    [],
    [
      h.a(
        [h.Href(personRouter({ handle: person.handle })), ...styled(h, styles.person())],
        [
          avatar(person.name, person.tone, 'medium', h),
          h.span(styled(h, styles.personName()), [person.name]),
          h.span(styled(h, styles.handle()), [`@${person.handle}`]),
        ],
      ),
    ],
  )

/** The mood chips: all, or one of the six. */
const moodChips = (current: Option.Option<Mood>, locale: Locale, h: HtmlBuilder<Message>) =>
  h.div(
    [h.Role('group'), h.AriaLabel(format(locale, 'explore.title', {})), ...styled(h, styles.chips())],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaPressed(String(Option.isNone(current))),
          h.OnClick(Message.ChoseMood({ mood: Option.none() })),
          ...styled(h, styles.chip()),
        ],
        [format(locale, 'explore.allMoods', {})],
      ),
      ...Mood.literals.map((mood) =>
        h.button(
          [
            h.Type('button'),
            h.AriaPressed(String(Option.getOrNull(current) === mood)),
            h.OnClick(Message.ChoseMood({ mood: Option.some(mood) })),
            ...styled(h, styles.chip()),
          ],
          [format(locale, `explore.moods.${mood}`, {})],
        ),
      ),
    ],
  )

/** Explore: Edits from Styld, featured boards, people to follow, then the newest boards in the chosen mood. */
export const exploreView = (
  explore: Explore,
  mood: Option.Option<Mood>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html => {
  const isEmpty = [explore.edits, explore.featured, explore.people, explore.newest].every((part) => part.length === 0)
  return h.div(styled(h, styles.page()), [
    h.h1([], [format(locale, 'explore.title', {})]),
    boardsRow('explore-edits', format(locale, 'explore.edits', {}), explore.edits, locale, h),
    boardsRow('explore-featured', format(locale, 'explore.featured', {}), explore.featured, locale, h),
    explore.people.length === 0
      ? h.empty
      : h.section(
          [h.AriaLabelledBy('explore-people'), ...styled(h, styles.section())],
          [
            h.h2([h.Id('explore-people')], [format(locale, 'explore.people', {})]),
            h.ul(
              styled(h, styles.people()),
              explore.people.map((person) => personTile(person, h)),
            ),
          ],
        ),
    moodChips(mood, locale, h),
    boardsRow('explore-newest', format(locale, 'explore.newest', {}), explore.newest, locale, h),
    isEmpty ? h.p(styled(h, styles.empty()), [format(locale, 'explore.empty', {})]) : h.empty,
  ])
}
