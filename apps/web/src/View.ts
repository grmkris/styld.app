import { Select } from '@foldkit/ui'
import { direction, format, type Locale, type MessageKey } from '@styld/i18n'
import { Option, String } from 'effect'
import { AsyncData } from 'foldkit'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import type { Html as Styles } from 'zyzz/runtime'
import { LocaleSave, Message, type Model, Session } from './App.ts'
import { actionButton } from './ActionButton.ts'
import { primaryAction, secondaryAction } from './Actions.styles.ts'
import { availableLocales } from './Locale.ts'
import { styled } from './Styled.ts'
import { askTabIcon, boardsTabIcon, exploreTabIcon, homeTabIcon, wardrobeTabIcon } from './Icon.ts'
import * as AddPiecesView from './page/AddPieces/View.ts'
import * as AskView from './page/AskView.ts'
import * as TodayView from './page/TodayView.ts'
import * as BoardPageView from './page/Board/PageView.ts'
import * as BoardView from './page/Board/View.ts'
import * as BoardsView from './page/BoardsView.ts'
import * as ReviewView from './page/ReviewView.ts'
import * as StylistView from './page/StylistView.ts'
import * as LooksView from './page/LooksView.ts'
import * as LookView from './page/LookView.ts'
import * as VisitView from './page/VisitView.ts'
import * as WishlistView from './page/WishlistView.ts'
import * as ProfileEditorView from './page/ProfileEditorView.ts'
import { accountView } from './page/AccountView.ts'
import * as LoginView from './page/LoginView.ts'
import * as PieceView from './page/PieceView.ts'
import * as WardrobeView from './page/WardrobeView.ts'
import {
  accountRouter,
  AppRoute,
  askRouter,
  boardsRouter,
  exploreRouter,
  homeRouter,
  signInHref,
  tabOf,
  wardrobeRouter,
} from './route.ts'
import {
  brand,
  brandMark,
  consentActions,
  consentBanner,
  footer,
  footerButton,
  footerLink,
  footerLinks,
  intro,
  masthead,
  mastheadBesideRail,
  railLogo,
  railLow,
  withRail,
  picker,
  pickerError,
  pickerSelect,
  accountLink,
  appNav,
  navBesideTable,
  navAsk,
  navAvatar,
  navAvatarDisc,
  navAvatarPending,
  navYou,
  navItem,
  navLabel,
  signInLink,
  signedOutLinks,
  site,
  tabPage,
  withActionBand,
  withTabBar,
} from './View.styles.ts'
import { initials } from './Avatar.ts'
import { avatar as avatarStyle } from './Avatar.styles.ts'
import { landingView } from './Landing.ts'
import { pieceLabel } from './page/WardrobeWords.ts'

const languages: ReadonlyArray<Readonly<{ locale: Locale; label: string }>> = [
  { locale: 'en', label: 'English' },
  { locale: 'sl', label: 'Slovenščina' },
  { locale: 'en-XA', label: 'English (expanded)' },
  { locale: 'ar-XB', label: 'English (RTL)' },
]

const languagePicker = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  const pending = LocaleSave.guards.Saving(model.localeSave)
  const failed = LocaleSave.guards.Failed(model.localeSave)
  return Select.view(
    {
      id: 'language',
      value: locale,
      isDisabled: pending,
      hasDescription: failed,
      onChange: (value) => Message.SelectedLocale({ value }),
      toView: (attributes) =>
        h.div(styled(h, picker()), [
          h.label(attributes.label, [format(locale, 'auth.language', {})]),
          h.select(
            [...attributes.select, ...styled(h, pickerSelect()), h.AriaBusy(pending)],
            languages
              .filter((language) => availableLocales.includes(language.locale))
              .map((language) => h.keyed('option')(language.locale, [h.Value(language.locale)], [language.label])),
          ),
          failed
            ? h.p(
                [...attributes.description, h.Role('alert'), ...styled(h, pickerError())],
                [format(locale, 'common.error', {})],
              )
            : h.empty,
        ]),
    },
    h,
  )
}

