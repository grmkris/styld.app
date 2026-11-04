import { format } from '@styld/i18n'
import { expect, given, Mount, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { Message as LandingMessage, StartFilm } from '../src/page/Landing.ts'
import { landingWaits } from './LandingFixtures.ts'
import { privacyDocument, termsDocument } from '../src/page/LegalView.ts'
import { view } from '../src/View.ts'
import { at } from './AppFixtures.ts'

describe('the legal pages', () => {
  test('the footer links both, signed in or out', () => {
    for (const signedIn of [false, true])
      scene(
        { update, view },
        given(at('/', { signedIn })),
        expect(role('link', { name: 'Privacy' })).toHaveAttr('href', '/privacy'),
        expect(role('link', { name: 'Terms' })).toHaveAttr('href', '/terms'),
        // Signed out, Home is the landing, whose films, rail and chat wait for the browser.
        ...(signedIn
          ? []
          : [
              Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: false })),
              landingWaits,
              Mount.expectEnded(StartFilm),
            ]),
      )
  })

  for (const locale of ['en', 'sl'] as const)
    for (const [path, document] of [
      ['/privacy', privacyDocument],
      ['/terms', termsDocument],
    ] as const)
      test(`${path} in ${locale} shows its title, date, every section and the address for questions`, () => {
        scene(
          { update, view },
          given(at(path, { signedIn: false, locale })),
          expect(role('heading', { level: 1, name: format(locale, document.title, {}) })).toExist(),
          expect(text(format(locale, 'legal.updated', {}))).toExist(),
          ...document.sections.flatMap((section) => [
            expect(role('heading', { level: 2, name: format(locale, section.heading, {}) })).toExist(),
            ...section.paragraphs.map((paragraph) => expect(text(format(locale, paragraph, {}))).toExist()),
          ]),
          expect(role('link', { name: document.contact })).toHaveAttr('href', `mailto:${document.contact}`),
        )
      })
})
