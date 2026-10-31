import { format, type Locale } from '@styld/i18n'
import type { Mood, PublicPiecePage, PublicProfile } from '@styld/protocol'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { pieceRouter } from '../route.ts'
import { avatar } from '../Avatar.ts'
import { block, line } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { cx } from 'zyzz'
import { publicPieceImage } from './Board/Table.ts'
import * as PeopleView from './PeopleView.ts'
import { boardCard, byline, lookTile, pieceTile, tileGrid } from './PublicTiles.ts'
import { exploreLoading, exploreSearchForm, exploreSections, searchView } from './ExploreView.ts'
import { page as explorePage } from './ExploreView.styles.ts'
import { ExploreSearch, Message, type Model, type PersonTab, Shown, Target } from './Visit.ts'
import * as styles from './VisitView.styles.ts'
import { pieceLabel } from './WardrobeWords.ts'

const tabLabel = (tab: PersonTab, locale: Locale) =>
  format(
    locale,
    tab === 'boards' ? 'profile.public.boards' : tab === 'looks' ? 'profile.public.looks' : 'profile.public.pieces',
    {},
  )

const tabsOf = (profile: PublicProfile): ReadonlyArray<PersonTab> =>
  profile.pieces === null ? ['boards', 'looks'] : ['boards', 'looks', 'pieces']

const emptyOr = (tiles: Html, isEmpty: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  isEmpty ? h.p(styled(h, styles.empty()), [format(locale, 'profile.public.empty', {})]) : tiles

const tabContent = (profile: PublicProfile, tab: PersonTab, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (tab === 'boards')
    return emptyOr(
      h.ul(
        styled(h, styles.boards()),
        profile.boards.map((board) => h.keyed('li')(board.id, [], [boardCard(board, locale, h)])),
      ),
      profile.boards.length === 0,
      locale,
      h,
    )
  if (tab === 'looks')
    return emptyOr(
      tileGrid(
        profile.looks.map((look) => ({ id: look.id, tile: lookTile(look, h) })),
        h,
      ),
      profile.looks.length === 0,
      locale,
      h,
    )
  const pieces = profile.pieces ?? []
  return emptyOr(
    tileGrid(
      pieces.map((piece) => ({ id: piece.id, tile: pieceTile(piece, locale, h) })),
      h,
    ),
    pieces.length === 0,
    locale,
    h,
  )
}

/** A published profile: the avatar, name, handle and city, the bio, then its Boards, Looks and Pieces. */
/** Follow, block, save and report, for whoever is visiting. */
const peopleActions = (model: Model, inputs: PeopleView.Inputs, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'visit-people',
    model: model.people,
    view: PeopleView.view,
    viewInputs: inputs,
    toParentMessage: (message) => Message.GotPeopleMessage({ message }),
  })

const personView = (model: Model, profile: PublicProfile, inputs: PeopleView.Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const tabs = tabsOf(profile)
  const tab = tabs.includes(model.tab) ? model.tab : 'boards'
  return h.div(styled(h, styles.page()), [
    h.header(styled(h, styles.person()), [
      avatar(profile.name, profile.tone, 'large', h),
      h.h1(styled(h, styles.name()), [profile.name]),
      h.p(styled(h, styles.handle()), [
        profile.city === null ? `@${profile.handle}` : `@${profile.handle} · ${profile.city}`,
      ]),
      profile.bio === null ? h.empty : h.p(styled(h, styles.bio()), [profile.bio]),
      peopleActions(model, inputs, h),
    ]),
    h.div(
      [h.Role('group'), h.AriaLabel(profile.name), ...styled(h, styles.tabs())],
      tabs.map((each) =>
        h.button(
          [
            h.Type('button'),
            h.AriaPressed(String(each === tab)),
            ...styled(h, styles.tab()),
            h.OnClick(Message.ChoseTab({ tab: each })),
          ],
          [tabLabel(each, locale)],
        ),
      ),
    ),
    tabContent(profile, tab, locale, h),
  ])
}