const notFoundView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.main(
    [h.Id('main'), ...styled(h, intro())],
    [
      h.h1([], [format(locale, 'common.notFoundTitle', {})]),
      h.p([], [format(locale, 'common.notFoundDescription', {})]),
      h.a([h.Href(homeRouter({}))], [format(locale, 'common.goHome', {})]),
    ],
  )

/** Asks before any browser diagnostics are recorded; the footer reopens it to change the choice. */
const consentPrompt = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Role('region'), h.AriaLabel(format(locale, 'telemetryConsent.settings', {})), ...styled(h, consentBanner())],
    [
      h.p([], [format(locale, 'telemetryConsent.message', {})]),
      h.div(styled(h, consentActions()), [
        actionButton(
          {
            label: format(locale, 'telemetryConsent.allow', {}),
            style: primaryAction(),
            onClick: Message.ChoseTelemetryConsent({ granted: true }),
          },
          h,
        ),
        actionButton(
          {
            label: format(locale, 'telemetryConsent.decline', {}),
            style: secondaryAction(),
            onClick: Message.ChoseTelemetryConsent({ granted: false }),
          },
          h,
        ),
      ]),
    ],
  )

/** The top bar's one action (Gallery): sign in, or your initial linking to your account. */
const sessionLink = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  return Session.match(model.session, {
    SignedIn: ({ claims }) =>
      h.a(
        [h.Href(accountRouter({})), h.AriaLabel(format(locale, 'account.title', {})), ...styled(h, accountLink())],
        [claims.displayName.slice(0, 1).toUpperCase()],
      ),
    SigningOut: () => h.empty,
    Checking: () => h.empty,
    Unavailable: () => h.empty,
    // Signed out the bar keeps Explore and Sign in (DESIGN › Navigation); neither shows on its own page.
    SignedOut: () => {
      const onLogin = AppRoute.guards.Login(model.route) || AppRoute.guards.LoginForConnection(model.route)
      return h.div(styled(h, signedOutLinks()), [
        AppRoute.guards.Explore(model.route)
          ? h.empty
          : h.a([h.Href(exploreRouter({})), ...styled(h, signInLink())], [format(locale, 'explore.title', {})]),
        onLogin
          ? h.empty
          : h.a([h.Href(signInHref), ...styled(h, signInLink())], [format(locale, 'landing.signIn', {})]),
      ])
    },
  })
}

/** You, in the masthead while the navigation shows: your profile's initials on its tone, as Account and your public
 * page show you; the sign-in name's initial until the profile is read; blank while the session is. */
const youLink = (model: Model, initial: string, h: HtmlBuilder<Message>): Html =>
  h.a(
    [
      h.Href(accountRouter({})),
      h.AriaLabel(format(model.context.locale, 'nav.account', {})),
      ...(sectionOf(model.route) === 'you' ? [h.AriaCurrent('page')] : []),
      ...styled(h, navAvatar()),
    ],
    [
      Option.match(model.you, {
        onSome: ({ name, tone }) =>
          h.span([h.DataAttribute('tone', tone), ...styled(h, cx(avatarStyle(), navYou()))], [initials(name)]),
        onNone: () =>
          h.span(styled(h, initial === '' ? cx(navAvatarDisc(), navAvatarPending()) : navAvatarDisc()), [initial]),
      }),
    ],
  )

const titleKey = AppRoute.match<MessageKey>({
  Home: () => 'landing.title',
  Login: () => 'auth.signInTitle',
  LoginForConnection: () => 'auth.signInTitle',
  Account: () => 'account.title',
  Wardrobe: () => 'wardrobe.title',
  AddPieces: () => 'capture.addTitle',
  Review: () => 'scan.toReview',
  Looks: () => 'looks.title',
  Wishlist: () => 'wardrobe.wishlist',
  Look: () => 'looks.title',
  Profile: () => 'profile.editor.title',
  Ask: () => 'ask.title',
  Stylist: () => 'stylist.title',
  Boards: () => 'boards.title',
  Board: () => 'boards.title',
  BoardCollage: () => 'boards.title',
  Piece: () => 'wardrobe.title',
  Person: () => 'profile.public.people',
  PublicPiece: () => 'profile.public.pieces',
  Explore: () => 'explore.title',
  NotFound: () => 'common.notFoundTitle',
})

