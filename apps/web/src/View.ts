import { Select } from '@foldkit/ui'
import { direction, format, type Locale, type MessageKey } from '@styld/i18n'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { LocaleSave, Message, type Model, Session } from './App.ts'
import { actionButton } from './ActionButton.ts'
import { primaryAction, secondaryAction } from './Actions.styles.ts'
import { availableLocales } from './Locale.ts'
import { styled } from './Styled.ts'
import { homeTabIcon, wardrobeTabIcon } from './Icon.ts'
import * as AddPiecesView from './page/AddPiecesView.ts'
import * as ReviewView from './page/ReviewView.ts'
import { accountView } from './page/AccountView.ts'
import * as LoginView from './page/LoginView.ts'
import * as PieceView from './page/PieceView.ts'
import * as WardrobeView from './page/WardrobeView.ts'
import { AppRoute, accountRouter, homeRouter, loginRouter, wardrobeRouter } from './route.ts'
import {
  brand,
  brandMark,
  consentActions,
  consentBanner,
  emptyState,
  footer,
  footerButton,
  footerLink,
  heroActions,
  heroTitle,
  inspiration,
  intro,
  lead,
  masthead,
  picker,
  pickerError,
  pickerSelect,
  accountLink,
  appNav,
  navAvatar,
  navIcon,
  navItem,
  phoneOnly,
  sectionNote,
  signInLink,
  site,
  visuallyHidden,
  withTabBar,
} from './View.styles.ts'

const browseAnchor = '#inspiration'
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
          h.label([...attributes.label, ...styled(h, visuallyHidden())], [format(locale, 'auth.language', {})]),
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

const homeView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.main(
    [h.Id('main')],
    [
      h.section(styled(h, intro()), [
        h.h1(styled(h, heroTitle()), [format(locale, 'landing.title', {})]),
        h.p(styled(h, lead()), [format(locale, 'landing.description', {})]),
        h.div(styled(h, heroActions()), [
          h.a([h.Href(browseAnchor), ...styled(h, primaryAction())], [format(locale, 'landing.browse', {})]),
          h.a([h.Href(loginRouter({})), ...styled(h, secondaryAction())], [format(locale, 'auth.signInWithEmail', {})]),
        ]),
      ]),
      h.section(
        [h.Id('inspiration'), ...styled(h, inspiration())],
        [
          h.h2([], [format(locale, 'landing.feedTitle', {})]),
          h.p(styled(h, sectionNote()), [format(locale, 'landing.feedDescription', {})]),
          h.p(styled(h, emptyState()), [format(locale, 'landing.feedEmpty', {})]),
        ],
      ),
    ],
  )

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
    SignedOut: () =>
      AppRoute.guards.Login(model.route) || AppRoute.guards.LoginForConnection(model.route)
        ? h.empty
        : h.a([h.Href(loginRouter({})), ...styled(h, signInLink())], [format(locale, 'landing.signIn', {})]),
  })
}

const titleKey = AppRoute.match<MessageKey>({
  Home: () => 'landing.title',
  Login: () => 'auth.signInTitle',
  LoginForConnection: () => 'auth.signInTitle',
  Account: () => 'account.title',
  Wardrobe: () => 'wardrobe.title',
  AddPieces: () => 'capture.addTitle',
  Review: () => 'scan.toReview',
  Piece: () => 'wardrobe.title',
  NotFound: () => 'common.notFoundTitle',
})

type Section = 'home' | 'wardrobe' | 'you'

const sectionOf = AppRoute.match<Section | undefined>({
  Home: () => 'home',
  Wardrobe: () => 'wardrobe',
  AddPieces: () => 'wardrobe',
  Review: () => 'wardrobe',
  Piece: () => 'wardrobe',
  Account: () => 'you',
  Login: () => undefined,
  LoginForConnection: () => undefined,
  NotFound: () => undefined,
})

/** The built sections only: Home, Wardrobe and You (Gallery's tab bar). */
const appNavigation = (model: Model, initial: string, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  const current = sectionOf(model.route)
  const item = (section: Section, href: string, label: string, icon: Html, extra: ReadonlyArray<Html> = []) =>
    h.a(
      [h.Href(href), ...(current === section ? [h.AriaCurrent('page')] : []), ...styled(h, navItem())],
      [h.span(styled(h, navIcon()), [icon]), label, ...extra],
    )
  return h.nav(
    [h.AriaLabel(format(locale, 'nav.navigation', {})), ...styled(h, appNav())],
    [
      item('home', homeRouter({}), format(locale, 'nav.home', {}), homeTabIcon(h)),
      item('wardrobe', wardrobeRouter({}), format(locale, 'nav.wardrobe', {}), wardrobeTabIcon(h)),
      h.a(
        [
          h.Href(accountRouter({})),
          ...(current === 'you' ? [h.AriaCurrent('page')] : []),
          ...styled(h, cx(navItem(), phoneOnly())),
        ],
        [h.span([h.AriaHidden(true), ...styled(h, navAvatar())], [initial]), format(locale, 'nav.account', {})],
      ),
    ],
  )
}

const signedInInitial = (model: Model) =>
  Session.match(model.session, {
    SignedIn: ({ claims }) => claims.displayName.slice(0, 1).toUpperCase(),
    SigningOut: ({ claims }) => claims.displayName.slice(0, 1).toUpperCase(),
    Checking: () => undefined,
    SignedOut: () => undefined,
    Unavailable: () => undefined,
  })

const pageTitle = (model: Model) => format(model.context.locale, titleKey(model.route), {})

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

const reviewPage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'review',
    model: model.review,
    view: ReviewView.view,
    viewInputs: { locale: model.context.locale },
    toParentMessage: (message) => Message.GotReviewMessage({ message }),
  })

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const { locale } = model.context
  const initial = signedInInitial(model)
  return {
    title: `${pageTitle(model)} | Styld`,
    lang: locale,
    dir: direction(locale) === 'rtl' ? 'Rtl' : 'Ltr',
    body: h.div(styled(h, initial === undefined ? site() : cx(site(), withTabBar())), [
      h.header(styled(h, masthead()), [
        h.a(
          [h.Href(homeRouter({})), ...styled(h, brand()), h.AriaLabel('Styld')],
          [
            h.img([
              h.Src('/brand/wordmark.svg'),
              h.Alt('Styld'),
              h.Width('53'),
              h.Height('20'),
              ...styled(h, brandMark()),
            ]),
          ],
        ),
        initial === undefined ? h.empty : appNavigation(model, initial, h),
        languagePicker(model, h),
        sessionLink(model, h),
      ]),
      AppRoute.match(model.route, {
        Home: () => homeView(locale, h),
        Login: () => loginPage(model, false, h),
        LoginForConnection: () => loginPage(model, true, h),
        Account: () => accountView(model, h),
        Wardrobe: () => wardrobePage(model, h),
        AddPieces: () => addPiecesPage(model, h),
        Review: () => reviewPage(model, h),
        Piece: () => piecePage(model, h),
        NotFound: () => notFoundView(locale, h),
      }),
      h.footer(styled(h, footer()), [
        h.span([], ['Styld']),
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
      model.telemetry.prompting ? consentPrompt(locale, h) : h.empty,
    ]),
  }
}
