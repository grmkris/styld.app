import { Select } from '@foldkit/ui'
import { direction, format, type Language, languageOf, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import type { Html as Styles } from 'zyzz/runtime'
import { hasSession, LocaleSave, Message, type Model, Session } from './App.ts'
import { actionButton } from './ActionButton.ts'
import { primaryAction, secondaryAction } from './Actions.styles.ts'
import { styled } from './Styled.ts'
import { askTabIcon, boardsTabIcon, homeTabIcon, wardrobeTabIcon } from './Icon.ts'
import {
  accountRouter,
  AppRoute,
  stylistRouter,
  boardsRouter,
  exploreRouter,
  homeRouter,
  signInHref,
  routeMeta,
  type Section,
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
import { You } from './You.ts'
import { avatar as avatarStyle } from './Avatar.styles.ts'
import { pageView } from './PageViews.ts'
import { lenses } from './Page.ts'
import { ownBoard } from './page/Board/Model.ts'

/** The languages the menu offers, each in its own words: the reviewed ones only (`parseLocale`). */
const languages: ReadonlyArray<Readonly<{ locale: Language; label: string }>> = [
  { locale: 'en', label: 'English' },
  { locale: 'sl', label: 'Slovenščina' },
]

const languagePicker = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  const pending = LocaleSave.guards.Saving(model.localeSave)
  const failed = LocaleSave.guards.Failed(model.localeSave)
  return Select.view(
    {
      id: 'language',
      // A pseudo-locale, opened through code, shows as the language it is written over.
      value: languageOf(locale),
      isDisabled: pending,
      hasDescription: failed,
      onChange: (value) => Message.SelectedLocale({ value }),
      toView: (attributes) =>
        h.div(styled(h, picker()), [
          h.label(attributes.label, [format(locale, 'auth.language', {})]),
          h.select(
            [...attributes.select, ...styled(h, pickerSelect()), h.AriaBusy(pending)],
            languages.map((language) =>
              h.keyed('option')(language.locale, [h.Value(language.locale)], [language.label]),
            ),
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
    // The session could not be read: the bar keeps a way on (Explore) and offers to read it again, rather than
    // standing empty.
    Unavailable: () =>
      h.div(styled(h, signedOutLinks()), [
        AppRoute.guards.Explore(model.route)
          ? h.empty
          : h.a([h.Href(exploreRouter({})), ...styled(h, signInLink())], [format(locale, 'explore.title', {})]),
        h.button(
          [
            h.Type('button'),
            h.AriaLabel(format(locale, 'nav.sessionUnavailable', {})),
            h.OnClick(Message.RequestedSession()),
            ...styled(h, signInLink()),
          ],
          [format(locale, 'common.tryAgain', {})],
        ),
      ]),
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
      ...(Option.contains(routeMeta(model.route).section, 'you') ? [h.AriaCurrent('page')] : []),
      ...styled(h, navAvatar()),
    ],
    [
      You.match(model.you, {
        Known: ({ name, tone }) =>
          h.span([h.DataAttribute('tone', tone), ...styled(h, cx(avatarStyle(), navYou()))], [initials(name)]),
        // Blank while the profile is read, so the sign-in initial does not show first and then change.
        Reading: () => h.span(styled(h, cx(navAvatarDisc(), navAvatarPending()))),
        Unknown: () =>
          h.span(styled(h, initial === '' ? cx(navAvatarDisc(), navAvatarPending()) : navAvatarDisc()), [initial]),
      }),
    ],
  )

/** The navigation (owner, 2026-10-31; the Lab 2026-11-03): Home, Ask, Wardrobe and the Lab (boards, gallery and looks);
 * you are in the masthead, and Explore is a link in Home's head. A floating glass pill on the phone, a rail on the desktop's left edge; it keeps its place while a
 * page cross-fades. */
const appNavigation = (model: Model, initial: string, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  const current = routeMeta(model.route).section
  const item = (section: Section, href: string, label: string, content: Html, ask = false) =>
    h.a(
      [
        h.Href(href),
        h.AriaLabel(label),
        h.Title(label),
        ...(Option.contains(current, section) ? [h.AriaCurrent('page')] : []),
        ...styled(h, ask ? cx(navItem(), navAsk()) : navItem()),
      ],
      [content, h.span(styled(h, navLabel()), [label])],
    )
  return h.nav(
    [
      h.AriaLabel(format(locale, 'nav.navigation', {})),
      ...styled(
        h,
        Option.isSome(Option.flatMap(lenses.board.read(model.page), (board) => ownBoard(board.board)))
          ? cx(appNav(), navBesideTable())
          : appNav(),
      ),
    ],
    [
      item('home', homeRouter({}), format(locale, 'nav.home', {}), homeTabIcon(h)),
      // Ask opens the stylist directly; wardrobe search has its own entry in Wardrobe.
      item('ask', stylistRouter({ q: Option.none() }), format(locale, 'nav.ask', {}), askTabIcon(h), true),
      item('wardrobe', wardrobeRouter({}), format(locale, 'nav.wardrobe', {}), wardrobeTabIcon(h)),
      item('lab', boardsRouter({}), format(locale, 'nav.lab', {}), boardsTabIcon(h)),
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

const pageTitle = (model: Model) =>
  format(
    model.context.locale,
    AppRoute.guards.Home(model.route) && hasSession(model) ? 'today.title' : routeMeta(model.route).title,
    {},
  )

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
      pageView(model, h),
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
