import { Option } from 'effect'
import { Command, click, expect, given, label, role, scene, selector, submit, text, type, within } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { LocaleSave, Message, Session, SignOut, update } from '../src/App.ts'
import { Navigate } from '../src/Navigation.ts'
import {
  type Code,
  Message as LoginMessage,
  RequestCode,
  ResendCode,
  Step,
  VerifyCode,
  WaitForCodeExpiry,
  WaitToResend,
} from '../src/page/Login.ts'
import { CopyServerUrl, DeleteAccount, Message as AccountMessage } from '../src/page/Account.ts'
import { AppRoute } from '../src/route.ts'
import { view } from '../src/View.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage } from './AppFixtures.ts'

const page = (path: string) => at(path, { signedIn: false })

const claims = { accountId: 'acc_1', displayName: 'ana', email: 'ana@example.com', emailVerified: true }

const sent = { flowId: 'flow_1', requestId: 'req_1', proofId: 'proof_1', keyId: 'key_1' }
const resent = { flowId: 'flow_1', requestId: 'req_2', proofId: 'proof_2', keyId: 'key_1' }

const awaitingCode = (pathname: string, code: Partial<Code> = {}) =>
  withPage(page(pathname), lenses.login, (login) =>
    modifyFields(login, {
      email: () => 'ana@example.com',
      step: () =>
        Step.EnterCode({ code: { sent, use: 'open', rejections: 0, resent: false, canResend: false, ...code } }),
    }),
  )

const codeField = label('Enter verification code')
const verifyButton = role('button', { name: 'Verify code' })
const resendButton = role('button', { name: 'Resend code' })

describe('email code sign-in', () => {
  test('a pending code request keeps its focusable button and ignores another submission', () => {
    const sending = withPage(page('/login'), lenses.login, (login) =>
      modifyFields(login, { email: () => 'ana@example.com', step: () => Step.SendingCode() }),
    )
    const pendingButton = role('button', { name: 'Sending code...' })
    scene(
      { update, view },
      given(sending),
      expect(pendingButton).toBeDisabled(),
      expect(pendingButton).toHaveAttr('aria-disabled', 'true'),
      expect(pendingButton).not.toHaveAttr('disabled'),
      // The loader is hidden from assistive technology, so the button's name stays its label.
      expect(within(pendingButton, selector('svg[data-loader]'))).toHaveAttr('aria-hidden', 'true'),
      // Enter still submits through an aria-disabled button; update requests no second code.
      submit(role('form')),
      expect(pendingButton).toExist(),
    )
  })

  test('an email that is not an address is refused before any code is sent', () => {
    scene(
      { update, view },
      given(page('/login')),
      type(label('Email'), 'ana.example.com'),
      submit(role('form')),
      expect(role('alert')).toHaveText('Enter an email address like ana@example.com.'),
      expect(label('Email')).toHaveAttr('aria-invalid', 'true'),
    )
  })

  test('a person signs in with the code from their email and lands on Home', () => {
    scene(
      { update, view },
      given(page('/login')),
      expect(
        text(
          "Enter your email and we'll send you a six-digit code. We'll create an account if you don't have one yet.",
        ),
      ).toExist(),
      type(label('Email'), '  ana@example.com '),
      submit(role('form')),
      Command.expectExact(RequestCode({ email: 'ana@example.com', flowId: Option.none() })),
      Command.resolve(RequestCode, LoginMessage.SucceededRequestCode({ sent })),
      Command.expectExact(WaitToResend({ requestId: 'req_1' }), WaitForCodeExpiry({ requestId: 'req_1' })),
      expect(role('heading', { name: 'Check your email' })).toExist(),
      expect(selector('strong')).toHaveText('ana@example.com'),
      expect(codeField).toHaveAttr('autocomplete', 'one-time-code'),
      // Scenes settle every Command before moving on; the lifetime settles as an older code's.
      Command.resolveAll(
        [WaitToResend, LoginMessage.ElapsedResendPause({ requestId: 'req_1' })],
        [WaitForCodeExpiry, LoginMessage.ElapsedCodeLifetime({ requestId: 'req_0' })],
      ),
    )
    scene(
      { update, view },
      given(awaitingCode('/login')),
      submit(selector('#email-code')),
      Command.expectExact(VerifyCode({ email: 'ana@example.com', sent })),
      Command.resolve(VerifyCode, LoginMessage.SucceededVerifyCode({ claims })),
      Command.expectExact(Navigate({ href: '/' })),
      Command.resolve(Navigate({ href: '/' }), Message.CompletedNavigate()),
      expect(role('link', { name: 'Account' })).toHaveAttr('href', '/account'),
    )
  })

  test('a wrong code keeps the person on the code step, and the third one uses the code up', () => {
    const wrongTry = [
      submit(selector('#email-code')),
      Command.resolve(VerifyCode, LoginMessage.FailedVerifyCode({ problem: 'wrongCode' })),
    ] as const
    scene(
      { update, view },
      given(awaitingCode('/login')),
      ...wrongTry,
      expect(role('alert')).toHaveText("That code isn't right. Check the email and try again."),
      expect(codeField).toHaveAttr('aria-describedby', 'login-problem'),
      ...wrongTry,
      expect(verifyButton).toBeEnabled(),
      ...wrongTry,
      expect(role('alert')).toHaveText('Too many wrong codes. Ask for a new one.'),
      expect(verifyButton).toBeDisabled(),
      submit(selector('#email-code')),
      Command.expectNone(),
    )
  })

  test('resending waits out the pause, is announced, and another email starts over with the address kept', () => {
    scene(
      { update, view },
      given(awaitingCode('/login')),
      expect(resendButton).toBeDisabled(),
      expect(resendButton).toHaveAttr('aria-describedby', 'login-resend-hint'),
      expect(selector('#login-resend-hint')).toHaveText('You can ask for a new code 30 seconds after the last one.'),
    )
    scene(
      { update, view },
      given(awaitingCode('/login', { canResend: true })),
      click(resendButton),
      Command.expectExact(ResendCode({ email: 'ana@example.com', flowId: 'flow_1' })),
      Command.resolve(ResendCode, LoginMessage.SucceededResendCode({ sent: resent })),
      Command.resolveAll(
        [WaitToResend, LoginMessage.ElapsedResendPause({ requestId: 'req_2' })],
        [WaitForCodeExpiry, LoginMessage.ElapsedCodeLifetime({ requestId: 'req_2' })],
      ),
      expect(role('alert')).toHaveText('This code has expired. Ask for a new one.'),
      expect(verifyButton).toBeDisabled(),
      expect(resendButton).toBeEnabled(),
      click(role('button', { name: 'Use a different email' })),
      expect(role('heading', { name: 'Sign in to Styld' })).toExist(),
      expect(label('Email')).toHaveValue('ana@example.com'),
    )
  })

  test('signing in from Follow on a profile comes back to the profile', () => {
    const fromProfile = modifyFields(awaitingCode('/login'), {
      route: () => AppRoute.Login({ next: Option.some('/@nika.kovac#follow'), problem: Option.none() }),
    })
    scene(
      { update, view },
      given(fromProfile),
      submit(selector('#email-code')),
      Command.resolve(VerifyCode, LoginMessage.SucceededVerifyCode({ claims })),
      Command.expectExact(Navigate({ href: '/@nika.kovac#follow' })),
      Command.resolve(Navigate({ href: '/@nika.kovac#follow' }), Message.CompletedNavigate()),
      expect(role('link', { name: 'Account' })).toHaveAttr('href', '/account'),
    )
  })

  test('signing in for an assistant returns to its pending authorization', () => {
    scene(
      { update, view },
      given(awaitingCode('/login/connect')),
      expect(text('Sign in to connect Styld to your assistant.')).toExist(),
      submit(selector('#email-code')),
      Command.resolve(VerifyCode, LoginMessage.SucceededVerifyCode({ claims })),
      Command.expectExact(Navigate({ href: '/oauth/mcp/authorize' })),
      Command.resolve(Navigate({ href: '/oauth/mcp/authorize' }), Message.CompletedNavigate()),
    )
  })
})

