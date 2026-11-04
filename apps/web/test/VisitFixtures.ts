import { type PublicPiecePage, PublicProfile } from '@styld/protocol'
import { Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { type Model, Session } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import { at, claims, withPage } from './AppFixtures.ts'
import { ShownData, VisitShown } from '../src/page/Visit.ts'

// A public profile and the app opened on a visitor page, shared by the visit scenes.

export const knit = {
  id: `pc_${'knit'.padEnd(22, 'x')}`,
  name: 'Navy knit',
  type: 'shortSleeveTops',
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

/** The app opened at a path by a visitor whose session has been read: signed out. */
export const opened = (pathname: string) =>
  modifyFields(at(pathname, { signedIn: false }), { session: () => Session.SignedOut() })

/** What a public page has read: a profile or a piece, still loading, not there, or not read. */
export const shownAs = {
  Person: (fields: { readonly profile: PublicProfile }) => ShownData.Success({ data: VisitShown.Person(fields) }),
  Piece: (fields: { readonly page: PublicPiecePage }) => ShownData.Success({ data: VisitShown.Piece(fields) }),
  Loading: (): ShownData => ShownData.Loading(),
  Missing: (): ShownData => ShownData.Failure({ error: 'NotFound' }),
  Failed: (): ShownData => ShownData.Failure({ error: 'Unavailable' }),
}

/** A public profile or piece showing `shown`. */
export const visiting = (pathname: string, shown: ShownData) =>
  withPage(opened(pathname), lenses.visit, (visit) => modifyFields(visit, { shown: () => shown }))
export const by = { handle: 'nika.kovac', name: 'Nika Kovač', tone: 'clay' }
export const signedIn = (model: Model): Model => modifyFields(model, { session: () => Session.SignedIn({ claims }) })
