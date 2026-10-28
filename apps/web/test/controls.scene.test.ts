import { catalogVersion } from '@styld/i18n'
import { expect, given, label, role, scene, selector, submit, within } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { test } from 'vitest'
import { AuthState, LocaleSave, init, update } from '../src/App.ts'
import { view } from '../src/View.ts'

const page = (pathname: string) =>
  init({ locale: 'en', catalogVersion, timeZone: 'UTC', referenceTime: 0, pathname, telemetryConsent: 'denied' }).model

test('a pending sign-in keeps its focusable button and ignores another submission', () => {
  const signingIn = modifyFields(page('/login'), { auth: () => AuthState.SigningIn() })
  const pendingButton = role('button', { name: 'Signing in...' })
  scene(
    { update, view },
    given(signingIn),
    expect(pendingButton).toBeDisabled(),
    expect(pendingButton).toHaveAttr('aria-disabled', 'true'),
    expect(pendingButton).not.toHaveAttr('disabled'),
    // The loader is hidden from assistive technology, so the button's name stays its label.
    expect(within(pendingButton, selector('svg[data-loader]'))).toHaveAttr('aria-hidden', 'true'),
    // Enter still submits through an aria-disabled button; update starts no second sign-in.
    submit(role('form')),
    expect(pendingButton).toExist(),
  )
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