type Section = 'home' | 'explore' | 'wardrobe' | 'ask' | 'boards' | 'you'

const sectionOf = AppRoute.match<Section | undefined>({
  Home: () => 'home',
  Wardrobe: () => 'wardrobe',
  AddPieces: () => 'wardrobe',
  Review: () => 'wardrobe',
  Piece: () => 'wardrobe',
  Looks: () => 'wardrobe',
  Wishlist: () => 'wardrobe',
  Look: () => 'wardrobe',
  Profile: () => 'you',
  Ask: () => 'ask',
  Stylist: () => 'ask',
  Boards: () => 'boards',
  Board: () => 'boards',
  BoardCollage: () => 'boards',
  Account: () => 'you',
  Login: () => undefined,
  LoginForConnection: () => undefined,
  Person: () => undefined,
  PublicPiece: () => undefined,
  Explore: () => 'explore',
  NotFound: () => undefined,
})

/** Gallery 2's navigation: Home, Explore, Ask in the middle, Wardrobe and Boards; you are in the masthead. A
 * floating glass pill on the phone, a rail on the desktop's left edge; it keeps its place while a page cross-fades. */
const appNavigation = (model: Model, initial: string, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  const current = sectionOf(model.route)
  const item = (section: Section, href: string, label: string, content: Html, ask = false) =>
    h.a(
      [
        h.Href(href),
        h.AriaLabel(label),
        h.Title(label),
        ...(current === section ? [h.AriaCurrent('page')] : []),
        ...styled(h, ask ? cx(navItem(), navAsk()) : navItem()),
      ],
      [content, h.span(styled(h, navLabel()), [label])],
    )
  return h.nav(
    [
      h.AriaLabel(format(locale, 'nav.navigation', {})),
      ...styled(h, AppRoute.guards.BoardCollage(model.route) ? cx(appNav(), navBesideTable()) : appNav()),
    ],
    [
      item('home', homeRouter({}), format(locale, 'nav.home', {}), homeTabIcon(h)),
      item('explore', exploreRouter({}), format(locale, 'explore.title', {}), exploreTabIcon(h)),
      // Ask keeps its search: coming back from another tab brings it back.
      item(
        'ask',
        askRouter({ q: Option.liftPredicate(model.ask.query.trim(), String.isNonEmpty) }),
        format(locale, 'nav.ask', {}),
        askTabIcon(h),
        true,
      ),
      item('wardrobe', wardrobeRouter({}), format(locale, 'nav.wardrobe', {}), wardrobeTabIcon(h)),
      item('boards', boardsRouter({}), format(locale, 'nav.boards', {}), boardsTabIcon(h)),
    ],
  )
}

/** The avatar's initial while the navigation shows: once signed in, and while the session is read for a request
 * that came with a session cookie, when it is blank (`''`) until the initial is known. Undefined hides the
 * navigation. */
const navigationInitial = (model: Model) =>
  Session.match(model.session, {
    SignedIn: ({ claims }) => claims.displayName.slice(0, 1).toUpperCase(),
    SigningOut: ({ claims }) => claims.displayName.slice(0, 1).toUpperCase(),
    Checking: () => (model.context.hasSessionCookie === true && Option.isSome(tabOf(model.route)) ? '' : undefined),
    SignedOut: () => undefined,
    Unavailable: () => undefined,
  })

/** Tab pages keep the footer below the fold while they fill in, so nothing on screen moves. */
const siteStyle = (hasNavigation: boolean, isTab: boolean, hasActionBand: boolean) => {
  // The band's padding wins over the tab bar's; the rail's inline padding stays.
  if (hasActionBand)
    return hasNavigation ? cx(site(), withTabBar(), withRail(), withActionBand()) : cx(site(), withActionBand())
  if (hasNavigation)
    return isTab ? cx(site(), withTabBar(), withRail(), tabPage()) : cx(site(), withTabBar(), withRail())
  return isTab ? cx(site(), tabPage()) : site()
}

