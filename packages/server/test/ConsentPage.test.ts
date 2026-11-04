import { type OAuthServer, Schema as AuthSchema } from '@yielded/auth'
import { describe, expect, test } from 'vitest'
import { consentPage, consentStylesheet, consentStylesheetPath } from '../src/ConsentPage.ts'

// The page that lets an assistant in: Styld's words and look, the person by name and email (never an id), and
// Yielded's form kept exactly, under a policy that forbids scripts and inline styles.

const consent: OAuthServer.Consent = {
  clientName: 'ChatGPT',
  clientId: 'https://chatgpt.com/oauth/client.json',
  registered: false,
  subjectId: AuthSchema.SubjectId.make('qQs3BxM96VnPIdcApQoV5PxRc2R-dMrkaiicAjLpBw4'),
  resource: 'https://styld.app/mcp',
  scopes: ['styld'],
  redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
  action: '/oauth/mcp/authorize?flow=abc',
  loginPath: '/login/connect',
  csrf: 'csrf-token',
}

describe('the consent page', () => {
  test('names the person and the assistant, keeps the form and loads only its own stylesheet', () => {
    const page = consentPage(consent, { name: 'Kris <b>', email: 'kris@example.com' }, 'en')
    expect(page).toContain('Allow ChatGPT into your Styld?')
    expect(page).toContain('Kris &lt;b&gt;')
    expect(page).toContain('kris@example.com')
    expect(page).not.toContain(consent.subjectId)
    expect(page).toContain('action="/oauth/mcp/authorize?flow=abc"')
    expect(page).toContain('<input type="hidden" name="csrf" value="csrf-token">')
    expect(page).toContain('name="decision" value="approve"')
    expect(page).toContain('name="decision" value="deny"')
    expect(page).toContain('href="/login/connect"')
    expect(page).toContain(`href="${consentStylesheetPath}"`)
    expect(page).toContain('Client: chatgpt.com')
    expect(page).not.toMatch(/<script|style=|<style/u)
  })

  test('speaks Slovenian to a Slovenian reader, and warns when a local program asks', () => {
    const page = consentPage(
      { ...consent, redirectUri: 'http://127.0.0.1:3000/callback' },
      { name: 'Eva', email: undefined },
      'sl',
    )
    expect(page).toContain('<html lang="sl">')
    expect(page).toContain('Dovoli')
    expect(page).toContain('role="alert"')
  })

  test('styles with the Gallery colours in light and dark', () => {
    expect(consentStylesheet).toContain('light-dark(#f1eee7,#17120f)')
    expect(consentStylesheet).toContain('border-radius:999px')
  })
})
