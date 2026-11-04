import { Photo as PhotoContract, PhotoGarmentId } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { Command, click, expect, given, inside, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import * as Photo from '../src/page/Photo.ts'
import { view } from '../src/View.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage, withPieces } from './AppFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const tee = pieceFixture('tee', { type: 'shortSleeveTops', name: 'White tee' })
const shirt = pieceFixture('shirt', { type: 'shirts', name: 'Oxford shirt' })
const jeans = pieceFixture('jeans', { type: 'jeans', name: 'Blue jeans' })
const garment = (id: string, fields: object) => ({
  id: PhotoGarmentId.make(`pg_${id.padEnd(22, 'x')}`),
  colours: [],
  ...fields,
})
const photo = Schema.decodeUnknownSync(PhotoContract)({
  id: `ph_${'beach'.padEnd(22, 'x')}`,
  status: 'ready',
  favourite: false,
  garments: [
    garment('top', { type: 'shortSleeveTops', match: 'suggested', pieceId: tee.id }),
    garment('bottom', { type: 'jeans', match: 'confirmed', pieceId: jeans.id }),
    garment('shoes', { type: 'trainers', match: 'unmatched', pieceId: null }),
  ],
  lookId: null,
  hasCutout: false,
  createdAt: '2026-10-31T10:00:00.000Z',
})

/** The photo's page with the wardrobe read. */
const onPhoto = () =>
  withPage(withPieces(at(`/gallery/${photo.id}`, { signedIn: true }), [tee, shirt, jeans]), lenses.photo, () =>
    modifyFields(Photo.init(photo.id), {
      photo: () => Photo.PhotoData.Success({ data: photo }),
      choosing: () => Option.none(),
    }),
  )

describe('an outfit photo’s page', () => {
  test('asks about Styld’s guess, names a confirmed piece, and offers what the wardrobe lacks', () => {
    scene(
      { update, view },
      given(onPhoto()),
      inside(
        role('region', { name: 'What you’re wearing' }),
        expect(text('Is it this one?')).toExist(),
        expect(role('button', { name: 'Yes, that’s it' })).toExist(),
        expect(text('Blue jeans')).toExist(),
        expect(role('button', { name: 'Add to wardrobe' })).toExist(),
      ),
      // A confirmed piece makes the photo something to wear again.
      expect(role('button', { name: 'Wear it again' })).toExist(),
      expect(role('button', { name: 'Favourite' })).toHaveAttr('aria-pressed', 'false'),
      // It goes on a board as the owner's own picture, with the look worn from it.
      expect(role('button', { name: 'Save to board' })).toExist(),
    )
  })

  test('with its outfit cut out, the page offers the photo or the cut-out, and the heart says it is a favourite', () => {
    const cut = { ...photo, hasCutout: true, favourite: true }
    scene(
      { update, view },
      given(
        withPage(withPieces(at(`/gallery/${photo.id}`, { signedIn: true }), [tee, shirt, jeans]), lenses.photo, () =>
          modifyFields(Photo.init(photo.id), { photo: () => Photo.PhotoData.Success({ data: cut }) }),
        ),
      ),
      expect(role('button', { name: 'Favourite' })).toHaveAttr('aria-pressed', 'true'),
      inside(
        role('group', { name: 'Photo or cut-out' }),
        expect(role('button', { name: 'Photo' })).toHaveAttr('aria-pressed', 'true'),
        expect(role('button', { name: 'Cut-out' })).toHaveAttr('aria-pressed', 'false'),
      ),
      expect(role('button', { name: 'Cut out the outfit' })).not.toExist(),
      click(role('button', { name: 'Cut-out' })),
      expect(role('img', { name: 'Outfit cut out of the photo from 31 Oct' })).toExist(),
    )
  })

  test('cutting out says so on the picture and on the button until it is done', () => {
    scene(
      { update, view },
      given(onPhoto()),
      click(role('button', { name: 'Cut out the outfit' })),
      expect(role('status')).toHaveText('Cutting out the outfit…'),
      expect(role('button', { name: 'Cutting out the outfit…' })).toHaveAttr('aria-disabled', 'true'),
      expect(role('group', { name: 'Photo or cut-out' })).not.toExist(),
      Command.resolve(Photo.CutOut, Photo.Message.FailedCutOut({ reason: 'slowDown' })),
      expect(role('alert')).toHaveText('Many cut-outs at once. Try again in a minute.'),
    )
  })

  test('Not this one opens the wardrobe’s pieces of that kind, and none of them', () => {
    scene(
      { update, view },
      given(onPhoto()),
      click(role('button', { name: 'Not this one' })),
      inside(
        role('group', { name: 'Choose from your wardrobe' }),
        expect(role('button', { name: 'White tee' })).toExist(),
        expect(role('button', { name: 'Oxford shirt' })).toExist(),
        expect(role('button', { name: 'Blue jeans' })).not.toExist(),
      ),
      expect(role('button', { name: 'None of my pieces' })).toExist(),
    )
  })

  test('the Lab’s tabs lead to the gallery, and the Lab marks the navigation', () => {
    scene(
      { update, view },
      given(at('/gallery', { signedIn: true })),
      expect(role('link', { name: 'Gallery' })).toHaveAttr('aria-current', 'page'),
      expect(role('link', { name: 'Gallery' })).toHaveAttr('href', '/gallery'),
      expect(role('link', { name: 'Boards' })).toHaveAttr('href', '/boards'),
      expect(role('link', { name: 'Looks' })).toHaveAttr('href', '/looks'),
      expect(role('link', { name: 'Lab' })).toHaveAttr('aria-current', 'page'),
    )
  })
})