/** The wordmark, home: in the top bar, and above the rail on a wide screen. */
const wordmark = (style: Styles.Attributes, h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(homeRouter({})), ...styled(h, style), h.AriaLabel('Styld')],
    [h.img([h.Src('/brand/wordmark.svg'), h.Alt('Styld'), h.Width('53'), h.Height('20'), ...styled(h, brandMark())])],
  )

/** Someone signed in, or on their way in with a session cookie: Home is their table rather than the landing page,
 * and public pages offer them Follow, Save and Report rather than a way to sign in. */
const hasSession = (model: Model) =>
  Session.match(model.session, {
    SignedIn: () => true,
    SigningOut: () => true,
    Checking: () => model.context.hasSessionCookie === true,
    SignedOut: () => false,
    Unavailable: () => false,
  })

const pageTitle = (model: Model) =>
  format(
    model.context.locale,
    AppRoute.guards.Home(model.route) && hasSession(model) ? 'today.title' : titleKey(model.route),
    {},
  )

const loginPage = (model: Model, forConnection: boolean, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'login',
    model: model.login,
    view: LoginView.view,
    viewInputs: { forConnection, locale: model.context.locale },
    toParentMessage: (message) => Message.GotLoginMessage({ message }),
  })

const wardrobePage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'wardrobe',
    model: model.wardrobe,
    view: WardrobeView.view,
    viewInputs: { locale: model.context.locale },
    toParentMessage: (message) => Message.GotWardrobeMessage({ message }),
  })

const piecePage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'piece',
    model: model.piece,
    view: PieceView.view,
    viewInputs: { locale: model.context.locale },
    toParentMessage: (message) => Message.GotPieceMessage({ message }),
  })

const addPiecesPage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'add-pieces',
    model: model.addPieces,
    view: AddPiecesView.view,
    viewInputs: { locale: model.context.locale },
    toParentMessage: (message) => Message.GotAddPiecesMessage({ message }),
  })

const looksPage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'looks',
    model: model.looks,
    view: LooksView.view,
    viewInputs: { locale: model.context.locale },
    toParentMessage: (message) => Message.GotLooksMessage({ message }),
  })

const profilePage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'profile',
    model: model.profile,
    view: ProfileEditorView.view,
    viewInputs: { locale: model.context.locale },
    toParentMessage: (message) => Message.GotProfileMessage({ message }),
  })

const visitPage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'visit',
    model: model.visit,
    view: VisitView.view,
    viewInputs: { locale: model.context.locale, signedIn: hasSession(model), origin: model.context.origin },
    toParentMessage: (message) => Message.GotVisitMessage({ message }),
  })

const wishlistPage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'wishlist',
    model: model.wishlist,
    view: WishlistView.view,
    viewInputs: { locale: model.context.locale },
    toParentMessage: (message) => Message.GotWishlistMessage({ message }),
  })

const lookPage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'look',
    model: model.look,
    view: LookView.view,
    viewInputs: { locale: model.context.locale, signedIn: hasSession(model) },
    toParentMessage: (message) => Message.GotLookMessage({ message }),
  })

/** Home: today's table for a signed-in person, the landing page for everyone else. While the session is read,
 * a request that came with a session cookie waits quietly instead of flashing the landing page. */
const todayPage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'today',
    model: model.today,
    view: TodayView.view,
    viewInputs: { locale: model.context.locale, pieces: model.wardrobe.pieces },
    toParentMessage: (message) => Message.GotTodayMessage({ message }),
  })

const homePage = (model: Model, h: HtmlBuilder<Message>): Html =>
  hasSession(model) ? todayPage(model, h) : landingView(model, h)

const askPage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'ask',
    model: model.ask,
    view: AskView.view,
    viewInputs: { locale: model.context.locale, pieces: model.wardrobe.pieces },
    toParentMessage: (message) => Message.GotAskMessage({ message }),
  })

const boardsPage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'boards',
    model: model.boards,
    view: BoardsView.view,
    viewInputs: { locale: model.context.locale },
    toParentMessage: (message) => Message.GotBoardsMessage({ message }),
  })

