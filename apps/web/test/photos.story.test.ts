import { Look, Photo as PhotoContract, PhotoGarmentId, PieceId } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import * as Photo from '../src/page/Photo.ts'
import * as Photos from '../src/page/Photos.ts'

const garmentId = PhotoGarmentId.make(`pg_${'tee'.padEnd(22, 'x')}`)
const pieceId = PieceId.make(`pc_${'tee'.padEnd(22, 'x')}`)
const photoOf = (fields: object = {}) =>
  Schema.decodeUnknownSync(PhotoContract)({
    id: `ph_${'beach'.padEnd(22, 'x')}`,
    status: 'ready',
    favourite: false,
    garments: [{ id: garmentId, type: 'tops', colours: ['white'], match: 'suggested', pieceId }],
    lookId: null,
    hasCutout: false,
    createdAt: '2026-10-31T10:00:00.000Z',
    ...fields,
  })
const ready = photoOf()
const finding = photoOf({ status: 'finding', garments: [] })
const look = Schema.decodeUnknownSync(Look)({
  id: `lk_${'again'.padEnd(22, 'x')}`,
  name: 'Outfit from 31 Oct',
  occasion: null,
  pieces: [],
  shared: false,
  check: null,
  createdAt: '2026-10-31T10:00:00.000Z',
})
const file = new File(['x'], 'outfit.jpg', { type: 'image/jpeg' })

describe('My Gallery', () => {
  test('a picked photo is sent for a credit, shows first while its clothes are found, and is asked about again', () => {
    story(
      Photos.update,
      given(Photos.init()),
      message(Photos.Message.ChosePhoto({ files: [file] })),
      Command.expectExact(Photos.AddPhoto({ file: file })),
      Command.resolve(Photos.AddPhoto, Photos.Message.SucceededAddPhoto({ photo: finding })),
      Command.expectExact(Photos.WaitWhileFinding()),
      Command.resolve(Photos.WaitWhileFinding, Photos.Message.ElapsedFindingPause()),
      Command.expectExact(Photos.ListPhotos()),
      Command.resolve(Photos.ListPhotos, Photos.Message.SucceededListPhotos({ photos: [ready] })),
      model(({ photos }) => expect(AsyncData.getData(photos)).toEqual(Option.some([ready]))),
    )
  })

  test('with today’s free credits spent, adding says so', () => {
    story(
      Photos.update,
      given(Photos.init()),
      message(Photos.Message.ChosePhoto({ files: [file] })),
      Command.resolve(Photos.AddPhoto, Photos.Message.FailedAddPhoto({ spent: true })),
      model(({ adding }) => expect(adding).toEqual(Photos.Adding.Failed({ spent: true }))),
    )
  })
})

describe('an outfit photo', () => {
  const opened = Photo.init(ready.id)

  test('opening it asks for it, and while its clothes are found it asks again', () => {
    expect(Photo.load(opened).map(({ name }) => name)).toEqual(['GetPhoto'])
    story(
      Photo.update,
      given(opened),
      message(Photo.Message.SucceededGetPhoto({ photo: finding })),
      Command.resolve(Photo.WaitWhileFinding, Photo.Message.ElapsedFindingPause()),
      Command.resolve(Photo.GetPhoto, Photo.Message.SucceededGetPhoto({ photo: ready })),
      model(({ shown }) => expect(shown).toEqual(Photo.Shown.Loaded({ photo: ready }))),
    )
  })

  test('a garment is confirmed or sent to the tray, the photo marked a favourite and worn again as a look', () => {
    const loaded = { ...opened, shown: Photo.Shown.Loaded({ photo: ready }) }
    story(
      Photo.update,
      given(loaded),
      message(Photo.Message.ClickedMatch({ garmentId, pieceId })),
      Command.expectExact(Photo.MatchGarment({ photoId: ready.id, garmentId, pieceId })),
      Command.resolve(Photo.MatchGarment, Photo.Message.SucceededChange({ photo: ready })),
      message(Photo.Message.ClickedOffer({ garmentId })),
      Command.resolve(Photo.OfferGarment, Photo.Message.SucceededChange({ photo: ready })),
      message(Photo.Message.ClickedFavourite({ favourite: true })),
      Command.resolve(Photo.SetFavourite, Photo.Message.SucceededChange({ photo: ready })),
      message(Photo.Message.ClickedWearAgain({ name: 'Outfit from 31 Oct' })),
      Command.resolve(Photo.WearAgain, Photo.Message.SucceededWearAgain({ look })),
      model(({ shown }) => expect(Photo.Shown.guards.Loaded(shown) ? shown.photo.lookId : null).toBe(look.id)),
    )
  })

  test('Cut out the outfit asks once, and says so when Styld found no one in the photo', () => {
    story(
      Photo.update,
      given({ ...opened, shown: Photo.Shown.Loaded({ photo: ready }) }),
      message(Photo.Message.ClickedCutOut()),
      Command.expectExact(Photo.CutOut({ photoId: ready.id })),
      Command.resolve(Photo.CutOut, Photo.Message.FailedCutOut({ noPerson: true })),
      model(({ work }) => expect(work).toEqual(Photo.Work.NoPerson())),
    )
  })

  test('deleting asks first, then goes back to the gallery', () => {
    story(
      Photo.update,
      given(opened),
      message(Photo.Message.ClickedDelete()),
      model(({ deletion }) => expect(deletion).toEqual(Photo.Deletion.Confirming())),
      message(Photo.Message.ClickedConfirmDelete()),
      Command.resolve(Photo.DeletePhoto, Photo.Message.SucceededDeletePhoto()),
      expectOutMessage(Photo.OutMessage.DeletedPhoto()),
    )
  })
})
