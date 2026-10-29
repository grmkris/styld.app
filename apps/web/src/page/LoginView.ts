import { format, type Locale, type MessageKey } from '@styld/i18n'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { loader } from '../Icon.ts'
import { styled } from '../Styled.ts'
import { type Code, codeFormId, Message as LoginMessage, type Model, type Problem, Step } from './Login.ts'
import {
  authForm,
  authInput,
  authPage,
  emailShown,
  fieldLabel,
  formError,
  lede,
  linkButton,
  loginActions,
  notice,
  submit,
} from './LoginView.styles.ts'

const problemKey: { readonly [Key in Problem]: MessageKey } = {
  invalidEmail: 'auth.problem.invalidEmail',
  wrongCode: 'auth.problem.wrongCode',
  expired: 'auth.problem.expired',
  tooManyAttempts: 'auth.problem.tooManyAttempts',
  tooManyRequests: 'auth.problem.tooManyRequests',
  unavailable: 'auth.problem.unavailable',
}

const problemView = (model: Model, locale: Locale, h: HtmlBuilder<LoginMessage>): Html =>
  Option.match(model.problem, {
    onNone: () => h.empty,
    onSome: (problem) =>
      h.p(
        [h.Id('login-problem'), h.Role('alert'), ...styled(h, formError())],
        [format(locale, problemKey[problem], {})],
      ),
  })

const emailStep = (model: Model, sending: boolean, locale: Locale, h: HtmlBuilder<LoginMessage>): Html =>
  h.form(
    [
      ...styled(h, authForm()),
      h.OnSubmit(LoginMessage.SubmittedEmail()),
      h.AriaBusy(sending),
      h.Attribute('novalidate', ''),
    ],
    [
      h.p(styled(h, lede()), [
        format(locale, 'auth.signInDescription', {}),
        ' ',
        format(locale, 'auth.autoCreateNote', {}),
      ]),
      h.label([h.For('login-email'), ...styled(h, fieldLabel())], [format(locale, 'auth.email', {})]),
      h.input([
        h.Id('login-email'),
        ...styled(h, authInput()),
        h.Name('email'),
        h.Type('email'),
        h.Autocomplete('email'),
        h.Placeholder('ana@example.com'),
        h.Value(model.email),
        h.Readonly(sending),
        h.AriaInvalid(Option.isSome(model.problem)),
        ...(Option.isSome(model.problem) ? [h.AriaDescribedBy('login-problem')] : []),
        h.OnInput((value) => LoginMessage.UpdatedEmail({ value })),
      ]),
      problemView(model, locale, h),
      actionButton(
        {
          label: format(locale, sending ? 'auth.sendingCode' : 'auth.sendCode', {}),
          style: cx(primaryAction(), submit()),
          type: 'submit',
          isDisabled: sending,
          leading: sending ? loader(h) : h.empty,
        },
        h,
      ),
    ],
  )

const resendHintId = 'login-resend-hint'

const codeStep = (model: Model, step: Step, code: Code, locale: Locale, h: HtmlBuilder<LoginMessage>): Html => {
  const verifying = Step.guards.VerifyingCode(step)
  const resending = Step.guards.ResendingCode(step)
  const busy = verifying || resending
  return h.div(styled(h, authForm()), [
    h.p(styled(h, lede()), [
      format(locale, 'auth.codeSentToEmail', {}),
      ' ',
      h.strong(styled(h, emailShown()), [model.email]),
    ]),
    h.form(
      [h.Id(codeFormId), ...styled(h, authForm()), h.OnSubmit(LoginMessage.SubmittedCode()), h.AriaBusy(busy)],
      [
        h.label([h.For('login-code'), ...styled(h, fieldLabel())], [format(locale, 'auth.enterVerificationCode', {})]),
        h.input([
          h.Id('login-code'),
          ...styled(h, authInput()),
          h.Name('code'),
          h.Type('text'),
          h.InputMode('numeric'),
          h.Autocomplete('one-time-code'),
          h.Pattern('[0-9]{6}'),
          h.Maxlength(6),
          h.Required(true),
          h.Readonly(busy || code.use !== 'open'),
          h.AriaInvalid(Option.isSome(model.problem)),
          ...(Option.isSome(model.problem) ? [h.AriaDescribedBy('login-problem')] : []),
        ]),
        problemView(model, locale, h),
        code.resent && Step.guards.EnterCode(step)
          ? h.p([h.Role('status'), ...styled(h, notice())], [format(locale, 'auth.newCodeSent', {})])
          : h.empty,
        actionButton(
          {
            label: format(locale, verifying ? 'auth.verifying' : 'auth.verifyCode', {}),
            style: cx(primaryAction(), submit()),
            type: 'submit',
            isDisabled: busy || code.use !== 'open',
            leading: verifying ? loader(h) : h.empty,
          },
          h,
        ),
      ],
    ),
    h.div(styled(h, loginActions()), [
      actionButton(
        {
          label: format(locale, 'auth.resendCode', {}),
          style: secondaryAction(),
          onClick: LoginMessage.ClickedResendCode(),
          isDisabled: busy || !code.canResend,
          leading: resending ? loader(h) : h.empty,
          ...(code.canResend ? {} : { describedBy: resendHintId }),
        },
        h,
      ),
      code.canResend
        ? h.empty
        : h.p([h.Id(resendHintId), ...styled(h, notice())], [format(locale, 'auth.resendSoon', {})]),
      actionButton(
        {
          label: format(locale, 'auth.useDifferentEmail', {}),
          style: linkButton(),
          onClick: LoginMessage.ClickedUseDifferentEmail(),
          isDisabled: busy,
        },
        h,
      ),
    ]),
  ])
}

/** Sign in or create an account with a six-digit email code (Gallery `login.html`). */
export const view = Submodel.defineView<
  Model,
  LoginMessage,
  { readonly forConnection: boolean; readonly locale: Locale }
>((model, { forConnection, locale }, h) =>
  h.main(
    [h.Id('main'), ...styled(h, authPage())],
    [
      forConnection ? h.p(styled(h, lede()), [format(locale, 'auth.connectAssistant', {})]) : h.empty,
      h.h1(
        [],
        [
          format(
            locale,
            Step.guards.EnterEmail(model.step) || Step.guards.SendingCode(model.step)
              ? 'auth.signInTitle'
              : 'auth.checkYourEmail',
            {},
          ),
        ],
      ),
      Step.match(model.step, {
        EnterEmail: () => emailStep(model, false, locale, h),
        SendingCode: () => emailStep(model, true, locale, h),
        EnterCode: (step) => codeStep(model, step, step.code, locale, h),
        VerifyingCode: (step) => codeStep(model, step, step.code, locale, h),
        ResendingCode: (step) => codeStep(model, step, step.code, locale, h),
      }),
    ],
  ),
)