const boardPage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'board',
    model: model.board,
    view: BoardPageView.view,
    viewInputs: { locale: model.context.locale, signedIn: hasSession(model) },
    toParentMessage: (message) => Message.GotBoardMessage({ message }),
  })

const collagePage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'board-collage',
    model: model.board,
    view: BoardView.view,
    viewInputs: { locale: model.context.locale },
    toParentMessage: (message) => Message.GotBoardMessage({ message }),
  })

/** The person's pieces by id, named as the wardrobe names them, for the pieces Styld shows. */
const pieceNames = (model: Model): ReadonlyMap<string, string> =>
  AsyncData.isSuccess(model.wardrobe.pieces)
    ? new Map(model.wardrobe.pieces.data.map((piece) => [piece.id, pieceLabel(piece, model.context.locale)]))
    : new Map()

const stylistPage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'stylist',
    model: model.stylist,
    view: StylistView.view,
    viewInputs: { locale: model.context.locale, names: pieceNames(model), timeZone: model.context.timeZone },
    toParentMessage: (message) => Message.GotStylistMessage({ message }),
  })

const reviewPage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'review',
    model: model.review,
    view: ReviewView.view,
    viewInputs: { locale: model.context.locale, timeZone: model.context.timeZone },
    toParentMessage: (message) => Message.GotReviewMessage({ message }),
  })

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const { locale } = model.context
  const initial = navigationInitial(model)
  const shell = siteStyle(initial !== undefined, Option.isSome(tabOf(model.route)), AppRoute.guards.Review(model.route))
  return {
    title: `${pageTitle(model)} | Styld`,
    lang: locale,
    dir: direction(locale) === 'rtl' ? 'Rtl' : 'Ltr',
    body: h.div(styled(h, shell), [
      // With the rail on a wide screen the top bar gives way to the wordmark above the rail and you under it.
      h.header(styled(h, initial === undefined ? masthead() : cx(masthead(), mastheadBesideRail())), [
        wordmark(brand(), h),
        initial === undefined ? sessionLink(model, h) : youLink(model, initial, h),
      ]),
      AppRoute.match(model.route, {
        Home: () => homePage(model, h),
        Login: () => loginPage(model, false, h),
        LoginForConnection: () => loginPage(model, true, h),
        Account: () => accountView(model, h),
        Wardrobe: () => wardrobePage(model, h),
        AddPieces: () => addPiecesPage(model, h),
        Review: () => reviewPage(model, h),
        Looks: () => looksPage(model, h),
        Wishlist: () => wishlistPage(model, h),
        Look: () => lookPage(model, h),
        Profile: () => profilePage(model, h),
        Ask: () => askPage(model, h),
        Stylist: () => stylistPage(model, h),
        Boards: () => boardsPage(model, h),
        Board: () => boardPage(model, h),
        BoardCollage: () => collagePage(model, h),
        Piece: () => piecePage(model, h),
        Person: () => visitPage(model, h),
        PublicPiece: () => visitPage(model, h),
        Explore: () => visitPage(model, h),
        NotFound: () => notFoundView(locale, h),
      }),
      initial === undefined ? h.empty : appNavigation(model, initial, h),
      initial === undefined ? h.empty : wordmark(railLogo(), h),
      initial === undefined ? h.empty : h.div(styled(h, railLow()), [youLink(model, initial, h)]),
      // The language, named, then Diagnostics and Contact together at the other end.
      h.footer(styled(h, footer()), [
        languagePicker(model, h),
        h.div(styled(h, footerLinks()), [
          actionButton(
            {
              label: format(locale, 'telemetryConsent.settings', {}),
              style: footerButton(),
              onClick: Message.OpenedTelemetrySettings(),
            },
            h,
          ),
          h.a([h.Href('mailto:hello@styld.app'), ...styled(h, footerLink())], [format(locale, 'landing.contact', {})]),
        ]),
      ]),
      model.telemetry.prompting ? consentPrompt(locale, h) : h.empty,
    ]),
  }
}
