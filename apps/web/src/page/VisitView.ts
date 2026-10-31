import { format, type Locale } from '@styld/i18n'
import type { Mood, PublicPiecePage, PublicProfile } from '@styld/protocol'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { backIcon, shareIcon } from '../Icon.ts'
import { accountRouter, exploreRouter, personRouter, pieceRouter, profileRouter, publicPieceRouter } from '../route.ts'
import { avatar } from '../Avatar.ts'
import { block, line } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { cx } from 'zyzz'
import { publicPieceImage } from './Board/Table.ts'
import { barEnd, barStart, round } from './PageBar.styles.ts'
import * as PeopleView from './PeopleView.ts'
import { boardCard, byline, lookTile, pieceTile, tileGrid } from './PublicTiles.ts'
import { exploreLoading, exploreSearchForm, exploreSections, searchView } from './ExploreView.ts'
import { head as exploreHead, page as explorePage } from './ExploreView.styles.ts'
import { pageTitle } from './PageHead.ts'
import { ExploreSearch, Message, type Model, type PersonTab, Sharing, Shown, Target } from './Visit.ts'
import * as styles from './VisitView.styles.ts'
import { kindName, pieceLabel } from './WardrobeWords.ts'

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

/** What a visitor page takes: People's inputs, and the origin a shared link starts with. */
export type Inputs = PeopleView.Inputs & { readonly origin: string }

/** One view of what the visitor can do with the person or the piece: Follow, or saving, blocking and reporting. */
const peopleSlot = (
  slotId: string,
  view: typeof PeopleView.view,
  model: Model,
  inputs: PeopleView.Inputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId,
    model: model.people,
    view,
    viewInputs: inputs,
    toParentMessage: (message) => Message.GotPeopleMessage({ message }),
  })

/** Back at the start of a profile's or a piece's head bar (prototype `.head.bar`). A shared link opens the page with
 * no history to go back through, so Back names a place. */
const backRound = (href: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(href), h.AriaLabel(format(locale, 'common.back', {})), ...styled(h, cx(round(), barStart()))],
    [backIcon(h)],
  )

/** The page's link as a share: the round at the end of a piece's head bar. */
const shareRound = (url: string, title: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaLabel(format(locale, 'share.button', {})),
      ...styled(h, cx(round(), barEnd())),
      h.OnClick(Message.ClickedShare({ url, title })),
    ],
    [shareIcon(h)],
  )

/** What Share did, where the browser had no share sheet to say it. */
const shareStatus = (sharing: Sharing, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Sharing.match(sharing, {
    Idle: () => h.empty,
    Copied: () => h.p([h.Role('status'), ...styled(h, styles.shared())], [format(locale, 'share.linkCopied', {})]),
    Failed: () => h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'share.copyFailed', {})]),
  })

/** A published profile's head (prototype `.person`): the avatar, the name, handle and city, the bio, then Follow and
 * Share, with blocking and reporting under them. One's own profile has nobody to follow or report: Edit profile
 * takes Follow's place. */
const personHead = (model: Model, profile: PublicProfile, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale, origin } = inputs
  return h.header(styled(h, styles.person()), [
    avatar(profile.name, profile.tone, 'large', h),
    h.div(styled(h, styles.who()), [
      h.h1([], [profile.name]),
      h.p(styled(h, styles.handle()), [
        profile.city === null ? `@${profile.handle}` : `@${profile.handle}, ${profile.city}`,
      ]),
      profile.bio === null ? h.empty : h.p(styled(h, styles.bio()), [profile.bio]),
    ]),
    h.div(styled(h, styles.side()), [
      h.div(styled(h, styles.personActions()), [
        profile.yours
          ? h.a(
              [h.Href(profileRouter({})), ...styled(h, secondaryAction())],
              [format(locale, 'profile.public.editProfile', {})],
            )
          : peopleSlot('visit-follow', PeopleView.followView, model, inputs, h),
        actionButton(
          {
            label: format(locale, 'share.button', {}),
            style: secondaryAction(),
            leading: shareIcon(h),
            onClick: Message.ClickedShare({
              url: `${origin}${personRouter({ handle: profile.handle })}`,
              title: profile.name,
            }),
          },
          h,
        ),
      ]),
      shareStatus(model.sharing, locale, h),
      profile.yours ? h.empty : peopleSlot('visit-people', PeopleView.view, model, inputs, h),
    ]),
  ])
}

/** A published profile: Back, its head, then its Boards, Looks and Pieces. Back goes to Explore, where people are
 * found; from one's own profile, to Account, where it is reached. */
const personView = (model: Model, profile: PublicProfile, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const tabs = tabsOf(profile)
  const tab = tabs.includes(model.tab) ? model.tab : 'boards'
  return h.div(styled(h, styles.page()), [
    h.div(styled(h, styles.bar()), [backRound(profile.yours ? accountRouter({}) : exploreRouter({}), locale, h)]),
    personHead(model, profile, inputs, h),
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

/** A piece on its own page: Back to whose it is and Share, then its cut-out, what it is and whose. */
const pieceView = (
  model: Model,
  { piece, by, yours }: PublicPiecePage,
  inputs: Inputs,
  h: HtmlBuilder<Message>,
): Html => {
  const { locale, origin } = inputs
  return h.div(styled(h, styles.page()), [
    h.div(styled(h, cx(styles.bar(), styles.pieceBar())), [
      backRound(personRouter({ handle: by.handle }), locale, h),
      h.div(styled(h, styles.barActions()), [
        shareStatus(model.sharing, locale, h),
        shareRound(`${origin}${publicPieceRouter({ pieceId: piece.id })}`, pieceLabel(piece, locale), locale, h),
      ]),
    ]),
    h.img([
      h.Src(publicPieceImage(piece.id, 'full')),
      h.Alt(pieceLabel(piece, locale)),
      ...styled(h, styles.pieceImage()),
    ]),
    // The kind under a name; a piece without one is already named by its kind.
    h.div(styled(h, styles.pieceHead()), [
      h.h1(styled(h, styles.name()), [pieceLabel(piece, locale)]),
      piece.name === null ? h.empty : h.p(styled(h, styles.meta()), [format(locale, kindName(piece), {})]),
    ]),
    // One's own piece needs no byline and has nothing to save or report: it opens in the wardrobe instead.
    ...(yours
      ? [
          h.p(styled(h, styles.meta()), [format(locale, 'people.pieceYours', {})]),
          h.a(
            [h.Href(pieceRouter({ pieceId: piece.id })), ...styled(h, secondaryAction())],
            [format(locale, 'people.openYours', {})],
          ),
        ]
      : [byline(by, locale, h), peopleSlot('visit-people', PeopleView.view, model, inputs, h)]),
  ])
}

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
    h.div(styled(h, exploreHead()), [
      // The shared title box, so Explore's title starts where every tab's does.
      pageTitle(format(inputs.locale, 'explore.title', {}), h),
      exploreSearchForm(model.query, inputs.locale, h),
    ]),
    ...exploreContent(model, mood, inputs, h),
  ])

/** A profile's or a piece's shape while it loads, under the room its head bar takes, and what is loading for assistive
 * technology. */
const loadingView = (target: Target, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.page()), [
    h.p([h.Role('status'), ...styled(h, visuallyHidden())], [format(locale, 'common.loading', {})]),
    h.span([h.AriaHidden(true), ...styled(h, styles.barSkeleton())]),
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
            h.div(styled(h, styles.who()), [
              h.span(styled(h, cx(line(), styles.titleSkeleton()))),
              h.span(styled(h, cx(line(), styles.handleSkeleton()))),
            ]),
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

export const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) => {
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