/** A piece on its own page: its cut-out, what it is and whose. */
const pieceView = (
  model: Model,
  { piece, by, yours }: PublicPiecePage,
  { locale, signedIn }: PeopleView.Inputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(styled(h, styles.page()), [
    h.img([
      h.Src(publicPieceImage(piece.id, 'full')),
      h.Alt(pieceLabel(piece, locale)),
      ...styled(h, styles.pieceImage()),
    ]),
    h.h1(styled(h, styles.name()), [pieceLabel(piece, locale)]),
    byline(by, locale, h),
    // One's own piece has nothing to save or report: it opens in the wardrobe instead.
    yours
      ? h.a(
          [h.Href(pieceRouter({ pieceId: piece.id })), ...styled(h, secondaryAction())],
          [format(locale, 'people.openYours', {})],
        )
      : peopleActions(model, { locale, signedIn }, h),
  ])

/** Someone's profile or piece, as anyone sees it. */
/** What Explore shows under its search: its sections once they are in, or what a search found in their place. */
const exploreContent = (
  model: Model,
  mood: Option.Option<Mood>,
  { locale, signedIn }: PeopleView.Inputs,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  if (!ExploreSearch.guards.Off(model.search)) return [searchView(model.search, locale, h)]
  if (Shown.guards.Explore(model.shown)) return exploreSections(model.shown.explore, mood, model, signedIn, locale, h)
  return Shown.guards.Failed(model.shown) ? [failedView(locale, h)] : exploreLoading(locale, h)
}

/** Explore: one title above whatever it shows, so a tab arriving on it keeps the title focused as it loads, then the
 * search, which works while the sections load too. */
const exploreMain = (
  model: Model,
  mood: Option.Option<Mood>,
  inputs: PeopleView.Inputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(styled(h, explorePage()), [
    h.h1([], [format(inputs.locale, 'explore.title', {})]),
    exploreSearchForm(model.query, inputs.locale, h),
    ...exploreContent(model, mood, inputs, h),
  ])

/** A profile's or a piece's shape while it loads, and what is loading for assistive technology. */
const loadingView = (target: Target, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.page()), [
    h.p([h.Role('status'), ...styled(h, visuallyHidden())], [format(locale, 'common.loading', {})]),
    Target.guards.Piece(target)
      ? h.div(
          [h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, styles.page())],
          [
            h.span(styled(h, cx(block(), styles.pieceSkeleton()))),
            h.span(styled(h, cx(line(), styles.nameSkeleton()))),
          ],
        )
      : h.div(
          [h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, styles.person())],
          [
            h.span(styled(h, cx(block(), styles.avatarSkeleton()))),
            h.span(styled(h, cx(line(), styles.nameSkeleton()))),
            h.span(styled(h, cx(line(), styles.handleSkeleton()))),
          ],
        ),
  ])

const failedView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.page()), [
    h.p([h.Role('alert')], [format(locale, 'common.error', {})]),
    actionButton(
      { label: format(locale, 'common.retry', {}), style: secondaryAction(), onClick: Message.ClickedRetry() },
      h,
    ),
  ])

export const view = Submodel.defineView<Model, Message, PeopleView.Inputs>((model, inputs, h) => {
  const { locale } = inputs
  return h.main(
    [h.Id('main')],
    [
      Target.guards.Explore(model.target)
        ? exploreMain(model, model.target.mood, inputs, h)
        : Shown.match(model.shown, {
            Loading: () => loadingView(model.target, locale, h),
            Missing: () => h.h1([], [format(locale, 'common.notFoundTitle', {})]),
            Failed: () => failedView(locale, h),
            Person: ({ profile }) => personView(model, profile, inputs, h),
            Piece: ({ page }) => pieceView(model, page, inputs, h),
            // Explore is drawn above; a stray answer for it elsewhere shows nothing.
            Explore: () => h.empty,
          }),
    ],
  )
})
