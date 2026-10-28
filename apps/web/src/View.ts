import { direction, format, type Locale } from '@styld/i18n'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { LocaleSave, Message, type Model } from './App.ts'
import { primaryAction, secondaryAction } from './Actions.styles.ts'
import { availableLocales } from './Locale.ts'
import { styled } from './Styled.ts'
import { accountView } from './ViewAccount.ts'
import { style } from './zyzz.config.ts'

const homePath = '/'
const loginPath = '/login'
const browseAnchor = '#inspiration'
const languages: ReadonlyArray<Readonly<{ locale: Locale; label: string }>> = [
  { locale: 'en', label: 'English' },
  { locale: 'sl', label: 'Slovenščina' },
  { locale: 'en-XA', label: 'English (expanded)' },
  { locale: 'ar-XB', label: 'English (RTL)' },
]

const site = style({
  maxInlineSize: '78rem',
  marginInline: 'auto',
  paddingInline: 'max(1.25rem, env(safe-area-inset-left), env(safe-area-inset-right))',
})
const masthead = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '1.5rem',
  paddingBlock: 'calc(1rem + env(safe-area-inset-top)) 1rem',
})
const brand = style({ display: 'inline-flex' })
const brandMark = style({ display: 'block' })
const picker = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '0.6rem',
  marginInlineStart: 'auto',
})
const pickerSelect = style({
  minBlockSize: '44px',
  maxInlineSize: '100%',
  padding: '0.45rem',
  backgroundColor: 'transparent !custom',
  color: 'inherit !custom',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'muted',
  borderRadius: 'control',
})
const pickerError = style({ flexBasis: '100%' })
const intro = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: '1.5rem',
  paddingBlock: 'clamp(3rem, 10vw, 8rem)',
})
const lead = style({ fontSize: '1.2rem', maxInlineSize: '45ch', color: 'muted' })
const inspiration = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  paddingBlock: '2rem 5rem',
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
  scrollMarginBlockStart: '2rem',
})
const emptyState = style({ paddingBlock: '2rem', color: 'muted' })
const footer = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '1rem',
  paddingBlock: '1.5rem calc(1.5rem + env(safe-area-inset-bottom))',
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
})
const footerLink = style({ marginInlineStart: 'auto', minBlockSize: '44px' })

const languagePicker = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  const pending = LocaleSave.guards.Saving(model.localeSave)
  return h.div(styled(h, picker()), [
    h.label([h.For('language')], [format(locale, 'auth.language', {})]),
    h.select(
      [
        h.Id('language'),
        ...styled(h, pickerSelect()),
        h.Value(locale),
        h.Disabled(pending),
        h.AriaBusy(pending),
        h.OnChange((value) => Message.SelectedLocale({ value })),
      ],
      languages
        .filter((language) => availableLocales.includes(language.locale))
        .map((language) => h.keyed('option')(language.locale, [h.Value(language.locale)], [language.label])),
    ),
    LocaleSave.guards.Failed(model.localeSave)
      ? h.p([h.Role('alert'), ...styled(h, pickerError())], [format(locale, 'common.error', {})])
      : h.empty,
  ])
}

const homeView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.main(
    [h.Id('main')],
    [
      h.section(styled(h, intro()), [
        h.h1([], [format(locale, 'landing.title', {})]),
        h.p(styled(h, lead()), [format(locale, 'landing.description', {})]),
        h.a([h.Href(browseAnchor), ...styled(h, primaryAction())], [format(locale, 'landing.browse', {})]),
        h.a([h.Href(loginPath), ...styled(h, secondaryAction())], [format(locale, 'auth.signInWithEmail', {})]),
      ]),
      h.section(
        [h.Id('inspiration'), ...styled(h, inspiration())],
        [
          h.h2([], [format(locale, 'landing.feedTitle', {})]),
          h.p([], [format(locale, 'landing.feedDescription', {})]),
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
              h.Width('112'),
              h.Height('53'),
              ...styled(h, brandMark()),
            ]),
          ],
        ),
        languagePicker(model, h),
      ]),
      isHome ? homeView(locale, h) : isLogin ? accountView(model, h) : notFoundView(locale, h),
      h.footer(styled(h, footer()), [
        h.span([], ['Styld']),
        h.a([h.Href('mailto:hello@styld.app'), ...styled(h, footerLink())], [format(locale, 'landing.contact', {})]),
      ]),
    ]),
  }
}
