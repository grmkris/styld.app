import type { AccountClaims } from '@styld/auth/config'
import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { AuthState, Message, type Model } from './App.ts'
import { primaryAction } from './Actions.styles.ts'
import { passwordFormId } from './PasswordForm.ts'
import { styled } from './Styled.ts'
import { accountDetails, authForm, authInput, authPage, detailValue, formError, submit } from './ViewAccount.styles.ts'

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
