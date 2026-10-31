import { catalogVersion } from '@styld/i18n'
import { modifyFields } from 'foldkit/struct'
import { init, Session } from '../src/App.ts'

/** Ana, signed in with a verified address. */
const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }

/** The app opened at a path in English, with Ana signed in: a page's scene starts here and sets its own model. */
export const signedInAt = (pathname: string) =>
  modifyFields(
    init({
      locale: 'en',
      catalogVersion,
      timeZone: 'UTC',
      referenceTime: 0,
      pathname,
      origin: 'https://styld.test',
      telemetryConsent: 'denied',
    }).model,
    { session: () => Session.SignedIn({ claims }) },
  )
