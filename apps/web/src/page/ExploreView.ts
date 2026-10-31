import { format, type Locale } from '@styld/i18n'
import { type Author, type Explore, type FoundBoard, Mood, type SearchResults } from '@styld/protocol'
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { avatar } from '../Avatar.ts'
import { closeIcon, loader, searchIcon } from '../Icon.ts'
import { personRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import * as styles from './ExploreView.styles.ts'
import { creditedBoardCard } from './PublicTiles.ts'
import { chip, clear, quiet, search as searchPill, searchInput } from './AskView.styles.ts'
import { ExploreSearch, Message, searchFieldId, searchResultsId } from './Visit.ts'

const boardList = (boards: ReadonlyArray<FoundBoard>, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.ul(
    styled(h, styles.boards()),
    boards.map(({ board, by }) => h.keyed('li')(board.id, [], [creditedBoardCard(board, by, locale, h)])),
  )

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
        [h.h2([h.Id(id)], [title]), boardList(boards, locale, h)],
      )

/** A person: their initials, name and handle, linking to their profile. */
export const personTile = <Message>(person: Author, h: HtmlBuilder<Message>) =>
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
    [h.Role('group'), h.AriaLabel(format(locale, 'explore.moodsLabel', {})), ...styled(h, styles.chips())],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaPressed(String(Option.isNone(current))),
          h.OnClick(Message.ChoseMood({ mood: Option.none() })),
          ...styled(h, cx(chip(), styles.chosen())),
        ],
        [format(locale, 'explore.allMoods', {})],
      ),
      ...Mood.literals.map((mood) =>
        h.button(
          [
            h.Type('button'),
            h.AriaPressed(String(Option.getOrNull(current) === mood)),
            h.OnClick(Message.ChoseMood({ mood: Option.some(mood) })),
            ...styled(h, cx(chip(), styles.chosen())),
          ],
          [format(locale, `explore.moods.${mood}`, {})],
        ),
      ),
    ],
  )

/** The newest public boards, with the mood chips that filter them under their head. A mood with no boards yet says
 * so, rather than leaving the section blank under its chips. */
const newestSection = (
  newest: ReadonlyArray<FoundBoard>,
  mood: Option.Option<Mood>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.section(
    [h.AriaLabelledBy('explore-newest'), ...styled(h, styles.section())],
    [
      h.h2([h.Id('explore-newest')], [format(locale, 'explore.newest', {})]),
      moodChips(mood, locale, h),
      newest.length > 0
        ? boardList(newest, locale, h)
        : Option.isSome(mood)
          ? h.p([h.Role('status'), ...styled(h, styles.empty())], [format(locale, 'explore.noneInMood', {})])
          : h.p(styled(h, styles.empty()), [format(locale, 'explore.empty', {})]),
    ],
  )

/** Explore's sections under its search: Edits from Styld, featured boards, the newest boards in the chosen mood, then
 * people to follow. */
export const exploreSections = (
  explore: Explore,
  mood: Option.Option<Mood>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  boardsRow('explore-edits', format(locale, 'explore.edits', {}), explore.edits, locale, h),
  boardsRow('explore-featured', format(locale, 'explore.featured', {}), explore.featured, locale, h),
  newestSection(explore.newest, mood, locale, h),
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
]

/** The search pill (DESIGN.md › Search): people and public boards, for anyone, signed in or out. Enter searches; the
 * clear inside it brings Explore's sections back. */
export const exploreSearchForm = (query: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.form(
    [h.Role('search'), h.OnSubmit(Message.SubmittedSearch()), ...styled(h, searchPill())],
    [
      h.label([h.For(searchFieldId), ...styled(h, visuallyHidden())], [format(locale, 'explore.searchLabel', {})]),
      searchIcon(h),
      h.input([
        h.Id(searchFieldId),
        h.Type('search'),
        h.Name('q'),
        h.Placeholder(format(locale, 'explore.searchLabel', {})),
        h.Value(query),
        h.Attribute('maxlength', '80'),
        h.Autocomplete('off'),
        h.Attribute('enterkeyhint', 'search'),
        h.Attribute('autocapitalize', 'none'),
        h.Attribute('spellcheck', 'false'),
        ...styled(h, searchInput()),
        h.OnInput((value) => Message.UpdatedSearchQuery({ value })),
      ]),
      query.length > 0
        ? h.button(
            [
              h.Type('button'),
              h.AriaLabel(format(locale, 'explore.clearSearch', {})),
              ...styled(h, cx(quiet(), clear())),
              h.OnClick(Message.ClickedClearSearch()),
            ],
            [closeIcon(h)],
          )
        : h.empty,
    ],
  )

/** People and boards found, each under its head; nothing found says so and offers to clear the search. */
const foundView = (query: string, results: SearchResults, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [
      h.Id(searchResultsId),
      h.AriaLabel(format(locale, 'explore.resultsFor', { query })),
      ...styled(h, styles.results()),
    ],
    results.people.length === 0 && results.boards.length === 0
      ? [
          h.p([h.Role('status'), ...styled(h, styles.empty())], [format(locale, 'explore.noResults', { query })]),
          actionButton(
            {
              label: format(locale, 'explore.clearSearch', {}),
              style: secondaryAction(),
              onClick: Message.ClickedClearSearch(),
            },
            h,
          ),
        ]
      : [
          results.people.length === 0
            ? h.empty
            : h.section(
                [h.AriaLabelledBy('explore-found-people'), ...styled(h, styles.section())],
                [
                  h.h2([h.Id('explore-found-people')], [format(locale, 'profile.public.people', {})]),
                  h.ul(
                    styled(h, styles.people()),
                    results.people.map((person) => personTile(person, h)),
                  ),
                ],
              ),
          boardsRow('explore-found-boards', format(locale, 'profile.public.boards', {}), results.boards, locale, h),
        ],
  )

/** What a search shows in place of Explore's sections while it is on. */
export const searchView = (search: ExploreSearch, locale: Locale, h: HtmlBuilder<Message>): Html =>
  ExploreSearch.match(search, {
    Off: () => h.empty,
    Searching: () =>
      h.p([h.Role('status'), ...styled(h, styles.searching())], [loader(h), format(locale, 'explore.searching', {})]),
    Found: ({ query, results }) => foundView(query, results, locale, h),
    Failed: () =>
      h.div(styled(h, styles.failed()), [
        h.p([h.Role('alert')], [format(locale, 'explore.searchFailed', {})]),
        actionButton(
          {
            label: format(locale, 'common.tryAgain', {}),
            style: secondaryAction(),
            onClick: Message.ClickedRetrySearch(),
          },
          h,
        ),
      ]),
  })
