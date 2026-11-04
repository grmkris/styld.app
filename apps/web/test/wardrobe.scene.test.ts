import type { Piece } from '@styld/protocol'
import { Dialog } from '@foldkit/ui'
import { Command, Mount, click, expect, given, inside, role, scene, selector, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { at, sceneReplacedBrowse } from './AppFixtures.ts'
import { AsyncData } from 'foldkit'
import { ListPieces, Message as PiecesMessage, PiecesData } from '../src/ServerData.ts'
import { view } from '../src/View.ts'
import { sceneSheetOpened } from './SheetFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const wardrobe = (pieces: PiecesData, path = '/wardrobe') =>
  modifyFields(at(path, { signedIn: true }), {
    data: (data) => modifyFields(data, { pieces: () => pieces }),
  })

const loaded = (...pieces: ReadonlyArray<Piece>) => wardrobe(PiecesData.Success({ data: pieces }))
const loadedAt = (path: string, ...pieces: ReadonlyArray<Piece>) => wardrobe(PiecesData.Success({ data: pieces }), path)

const tee = pieceFixture('tee', { name: 'White tee' })
const jeans = pieceFixture('jeans', { type: 'jeans' })
const boots = pieceFixture('boots', { type: 'boots', status: 'processing' })

describe('the wardrobe page', () => {
  test('draws the shape of the grid while the pieces load', () => {
    scene({ update, view }, given(wardrobe(AsyncData.Loading())), expect(role('status')).toHaveText('Loading pieces…'))
  })

  test('opens on the groups that hold pieces, each a card with its newest piece (T-07)', () => {
    scene(
      { update, view },
      given(loaded(tee, jeans, boots)),
      expect(role('link', { name: 'Clothing' })).toHaveAttr('href', '/wardrobe?group=clothing'),
      expect(role('link', { name: 'Shoes' })).toHaveAttr('href', '/wardrobe?group=shoes'),
      expect(role('link', { name: 'Accessories' })).not.toExist(),
      expect(role('link', { name: 'Sport' })).not.toExist(),
      expect(selector(`img[src="${boots.images?.thumb ?? ''}"]`)).toHaveAttr('alt', ''),
      // The groups come first: no piece is listed yet.
      expect(role('link', { name: 'White tee' })).not.toExist(),
    )
  })

  test('a group shows its types that hold pieces, and goes back to the groups', () => {
    scene(
      { update, view },
      given(loadedAt('/wardrobe?group=clothing', tee, jeans, boots)),
      expect(role('heading', { name: 'Clothing' })).toExist(),
      expect(role('link', { name: 'Back to wardrobe' })).toHaveAttr('href', '/wardrobe'),
      expect(role('link', { name: 'T-shirts & short-sleeve tops' })).toHaveAttr(
        'href',
        '/wardrobe?group=clothing&type=shortSleeveTops',
      ),
      expect(role('link', { name: 'Jeans' })).toHaveAttr('href', '/wardrobe?group=clothing&type=jeans'),
      expect(role('link', { name: 'Boots' })).not.toExist(),
      expect(role('link', { name: 'Coats' })).not.toExist(),
    )
  })

  test('a category of the person’s own is a card of its own beside its type, holding only its pieces (T-12)', () => {
    const skiPants = pieceFixture('ski', { name: 'Blue ski pants', type: 'tracksuits', category: 'Ski pants' })
    const trackPants = pieceFixture('trackPants', { name: 'Black track pants', type: 'tracksuits' })
    scene(
      { update, view },
      given(loadedAt('/wardrobe?group=sport', skiPants, trackPants)),
      expect(role('link', { name: 'Tracksuits & ski wear' })).toHaveAttr(
        'href',
        '/wardrobe?group=sport&type=tracksuits',
      ),
      expect(role('link', { name: 'Ski pants' })).toHaveAttr(
        'href',
        '/wardrobe?group=sport&type=tracksuits&category=Ski+pants',
      ),
    )
    scene(
      { update, view },
      given(loadedAt('/wardrobe?group=sport&type=tracksuits&category=Ski+pants', skiPants, trackPants)),
      expect(role('heading', { name: 'Ski pants' })).toExist(),
      expect(role('link', { name: 'Blue ski pants' })).toExist(),
      expect(role('link', { name: 'Black track pants' })).not.toExist(),
    )
    scene(
      { update, view },
      given(loadedAt('/wardrobe?group=sport&type=tracksuits', skiPants, trackPants)),
      expect(role('link', { name: 'Black track pants' })).toExist(),
      expect(role('link', { name: 'Blue ski pants' })).not.toExist(),
    )
  })

  test('a category’s page renames it in place and asks before deleting it, saying its pieces stay (T-12)', () => {
    const skiPants = pieceFixture('ski', { name: 'Blue ski pants', type: 'tracksuits', category: 'Ski pants' })
    scene(
      { update, view },
      given(loadedAt('/wardrobe?group=sport&type=tracksuits&category=Ski+pants', skiPants)),
      click(role('button', { name: 'Rename' })),
      expect(role('textbox', { name: 'Category name' })).toHaveValue('Ski pants'),
      click(role('button', { name: 'Cancel' })),
      click(role('button', { name: 'Delete category' })),
      inside(
        role('alertdialog', { name: 'Delete category' }),
        expect(text('Delete Ski pants? Its pieces stay, under Tracksuits & ski wear.')).toExist(),
      ),
    )
    scene(
      { update, view },
      given(loadedAt('/wardrobe?group=sport&type=tracksuits', pieceFixture('trackPants', { type: 'tracksuits' }))),
      expect(role('button', { name: 'Rename' })).not.toExist(),
    )
  })

  test('a type shows its pieces without labels, each link named for the piece, back to its group', () => {
    const shirt = pieceFixture('shirt', { name: 'Linen shirt' })
    scene(
      { update, view },
      given(loadedAt('/wardrobe?group=clothing&type=shortSleeveTops', tee, shirt, jeans)),
      expect(role('heading', { name: 'T-shirts & short-sleeve tops' })).toExist(),
      expect(role('link', { name: 'Back to Clothing' })).toHaveAttr('href', '/wardrobe?group=clothing'),
      expect(role('link', { name: 'White tee' })).toHaveAttr(
        'href',
        `/wardrobe/${tee.id}?from=%2Fwardrobe%3Fgroup%3Dclothing%26type%3DshortSleeveTops%23piece-${tee.id}`,
      ),
      expect(role('link', { name: 'Linen shirt' })).toExist(),
      expect(text('White tee')).not.toExist(),
      expect(selector(`img[src="${tee.images?.thumb ?? ''}"]`)).toHaveAttr('alt', ''),
      expect(role('link', { name: 'Jeans' })).not.toExist(),
    )
  })

  test('Filters opens a sheet of colours, seasons, occasions and the brands written down, and says what is left', () => {
    const coat = pieceFixture('coat', {
      name: 'Camel coat',
      type: 'coats',
      seasons: ['autumn', 'winter'],
      brand: 'COS',
    })
    const mac = pieceFixture('mac', { name: 'Light mac', type: 'coats', seasons: ['spring'] })
    scene(
      { update, view },
      given(loadedAt('/wardrobe?group=clothing&type=coats', coat, mac, tee)),
      expect(role('button', { name: 'Filters' })).not.toHaveAttr('data-set'),
      expect(role('button', { name: 'Filters' })).toHaveAttr('aria-expanded', 'false'),
      click(role('button', { name: 'Filters' })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      ...sceneSheetOpened,
      expect(role('heading', { name: 'Filter your wardrobe' })).toExist(),
      click(role('button', { name: 'Winter' })),
      ...sceneReplacedBrowse('/wardrobe?group=clothing&type=coats&season=winter'),
      expect(role('button', { name: 'Show 1 piece' })).toExist(),
      expect(role('button', { name: 'COS' })).toExist(),
      expect(role('link', { name: 'Light mac' })).not.toExist(),
      expect(role('button', { name: 'Filters 1' })).toHaveAttr('data-set', ''),
      expect(role('button', { name: 'Filters 1' })).not.toHaveAttr('aria-pressed'),
    )
  })

  test('a piece still processing says so', () => {
    scene(
      { update, view },
      given(loadedAt('/wardrobe?group=shoes&type=boots', boots)),
      expect(text('Processing')).toExist(),
    )
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
