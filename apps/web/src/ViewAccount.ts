import type { AccountClaims } from '@styld/auth/config'
import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { AuthState, Message, type Model } from './App.ts'
import { primaryAction } from './Actions.styles.ts'
import { passwordFormId } from './PasswordForm.ts'
import { styled } from './Styled.ts'
import { style } from './zyzz.config.ts'

const authPage = style({ maxInlineSize: '32rem', minBlockSize: '65svh', paddingBlock: 'clamp(3rem, 8vw, 6rem)' })
const authForm = style({ display: 'grid', gap: '0.65rem', marginBlockStart: '1.5rem' })
const authInput = style({
  inlineSize: '100%',
  minBlockSize: '48px',
  padding: '0.65rem 0.8rem',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rule',
  borderRadius: 'control',
  backgroundColor: 'field',
  color: 'ink',
  ':user-invalid': { borderColor: 'invalid' },
})
const submit = style({ justifySelf: 'start', marginBlockStart: '0.75rem' })
const formError = style({ color: 'error' })
const accountDetails = style({ display: 'grid', justifyItems: 'start', gap: '1.5rem', overflowWrap: 'anywhere' })
const detailValue = style({ margin: '0', marginBlockEnd: '1rem' })

const signedInView = (claims: AccountClaims, pending: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(styled(h, accountDetails()), [
    h.h1([], [format(locale, 'account.title', {})]),
    h.dl(
      [],
      [
        h.dt([], [format(locale, 'account.name', {})]),
        h.dd(styled(h, detailValue()), [claims.displayName]),
        h.dt([], [format(locale, 'account.email', {})]),
        h.dd(styled(h, detailValue()), [claims.email]),
      ],
    ),
    h.button(
      [h.Type('button'), ...styled(h, primaryAction()), h.Disabled(pending), h.OnClick(Message.RequestedSignOut())],
      [format(locale, 'auth.signOut', {})],
    ),
  ])

const signInForm = (pending: boolean, failed: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [],
    [
      h.h1([], [format(locale, 'auth.signInTitle', {})]),
      h.form(
        [h.Id(passwordFormId), ...styled(h, authForm()), h.OnSubmit(Message.SubmittedSignIn()), h.AriaBusy(pending)],
        [
          h.label([h.For('auth-email')], [format(locale, 'auth.email', {})]),
          h.input([
            h.Id('auth-email'),
            ...styled(h, authInput()),
            h.Name('email'),
            h.Type('email'),
            h.Autocomplete('username'),
            h.Required(true),
            h.Maxlength(320),
            h.Readonly(pending),
          ]),
          h.label([h.For('auth-password')], [format(locale, 'auth.password', {})]),
          h.input([
            h.Id('auth-password'),
            ...styled(h, authInput()),
            h.Name('password'),
            h.Type('password'),
            h.Autocomplete('current-password'),
            h.Required(true),
            h.Maxlength(65536),
            h.Readonly(pending),
          ]),
          failed
            ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'auth.signInError', {})])
            : h.empty,
          h.button(
            [h.Type('submit'), h.Disabled(pending), ...styled(h, cx(primaryAction(), submit()))],
            [format(locale, pending ? 'auth.signingIn' : 'auth.signInWithEmail', {})],
          ),
        ],
      ),
    ],
  )

export const accountView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  return h.main(
    [h.Id('main'), ...styled(h, authPage())],
    [
      AuthState.match(model.auth, {
        Checking: () => h.p([h.Role('status')], [format(locale, 'common.loading', {})]),
        SignedOut: ({ failed }) => signInForm(false, failed, locale, h),
        SigningIn: () => signInForm(true, false, locale, h),
        SignedIn: ({ claims }) => signedInView(claims, false, locale, h),
        SigningOut: ({ claims }) => signedInView(claims, true, locale, h),
        Unavailable: () =>
          h.section(
            [],
            [
              h.p([h.Role('alert')], [format(locale, 'common.error', {})]),
              h.button(
                [h.Type('button'), ...styled(h, primaryAction()), h.OnClick(Message.RequestedSession())],
                [format(locale, 'common.retry', {})],
              ),
            ],
          ),
      }),
    ],
  )
}
