import { Dialog } from '@foldkit/ui'
import { Command, Mount, click, expect, given, role, scene } from 'foldkit/scene'
import { test } from 'vitest'
import { update } from '../src/App.ts'
import { view } from '../src/View.ts'
import { at, sceneReplacedBrowse, withPieces } from './AppFixtures.ts'
import { sceneSheetOpened } from './SheetFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const flats = pieceFixture('flats', {
  name: 'Blue flats',
  type: 'flats',
  colours: ['blue'],
  brand: 'COS',
  seasons: ['autumn', 'winter'],
  occasions: ['smart'],
})
const dress = pieceFixture('dress', { name: 'Red dress', type: 'dresses', colours: ['red'] })

test('a reloaded wardrobe restores every filter and the piece link carries the same return context', () => {
  const path = '/wardrobe?group=shoes&type=flats&colours=blue&season=winter&occasion=smart&brand=COS'
  scene(
    { update, view },
    given(withPieces(at(path, { signedIn: true }), [flats, dress])),
    expect(role('heading', { name: 'Flats' })).toExist(),
    expect(role('link', { name: 'Back to Shoes' })).toHaveAttr('href', '/wardrobe?group=shoes'),
    expect(role('button', { name: 'Filters 4' })).toExist(),
    expect(role('link', { name: 'Red dress' })).not.toExist(),
    expect(role('link', { name: 'Blue flats' })).toHaveAttr(
      'href',
      `/wardrobe/${flats.id}?from=${encodeURIComponent(path + '#piece-' + flats.id)}`,
    ),
  )
})

test('choosing a filter replaces the current address rather than adding a Back step', () => {
  scene(
    { update, view },
    given(withPieces(at('/wardrobe?group=shoes&type=flats&season=winter', { signedIn: true }), [flats, dress])),
    click(role('button', { name: 'Filters 1' })),
    Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
    Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
    ...sceneSheetOpened,
    click(role('button', { name: 'Smart' })),
    ...sceneReplacedBrowse('/wardrobe?group=shoes&type=flats&season=winter&occasion=smart'),
    expect(role('link', { name: 'Blue flats' })).toExist(),
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
