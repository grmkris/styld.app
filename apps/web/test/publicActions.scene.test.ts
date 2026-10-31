import { PublicPiecePage, PublicProfile } from '@styld/protocol'
import { Schema } from 'effect'
import { click, Command, expect, given, role, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { type Model, update } from '../src/App.ts'
import { Message as VisitMessage, ShareLink, Shown } from '../src/page/Visit.ts'
import { view } from '../src/View.ts'
import { signedInAt } from './AppFixtures.ts'
import { pageAt } from './WardrobeFixtures.ts'

// What a visitor does on a public profile or piece besides reading it: go back, share it, and edit one's own.

const ana = { handle: 'ana.novak', name: 'Ana Novak', tone: 'sage' }
const scarf = { id: `pc_${'scarf'.padEnd(22, 'x')}`, name: 'Grey scarf', category: 'accessory', subcategory: null }
const profileOf = (yours: boolean) =>
  Schema.decodeUnknownSync(PublicProfile)({ ...ana, city: null, bio: null, boards: [], looks: [], pieces: null, yours })
const scarfPage = (yours: boolean) =>
  Schema.decodeUnknownSync(PublicPiecePage)({ piece: { ...scarf, colours: [] }, by: ana, yours })
const showing = (model: Model, shown: Shown): Model =>
  modifyFields(model, { visit: (visit) => modifyFields(visit, { shown: () => shown }) })

describe('a public page’s head bar and Share', () => {
  test('a profile goes back to Explore and shares its link; a share sheet says the rest itself', () => {
    scene(
      { update, view },
      given(showing(pageAt('/@ana.novak'), Shown.Person({ profile: profileOf(false) }))),
      expect(role('link', { name: 'Back' })).toHaveAttr('href', '/explore'),
      click(role('button', { name: 'Share' })),
      Command.resolve(
        ShareLink({ url: 'https://styld.test/@ana.novak', title: 'Ana Novak' }),
        VisitMessage.SucceededShareLink({ copied: false }),
      ),
      expect(role('status')).not.toExist(),
    )
  })

  test('a piece goes back to whose it is, and Share copies its link where there is no share sheet', () => {
    const share = ShareLink({ url: `https://styld.test/pieces/${scarf.id}`, title: 'Grey scarf' })
    scene(
      { update, view },
      given(showing(pageAt(`/pieces/${scarf.id}`), Shown.Piece({ page: scarfPage(false) }))),
      expect(role('link', { name: 'Back' })).toHaveAttr('href', '/@ana.novak'),
      click(role('button', { name: 'Share' })),
      Command.resolve(share, VisitMessage.SucceededShareLink({ copied: true })),
      expect(role('status')).toHaveText('Link copied'),
      click(role('button', { name: 'Share' })),
      Command.resolve(share, VisitMessage.FailedShareLink()),
      expect(role('alert')).toHaveText("Couldn't copy the link"),
    )
  })

  test('one’s own profile offers Edit profile and Share, with nobody to follow or report, and Back to Account', () => {
    scene(
      { update, view },
      given(showing(signedInAt('/@ana.novak'), Shown.Person({ profile: profileOf(true) }))),
      expect(role('link', { name: 'Edit profile' })).toHaveAttr('href', '/profile'),
      expect(role('button', { name: 'Share' })).toExist(),
      expect(role('link', { name: 'Back' })).toHaveAttr('href', '/account'),
      expect(role('button', { name: 'Follow' })).toBeAbsent(),
      expect(role('button', { name: 'Report profile' })).toBeAbsent(),
    )
  })
})
