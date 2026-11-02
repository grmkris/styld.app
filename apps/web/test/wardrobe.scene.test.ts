import type { Piece } from '@styld/protocol'
import { Dialog } from '@foldkit/ui'
import { Command, Mount, click, expect, given, role, scene, selector, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { at } from './AppFixtures.ts'
import { AsyncData } from 'foldkit'
import { ListPieces, Message as PiecesMessage, PiecesData } from '../src/ServerData.ts'
import { view } from '../src/View.ts'
import { sceneSheetOpened } from './SheetFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const wardrobe = (pieces: PiecesData) =>
  modifyFields(at('/wardrobe', { signedIn: true }), {
    data: (data) => modifyFields(data, { pieces: () => pieces }),
  })

const loaded = (...pieces: ReadonlyArray<Piece>) => wardrobe(PiecesData.Success({ data: pieces }))

const tee = pieceFixture('tee', { name: 'White tee' })
const jeans = pieceFixture('jeans', { type: 'jeans' })
const boots = pieceFixture('boots', { type: 'boots', status: 'processing' })

describe('the wardrobe page', () => {
  test('draws the shape of the grid while the pieces load', () => {
    scene({ update, view }, given(wardrobe(AsyncData.Loading())), expect(role('status')).toHaveText('Loading pieces…'))
  })

  test('shows each piece by name, or by what it is, browsed by group and then by type as a shop is', () => {
    scene(
      { update, view },
      given(loaded(tee, jeans, boots)),
      expect(role('link', { name: 'White tee' })).toHaveAttr('href', `/wardrobe/${tee.id}`),
      // The caption names a piece once; its picture is decoration inside the link.
      expect(role('link', { name: 'Jeans' })).toHaveAttr('href', `/wardrobe/${jeans.id}`),
      expect(selector(`img[src="${jeans.images?.thumb ?? ''}"]`)).toHaveAttr('alt', ''),
      expect(role('button', { name: 'All 3' })).toHaveAttr('aria-pressed', 'true'),
      expect(role('button', { name: 'Clothing 2' })).toExist(),
      expect(role('button', { name: 'Shoes 1' })).toExist(),
      expect(role('button', { name: 'Accessories 0' })).not.toExist(),
      expect(role('group', { name: 'Clothing' })).not.toExist(),
      click(role('button', { name: 'Clothing 2' })),
      expect(role('button', { name: 'Clothing 2' })).toHaveAttr('aria-pressed', 'true'),
      expect(role('link', { name: 'Boots' })).not.toExist(),
      expect(role('group', { name: 'Clothing' })).toExist(),
      click(role('button', { name: 'Jeans 1' })),
      expect(role('link', { name: 'White tee' })).not.toExist(),
      expect(role('link', { name: 'Jeans' })).toExist(),
    )
  })

  test('Filters opens a sheet of colours, seasons, occasions and the brands written down, and says what is left', () => {
    const coat = pieceFixture('coat', { name: 'Camel coat', type: 'coats', season: 'cold', brand: 'COS' })
    scene(
      { update, view },
      given(loaded(tee, coat)),
      expect(role('button', { name: 'Filters' })).not.toHaveAttr('data-set'),
      expect(role('button', { name: 'Filters' })).toHaveAttr('aria-expanded', 'false'),
      click(role('button', { name: 'Filters' })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      ...sceneSheetOpened,
      expect(role('heading', { name: 'Filter your wardrobe' })).toExist(),
      click(role('button', { name: 'Cold weather' })),
      expect(role('button', { name: 'Show 1 piece' })).toExist(),
      expect(role('button', { name: 'COS' })).toExist(),
      expect(role('link', { name: 'White tee' })).not.toExist(),
      expect(role('button', { name: 'Filters 1' })).toHaveAttr('data-set', ''),
      expect(role('button', { name: 'Filters 1' })).not.toHaveAttr('aria-pressed'),
    )
  })

  test('a piece still processing says so', () => {
    scene({ update, view }, given(loaded(boots)), expect(text('Processing')).toExist())
  })

  test('an empty wardrobe offers the one action that fills it', () => {
    scene(
      { update, view },
      given(loaded()),
      expect(role('heading', { name: 'No pieces in your wardrobe yet' })).toExist(),
      expect(role('link', { name: 'Add your first pieces' })).toHaveAttr('href', '/wardrobe/add'),
      expect(role('link', { name: 'Add clothes' })).toHaveAttr('href', '/wardrobe/add'),
    )
  })

  test('a wardrobe that cannot load says what broke and how to try again', () => {
    scene(
      { update, view },
      given(wardrobe(PiecesData.Failure({ error: 'Unavailable' }))),
      expect(role('alert')).toHaveText('Could not load pieces. Try again.'),
      click(role('button', { name: 'Try again' })),
      expect(role('status')).toHaveText('Loading pieces…'),
      Command.resolve(ListPieces, PiecesMessage.SucceededListPieces({ pieces: [] })),
    )
  })

  test('the signed-in shell names the current section', () => {
    scene(
      { update, view },
      given(loaded()),
      expect(role('navigation', { name: 'Navigation' })).toExist(),
      expect(role('link', { name: 'Wardrobe' })).toHaveAttr('aria-current', 'page'),
      expect(role('link', { name: 'Home' })).not.toHaveAttr('aria-current'),
    )
  })
})
