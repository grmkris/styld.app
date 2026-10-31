import { catalogVersion } from '@styld/i18n'
import { PublicProfile } from '@styld/protocol'
import { Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { init, type Model, Session } from '../src/App.ts'
import type { Shown } from '../src/page/Visit.ts'

// A public profile and the app opened on a visitor page, shared by the visit scenes.

export const knit = {
  id: `pc_${'knit'.padEnd(22, 'x')}`,
  name: 'Navy knit',
  category: 'top',
  subcategory: null,
  colours: [],
}
export const nika = Schema.decodeUnknownSync(PublicProfile)({
  handle: 'nika.kovac',
  name: 'Nika Kovač',
  city: 'Maribor',
  bio: 'Red, black and one good coat.',
  tone: 'clay',
  boards: [
    {
      id: `bd_${'coats'.padEnd(22, 'x')}`,
      name: 'Coats',
      paper: 'paper',
      items: [],
      cover: [
        {
          _tag: 'PublicPiecePin',
          id: `pn_${'knit'.padEnd(22, 'x')}`,
          piece: knit,
          addedAt: '2026-10-30T08:00:00.000Z',
        },
      ],
      pinCount: 1,
      publishedAt: '2026-10-30T08:00:00.000Z',
    },
  ],
  looks: [],
  yours: false,
})

export const opened = (pathname: string) =>
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
    { session: () => Session.SignedOut() },
  )
export const visiting = (pathname: string, shown: Shown) =>
  modifyFields(opened(pathname), { visit: (visit) => modifyFields(visit, { shown: () => shown }) })
export const by = { handle: 'nika.kovac', name: 'Nika Kovač', tone: 'clay' }
export const suggested = { ...by, city: 'Maribor', bio: 'Red, black and one good coat.' }
const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }
export const signedIn = (model: Model): Model => ({ ...model, session: Session.SignedIn({ claims }) })