const signedIn = () => modifyFields(page('/account'), { session: () => Session.SignedIn({ claims }) })

describe('account', () => {
  test('a signed-in person sees who they are and signing out sends them to sign in', () => {
    scene(
      { update, view },
      given(signedIn()),
      expect(role('heading', { name: 'Account' })).toExist(),
      expect(text('ana@example.com')).toExist(),
      click(role('button', { name: 'Sign out' })),
      expect(role('button', { name: 'Sign out' })).toBeDisabled(),
      Command.expectExact(SignOut),
      Command.resolve(SignOut, Message.SucceededSignOut()),
      Command.expectExact(Navigate({ href: '/login' })),
      Command.resolve(Navigate({ href: '/login' }), Message.CompletedNavigate()),
    )
  })

  test('shows the address assistants connect to and copies it', () => {
    scene(
      { update, view },
      given(signedIn()),
      expect(role('heading', { name: 'Use Styld in ChatGPT or Claude' })).toExist(),
      expect(selector('#server-url')).toHaveText('https://styld.test/mcp'),
      click(role('button', { name: 'Copy' })),
      Command.expectExact(CopyServerUrl({ url: 'https://styld.test/mcp' })),
      Command.resolve(CopyServerUrl, AccountMessage.SucceededCopyServerUrl()),
      expect(role('status')).toHaveText('Copied'),
    )
    scene(
      { update, view },
      given(signedIn()),
      click(role('button', { name: 'Copy' })),
      Command.resolve(CopyServerUrl, AccountMessage.FailedCopyServerUrl()),
      expect(role('alert')).toHaveText('Copy failed. Select the text and copy it manually.'),
    )
  })

  test('deleting the account asks first, can be kept, and starts over on the home page when done', () => {
    scene(
      { update, view },
      given(signedIn()),
      click(role('button', { name: 'Delete account' })),
      expect(role('heading', { name: 'Delete your account?' })).toExist(),
      click(role('button', { name: 'Cancel' })),
      expect(role('heading', { name: 'Delete your account?' })).not.toExist(),
      click(role('button', { name: 'Delete account' })),
      click(role('button', { name: 'Delete my account' })),
      expect(role('button', { name: 'Delete my account' })).toBeDisabled(),
      Command.expectExact(DeleteAccount),
      Command.resolve(DeleteAccount, AccountMessage.FailedDeleteAccount()),
      expect(role('alert')).toHaveText("Styld couldn't delete your account just now. Try again in a moment."),
      click(role('button', { name: 'Delete my account' })),
      Command.resolve(DeleteAccount, AccountMessage.SucceededDeleteAccount()),
      Command.expectExact(Navigate({ href: '/' })),
      Command.resolve(Navigate({ href: '/' }), Message.CompletedNavigate()),
    )
  })
})

test('a failed language change describes the picker with its error', () => {
  const failed = modifyFields(page('/'), { localeSave: () => LocaleSave.Failed() })
  scene(
    { update, view },
    given(failed),
    expect(label('Language')).toHaveAttr('aria-describedby', 'language-description'),
    expect(role('alert')).toHaveAttr('id', 'language-description'),
  )
})
