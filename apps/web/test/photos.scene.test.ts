import { Photo as PhotoContract, PhotoGarmentId } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { Dialog } from '@foldkit/ui'
import { Command, click, expect, given, inside, Mount, role, scene, text, type } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import * as Photo from '../src/page/Photo.ts'
import { view } from '../src/View.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage, withPieces } from './AppFixtures.ts'
import { sceneSheetMoved, sceneSheetOpened } from './SheetFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const tee = pieceFixture('tee', { type: 'shortSleeveTops', name: 'White tee' })
const shirt = pieceFixture('shirt', { type: 'shirts', name: 'Oxford shirt' })
const jeans = pieceFixture('jeans', { type: 'jeans', name: 'Blue jeans' })
const cardigan = pieceFixture('cardigan', { type: 'jackets', name: 'Grey cardigan', colours: ['grey'] })
const garment = (id: string, fields: object) => ({
  id: PhotoGarmentId.make(`pg_${id.padEnd(22, 'x')}`),
  colours: [],
  ...fields,
})
const topGarment = garment('top', { type: 'shortSleeveTops', match: 'suggested', pieceId: tee.id })
const photo = Schema.decodeUnknownSync(PhotoContract)({
  id: `ph_${'beach'.padEnd(22, 'x')}`,
  status: 'ready',
  favourite: false,
  garments: [
    topGarment,
    garment('bottom', { type: 'jeans', match: 'confirmed', pieceId: jeans.id }),
    garment('shoes', { type: 'trainers', match: 'unmatched', pieceId: null }),
  ],
  lookId: null,
  hasCutout: false,
  createdAt: '2026-10-31T10:00:00.000Z',
})

/** The photo with one of its garments changed, as the server would answer. */
const withGarment = (garmentId: string, fields: object) =>
  Schema.decodeUnknownSync(PhotoContract)({
    ...photo,
    garments: photo.garments.map((found) => (found.id === garmentId ? { ...found, ...fields } : found)),
  })

/** A photo's page with the wardrobe read. */
const onPhotoOf = (shown: PhotoContract) =>
  withPage(
    withPieces(at(`/gallery/${shown.id}`, { signedIn: true }), [tee, shirt, jeans, cardigan]),
    lenses.photo,
    () =>
      modifyFields(Photo.init(shown.id), {
        photo: () => Photo.PhotoData.Success({ data: shown }),
        choosing: () => Option.none(),
      }),
  )
const onPhoto = () => onPhotoOf(photo)

/** The wardrobe's sheet opened from a garment's button, as a scene's steps. */
const choosingFor = (button: string) => [
  click(role('button', { name: button })),
  Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
  Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
  ...sceneSheetOpened,
]

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
        withPage(
          withPieces(at(`/gallery/${photo.id}`, { signedIn: true }), [tee, shirt, jeans, cardigan]),
          lenses.photo,
          () => modifyFields(Photo.init(photo.id), { photo: () => Photo.PhotoData.Success({ data: cut }) }),
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

  test('Not this one opens the whole wardrobe on the kind Styld read, and none of them', () => {
    scene(
      { update, view },
      given(onPhoto()),
      ...choosingFor('Not this one'),
      inside(
        role('dialog', { name: 'Choose from your wardrobe' }),
        // The sheet opens on what Styld read the garment as, a top.
        expect(role('button', { name: 'T-shirts & short-sleeve tops' })).toHaveAttr('aria-pressed', 'true'),
        expect(role('button', { name: 'White tee' })).toExist(),
        expect(role('button', { name: 'Grey cardigan' })).not.toExist(),
        expect(role('button', { name: 'None of my pieces' })).toExist(),
      ),
    )
  })

  test('a piece kept under another kind is one tap or one word away (Eva, 4 November)', () => {
    // Her cardigan is kept under jackets, and Styld read it in the photo as a top: before, it could never be chosen.
    scene(
      { update, view },
      given(onPhoto()),
      ...choosingFor('Not this one'),
      inside(role('group', { name: 'Categories' }), click(role('button', { name: 'All' }))),
      expect(role('button', { name: 'Grey cardigan' })).toExist(),
      expect(role('button', { name: 'Blue jeans' })).toExist(),
    )
    scene(
      { update, view },
      given(onPhoto()),
      ...choosingFor('Not this one'),
      type(role('searchbox', { name: 'Search your pieces' }), 'grey'),
      expect(role('button', { name: 'Grey cardigan' })).toExist(),
      expect(role('button', { name: 'White tee' })).not.toExist(),
      expect(role('group', { name: 'Categories' })).not.toExist(),
      click(role('button', { name: 'Grey cardigan' })),
      // The sheet closes and the garment is sent as the cardigan; the row then names it.
      ...sceneSheetMoved(2),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
      Mount.expectEnded(Dialog.AcquireResources),
      Command.resolve(
        Photo.MatchGarment({ photoId: photo.id, garmentId: topGarment.id, pieceId: cardigan.id }),
        Photo.Message.SucceededChange({
          photo: withGarment(topGarment.id, { match: 'confirmed', pieceId: cardigan.id }),
        }),
      ),
      inside(role('region', { name: 'What you’re wearing' }), expect(text('Grey cardigan')).toExist()),
    )
  })

  test('a photo where Styld found nothing says so, and a piece is added to it by hand from the wardrobe', () => {
    const empty = Schema.decodeUnknownSync(PhotoContract)({ ...photo, garments: [] })
    // Added by hand, the garment has no picture of the photo: the piece's own stands in, and it comes off again.
    const added = Schema.decodeUnknownSync(PhotoContract)({
      ...photo,
      garments: [garment('added', { type: 'jackets', match: 'confirmed', pieceId: cardigan.id })],
    })
    scene(
      { update, view },
      given(onPhotoOf(empty)),
      expect(
        text('Styld didn’t find any clothes in this photo. Add what you’re wearing from your wardrobe.'),
      ).toExist(),
      ...choosingFor('Add from my wardrobe'),
      inside(
        role('dialog', { name: 'Add from my wardrobe' }),
        expect(role('button', { name: 'Grey cardigan' })).toExist(),
        expect(role('button', { name: 'Blue jeans' })).toExist(),
        expect(role('button', { name: 'None of my pieces' })).not.toExist(),
      ),
      click(role('button', { name: 'Grey cardigan' })),
      ...sceneSheetMoved(2),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
      Mount.expectEnded(Dialog.AcquireResources),
      Command.resolve(
        Photo.AddPiece({ photoId: photo.id, pieceId: cardigan.id }),
        Photo.Message.SucceededChange({ photo: added }),
      ),
      inside(
        role('region', { name: 'What you’re wearing' }),
        expect(text('Grey cardigan')).toExist(),
        expect(role('button', { name: 'Remove from this photo' })).toExist(),
        expect(role('button', { name: 'Change' })).not.toExist(),
      ),
      expect(role('button', { name: 'Wear it again' })).toExist(),
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
