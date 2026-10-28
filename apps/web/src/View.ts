import { Select } from '@foldkit/ui'
import { direction, format, type Locale } from '@styld/i18n'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { LocaleSave, Message, type Model } from './App.ts'
import { actionButton } from './ActionButton.ts'
import { primaryAction, secondaryAction } from './Actions.styles.ts'
import { availableLocales } from './Locale.ts'
import { styled } from './Styled.ts'
import { accountView } from './ViewAccount.ts'
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
  sectionNote,
  site,
  visuallyHidden,
} from './View.styles.ts'

const homePath = '/'
const loginPath = '/login'
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
          h.a([h.Href(loginPath), ...styled(h, secondaryAction())], [format(locale, 'auth.signInWithEmail', {})]),
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
      h.a([h.Href(homePath)], [format(locale, 'common.goHome', {})]),
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

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const { locale, pathname } = model.context
  const isHome = pathname === homePath
  const isLogin = pathname === loginPath || pathname === '/account'
  return {
    title:
      format(locale, isHome ? 'landing.title' : isLogin ? 'auth.signInTitle' : 'common.notFoundTitle', {}) + ' | Styld',
    lang: locale,
    dir: direction(locale) === 'rtl' ? 'Rtl' : 'Ltr',
    body: h.div(styled(h, site()), [
      h.header(styled(h, masthead()), [
        h.a(
          [h.Href(homePath), ...styled(h, brand()), h.AriaLabel('Styld')],
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
        languagePicker(model, h),
      ]),
      isHome ? homeView(locale, h) : isLogin ? accountView(model, h) : notFoundView(locale, h),
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
