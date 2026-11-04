import { PublicPiecePage, PublicProfile } from '@styld/protocol'
import { Schema } from 'effect'
import { click, Command, expect, given, role, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { type Model, update } from '../src/App.ts'
import { Message as ShareMessage, ShareLink } from '../src/page/Share.ts'
import type { ShownData } from '../src/page/Visit.ts'
import { shownAs } from './VisitFixtures.ts'
import { view } from '../src/View.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage } from './AppFixtures.ts'

// What a visitor does on a public profile or piece besides reading it: go back, share it, and edit one's own.

const ana = { handle: 'ana.novak', name: 'Ana Novak', tone: 'sage' }
const scarf = { id: `pc_${'scarf'.padEnd(22, 'x')}`, name: 'Grey scarf', type: 'bags' }
const profileOf = (yours: boolean) =>
  Schema.decodeUnknownSync(PublicProfile)({ ...ana, city: null, bio: null, boards: [], looks: [], yours })
const scarfPage = (yours: boolean) =>
  Schema.decodeUnknownSync(PublicPiecePage)({ piece: { ...scarf, colours: [] }, by: ana, yours })
const showing = (model: Model, shown: ShownData): Model =>
  withPage(model, lenses.visit, (visit) => modifyFields(visit, { shown: () => shown }))

describe('a public page’s head bar and Share', () => {
  test('a profile goes back Home and shares its link; a share sheet says the rest itself', () => {
    scene(
      { update, view },
      given(showing(at('/@ana.novak', { signedIn: false }), shownAs.Person({ profile: profileOf(false) }))),
      expect(role('link', { name: 'Back' })).toHaveAttr('href', '/'),
      click(role('button', { name: 'Share' })),
      Command.resolve(
        ShareLink({ path: '/@ana.novak', title: 'Ana Novak' }),
        ShareMessage.SucceededShareLink({ copied: false }),
      ),
      expect(role('status')).not.toExist(),
    )
  })

  test('a piece goes back to whose it is, and Share copies its link where there is no share sheet', () => {
    const share = ShareLink({ path: `/pieces/${scarf.id}`, title: 'Grey scarf' })
    scene(
      { update, view },
      given(showing(at(`/pieces/${scarf.id}`, { signedIn: false }), shownAs.Piece({ page: scarfPage(false) }))),
      expect(role('link', { name: 'Back' })).toHaveAttr('href', '/@ana.novak'),
      click(role('button', { name: 'Share' })),
      Command.resolve(share, ShareMessage.SucceededShareLink({ copied: true })),
      expect(role('status')).toHaveText('Link copied'),
      click(role('button', { name: 'Share' })),
      Command.resolve(share, ShareMessage.FailedShareLink()),
      expect(role('alert')).toHaveText("Couldn't copy the link"),
    )
  })

  test('one’s own profile offers Edit profile and Share, with nobody to follow or report, and Back to Account', () => {
    scene(
      { update, view },
      given(showing(at('/@ana.novak', { signedIn: true }), shownAs.Person({ profile: profileOf(true) }))),
      expect(role('link', { name: 'Edit profile' })).toHaveAttr('href', '/profile'),
      expect(role('button', { name: 'Share' })).toExist(),
      expect(role('link', { name: 'Back' })).toHaveAttr('href', '/account'),
      expect(role('button', { name: 'Follow' })).toBeAbsent(),
      expect(role('button', { name: 'Report profile' })).toBeAbsent(),
    )
  })
})
