import { Command, click, expect, given, role, scene } from 'foldkit/scene'
import { test } from 'vitest'
import { Message, update } from '../src/App.ts'
import { ReplaceInternal } from '../src/Navigation.ts'
import { view } from '../src/View.ts'
import { at, withPieces } from './AppFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const flats = pieceFixture('flats', {
  name: 'Blue flats',
  type: 'flats',
  colours: ['blue'],
  brand: 'COS',
  season: 'cold',
  occasions: ['smart'],
})
const dress = pieceFixture('dress', { name: 'Red dress', type: 'dresses', colours: ['red'] })

test('a reloaded wardrobe restores every filter and the piece link carries the same return context', () => {
  const path = '/wardrobe?group=shoes&type=flats&colours=blue&season=cold&occasion=smart&brand=COS'
  scene(
    { update, view },
    given(withPieces(at(path, { signedIn: true }), [flats, dress])),
    expect(role('button', { name: 'Shoes 1' })).toHaveAttr('aria-pressed', 'true'),
    expect(role('button', { name: 'Low shoes 1' })).toHaveAttr('aria-pressed', 'true'),
    expect(role('button', { name: 'Filters 4' })).toExist(),
    expect(role('link', { name: 'Red dress' })).not.toExist(),
    expect(role('link', { name: 'Blue flats' })).toHaveAttr(
      'href',
      `/wardrobe/${flats.id}?from=${encodeURIComponent(path + '#piece-' + flats.id)}`,
    ),
  )
})

test('choosing a category replaces the current address rather than adding a Back step', () => {
  scene(
    { update, view },
    given(withPieces(at('/wardrobe', { signedIn: true }), [flats, dress])),
    click(role('button', { name: 'Shoes 1' })),
    Command.expectExact(ReplaceInternal({ href: '/wardrobe?group=shoes' })),
    Command.resolve(ReplaceInternal, Message.CompletedNavigateInternal()),
    expect(role('link', { name: 'Red dress' })).not.toExist(),
  )
})

test('piece and review return links use their expected parent and reject external or unrelated destinations', () => {
  for (const from of ['https://evil.invalid', '//evil.invalid', '/account']) {
    scene(
      { update, view },
      given(at(`/wardrobe/${flats.id}?from=${encodeURIComponent(from)}`, { signedIn: true })),
      expect(role('link', { name: 'Back to wardrobe' })).toHaveAttr('href', '/wardrobe'),
    )
  }
  scene(
    { update, view },
    given(at('/wardrobe/review?from=%2Fgallery%2Fph_test', { signedIn: true })),
    expect(role('link', { name: 'Back' })).toHaveAttr('href', '/gallery/ph_test'),
  )
})
