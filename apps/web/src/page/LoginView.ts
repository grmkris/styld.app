import { format, type Locale, type MessageKey } from '@styld/i18n'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { googleIcon, loader } from '../Icon.ts'
import { styled } from '../Styled.ts'
import {
  canResend,
  type Code,
  codeFormId,
  isCompleteCode,
  Message as LoginMessage,
  type Model,
  type Problem,
  Step,
} from './Login.ts'
import { fieldLabel, formError, textField } from '../Fields.styles.ts'
import {
  authForm,
  authPage,
  emailShown,
  lede,
  linkButton,
  loginActions,
  notice,
  orRule,
  submit,
} from './LoginView.styles.ts'

const problemKey: { readonly [Key in Problem]: MessageKey } = {
  invalidEmail: 'auth.problem.invalidEmail',
  wrongCode: 'auth.problem.wrongCode',
  expired: 'auth.problem.expired',
  tooManyAttempts: 'auth.problem.tooManyAttempts',
  tooManyRequests: 'auth.problem.tooManyRequests',
  unavailable: 'auth.problem.unavailable',
  google: 'auth.problem.google',
}

/** What the page was told: by itself, else by the address Google's refusal came back to. */
const problemOf = (model: Model, googleRefused: boolean): Option.Option<Problem> =>
  Option.orElse(model.problem, () => (googleRefused ? Option.some<Problem>('google') : Option.none()))

const problemView = (model: Model, locale: Locale, h: HtmlBuilder<LoginMessage>): Html =>
  Option.match(model.problem, {
    onNone: () => h.empty,
    onSome: (problem) =>
      h.p(
        [h.Id('login-problem'), h.Role('alert'), ...styled(h, formError())],
        [format(locale, problemKey[problem], {})],
      ),
  })

interface EmailInputs {
  readonly sending: boolean
  readonly forConnection: boolean
  readonly locale: Locale
}

const emailStep = (model: Model, { sending, forConnection, locale }: EmailInputs, h: HtmlBuilder<LoginMessage>): Html =>
  h.div(styled(h, authForm()), [
    emailForm(model, sending, locale, h),
    googleEntry(model, sending, forConnection, locale, h),
  ])

/** Continue with Google, under the code (Gallery `login.html`): the page leaves for Google's sign-in and comes back
 * signed in. */
const googleEntry = (
  model: Model,
  sending: boolean,
  forConnection: boolean,
  locale: Locale,
  h: HtmlBuilder<LoginMessage>,
): Html =>
  h.div(styled(h, authForm()), [
    h.p([...styled(h, orRule()), h.AriaHidden(true)], [format(locale, 'auth.or', {})]),
    actionButton(
      {
        label: format(locale, 'auth.continueWithGoogle', {}),
        style: secondaryAction(),
        onClick: LoginMessage.ClickedContinueWithGoogle({ forConnection }),
        isDisabled: sending || model.goingToGoogle,
        leading: model.goingToGoogle ? loader(h) : googleIcon(h),
      },
      h,
    ),
  ])

const emailForm = (model: Model, sending: boolean, locale: Locale, h: HtmlBuilder<LoginMessage>): Html =>
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
        ...styled(h, textField()),
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
          ...styled(h, textField()),
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
          h.OnInput((value) => LoginMessage.UpdatedCode({ isComplete: isCompleteCode(value) })),
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
          isDisabled: busy || !canResend(code),
          leading: resending ? loader(h) : h.empty,
          ...(canResend(code) ? {} : { describedBy: resendHintId }),
        },
        h,
      ),
      canResend(code)
        ? h.empty
        : h.p(
            [h.Id(resendHintId), ...styled(h, notice())],
            [format(locale, 'auth.resendIn', { seconds: code.resendIn })],
          ),
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
  { readonly forConnection: boolean; readonly googleRefused: boolean; readonly locale: Locale }
>((stored, { forConnection, googleRefused, locale }, h) => {
  const model = { ...stored, problem: problemOf(stored, googleRefused) }
  return h.main(
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
        EnterEmail: () => emailStep(model, { sending: false, forConnection, locale }, h),
        SendingCode: () => emailStep(model, { sending: true, forConnection, locale }, h),
        EnterCode: (step) => codeStep(model, step, step.code, locale, h),
        VerifyingCode: (step) => codeStep(model, step, step.code, locale, h),
        ResendingCode: (step) => codeStep(model, step, step.code, locale, h),
      }),
    ],
  )
})
