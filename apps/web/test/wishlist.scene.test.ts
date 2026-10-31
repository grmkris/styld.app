import { catalogVersion } from '@styld/i18n'
import { PublicPiecePage, Wish } from '@styld/protocol'
import { Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { click, Command, expect, given, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { init, Session, update } from '../src/App.ts'
import { AddToWishlist, Message as PeopleMessage } from '../src/page/People.ts'
import { Shown } from '../src/page/Visit.ts'
import { ListWishes, RemoveWish, Message as WishlistMessage, WishesData } from '../src/page/Wishlist.ts'
import { view } from '../src/View.ts'

const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }
const knit = { id: `pc_${'knit'.padEnd(22, 'x')}`, name: 'Navy knit', category: 'top', subcategory: null, colours: [] }
const by = { handle: 'nika.kovac', name: 'Nika Kovač', tone: 'clay' }
const wish = (id: string, changes: object) =>
  Schema.decodeUnknownSync(Wish)({
    id: `ws_${id.padEnd(22, 'x')}`,
    name: 'Navy knit',
    category: 'top',
    piece: knit,
    by,
    createdAt: '2026-10-31T08:00:00.000Z',
    ...changes,
  })
const kept = wish('knit', {})
const gone = wish('coat', { name: 'Camel coat', category: 'outerwear', piece: null, by: null })

const signedIn = (pathname: string) =>
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
const wishlist = (wishes: WishesData) =>
  modifyFields(signedIn('/wardrobe/wishlist'), {
    wishlist: (current) => modifyFields(current, { wishes: () => wishes }),
  })

describe('the wishlist', () => {
  test('is a wardrobe tab showing each wish with whose it is, and what it was once the piece is gone', () => {
    scene(
      { update, view },
      given(wishlist(WishesData.Success({ data: [kept, gone] }))),
      expect(role('link', { name: 'Wishlist' })).toHaveAttr('aria-current', 'page'),
      expect(role('link', { name: 'Navy knit' })).toHaveAttr('href', `/pieces/${knit.id}`),
      expect(role('link', { name: /By Nika Kovač/ })).toHaveAttr('href', '/@nika.kovac'),
      expect(text('Camel coat · No longer shown')).toExist(),
    )
  })

  test('takes a wish off the list at once', () => {
    scene(
      { update, view },
      given(wishlist(WishesData.Success({ data: [kept] }))),
      click(role('button', { name: 'Remove' })),
      Command.resolve(RemoveWish({ wishId: kept.id }), WishlistMessage.CompletedRemoveWish()),
      expect(role('link', { name: 'Navy knit' })).toBeAbsent(),
      expect(role('heading', { name: 'Nothing on the list yet' })).toExist(),
    )
  })

  test('Got it takes the wish off and opens the ways to add the piece', () => {
    scene(
      { update, view },
      given(wishlist(WishesData.Success({ data: [kept] }))),
      expect(role('link', { name: 'Got it' })).toHaveAttr('href', '/wardrobe/add'),
      click(role('link', { name: 'Got it' })),
      Command.resolve(RemoveWish({ wishId: kept.id }), WishlistMessage.CompletedRemoveWish()),
      expect(role('link', { name: 'Navy knit' })).toBeAbsent(),
    )
  })

  test('a wishlist that cannot load offers to try again', () => {
    scene(
      { update, view },
      given(wishlist(AsyncData.Failure({ error: 'Unavailable' }))),
      expect(role('heading', { name: 'Your wishlist could not be loaded' })).toExist(),
      click(role('button', { name: 'Try again' })),
      Command.resolve(ListWishes, WishlistMessage.SucceededListWishes({ wishes: [kept] })),
      expect(role('link', { name: 'Navy knit' })).toExist(),
    )
  })

  test('saves someone’s public piece from its page, then links to the wishlist', () => {
    const page = Schema.decodeUnknownSync(PublicPiecePage)({ piece: knit, by })
    scene(
      { update, view },
      given(
        modifyFields(signedIn(`/pieces/${knit.id}`), {
          visit: (visit) => modifyFields(visit, { shown: () => Shown.Piece({ page }) }),
        }),
      ),
      click(role('button', { name: 'Save to wishlist' })),
      Command.resolve(AddToWishlist({ pieceId: knit.id }), PeopleMessage.SucceededWish()),
      expect(role('link', { name: 'Saved to your wishlist' })).toHaveAttr('href', '/wardrobe/wishlist'),
    )
  })
})
