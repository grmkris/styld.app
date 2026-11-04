import { Look, Photo as PhotoContract, PhotoGarmentId, PieceId } from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import * as Photo from '../src/page/Photo.ts'
import * as Photos from '../src/page/Photos.ts'
import { subscriptions as appSubscriptions } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage } from './AppFixtures.ts'

const garmentId = PhotoGarmentId.make(`pg_${'tee'.padEnd(22, 'x')}`)
const pieceId = PieceId.make(`pc_${'tee'.padEnd(22, 'x')}`)
const photoOf = (fields: object = {}) =>
  Schema.decodeUnknownSync(PhotoContract)({
    id: `ph_${'beach'.padEnd(22, 'x')}`,
    status: 'ready',
    favourite: false,
    garments: [{ id: garmentId, type: 'shortSleeveTops', colours: ['white'], match: 'suggested', pieceId }],
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

/** What My Gallery's poll waits on. */
const galleryPending = (current: Photos.Model) =>
  Photos.subscriptions.photosWhileFinding.modelToDependencies(current).pendingIds

/** What the photo page's poll waits on. */
const photoPending = (current: Photo.Model) =>
  Photo.subscriptions.photoWhileFinding.modelToDependencies(current).pendingIds

describe('My Gallery', () => {
  test('a picked photo is sent for a credit, shows first while its clothes are found, and is followed until found', () => {
    story(
      Photos.update,
      given(Photos.init()),
      message(Photos.Message.ChosePhoto({ files: [file] })),
      Command.expectExact(Photos.AddPhoto({ file: file })),
      Command.resolve(Photos.AddPhoto, Photos.Message.SucceededAddPhoto({ photo: finding })),
      Command.expectNone(),
      model((current) => expect(galleryPending(current)).toEqual([finding.id])),
      message(Photos.Message.TickedFindingRefresh()),
      Command.expectExact(Photos.ListPhotos()),
      Command.resolve(Photos.ListPhotos, Photos.Message.SucceededListPhotos({ photos: [ready] })),
      model(({ photos }) => expect(AsyncData.getData(photos)).toEqual(Option.some([ready]))),
      model((current) => expect(galleryPending(current)).toEqual([])),
    )
  })

  test('ticks while a read is on its way ask for nothing more, so polls never stack', () => {
    const shown = Photos.update(Photos.init(), Photos.Message.SucceededListPhotos({ photos: [finding] })).model
    const asking = Photos.update(shown, Photos.Message.TickedFindingRefresh())
    expect(asking.commands?.map(({ name }) => name)).toEqual(['ListPhotos'])
    expect(Photos.update(asking.model, Photos.Message.TickedFindingRefresh()).commands ?? []).toEqual([])
  })

  test('a photo added while an older read was on its way stays when that read answers without it', () => {
    const other = photoOf({ id: `ph_${'other'.padEnd(22, 'x')}` })
    const shown = Photos.update(Photos.init(), Photos.Message.SucceededListPhotos({ photos: [other] })).model
    const asking = Photos.update(shown, Photos.Message.TickedFindingRefresh()).model
    const added = Photos.update(asking, Photos.Message.SucceededAddPhoto({ photo: finding })).model
    const stale = Photos.update(added, Photos.Message.SucceededListPhotos({ photos: [other] })).model
    expect(AsyncData.getData(stale.photos)).toEqual(Option.some([finding, other]))
    const caughtUp = Photos.update(stale, Photos.Message.SucceededListPhotos({ photos: [ready, other] })).model
    expect(AsyncData.getData(caughtUp.photos)).toEqual(Option.some([ready, other]))
  })

  test('after five polls that do not get through the page stops following and Try again starts it over', () => {
    const shown = Photos.update(Photos.init(), Photos.Message.SucceededListPhotos({ photos: [finding] })).model
    const missed = Array.reduce(
      Array.range(1, 5),
      shown,
      (current) =>
        Photos.update(
          Photos.update(current, Photos.Message.TickedFindingRefresh()).model,
          Photos.Message.FailedListPhotos(),
        ).model,
    )
    expect(AsyncData.getData(missed.photos)).toEqual(Option.some([finding]))
    expect(galleryPending(missed)).toEqual([])
    const retried = Photos.update(missed, Photos.Message.ClickedRetry())
    expect(retried.commands?.map(({ name }) => name)).toEqual(['ListPhotos'])
    expect(galleryPending(retried.model)).toEqual([finding.id])
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

/** A press on the photo's picture at `from`, let go at `to`. */
const swipe = (start: Photo.Model, from: { x: number; y: number }, to: { x: number; y: number }) =>
  Photo.update(Photo.update(start, Photo.Message.PressedPicture(from)).model, Photo.Message.ReleasedPicture(to)).model

describe('an outfit photo', () => {
  const opened = Photo.init(ready.id)
  const loaded = { ...opened, photo: Photo.PhotoData.Success({ data: ready }) }

  test('opening it asks for it, and while its clothes are found a tick asks again, once at a time', () => {
    expect(Photo.load(opened).map(({ name }) => name)).toEqual(['GetPhoto'])
    const stillFinding = Photo.update(opened, Photo.Message.SucceededGetPhoto({ photo: finding })).model
    expect(photoPending(stillFinding)).toEqual([finding.id])
    story(
      Photo.update,
      given(stillFinding),
      message(Photo.Message.TickedFindingRefresh()),
      Command.expectExact(Photo.GetPhoto({ photoId: ready.id })),
      Command.resolve(Photo.GetPhoto, Photo.Message.SucceededGetPhoto({ photo: ready })),
      model(({ photo }) => expect(photo).toEqual(Photo.PhotoData.Success({ data: ready }))),
      model((current) => expect(photoPending(current)).toEqual([])),
    )
    const asking = Photo.update(stillFinding, Photo.Message.TickedFindingRefresh()).model
    expect(Photo.update(asking, Photo.Message.TickedFindingRefresh()).commands ?? []).toEqual([])
  })

  test('a poll that answers while a change is on its way leaves the change on its way, and a failed one shown', () => {
    const findingLoaded = { ...opened, photo: Photo.PhotoData.Success({ data: finding }) }
    const sending = Photo.update(findingLoaded, Photo.Message.ClickedFavourite({ favourite: true })).model
    const polled = Photo.update(sending, Photo.Message.SucceededGetPhoto({ photo: finding })).model
    expect(polled.work).toEqual(Photo.Work.Sending())
    const failed = Photo.update(polled, Photo.Message.FailedChange()).model
    const polledAgain = Photo.update(failed, Photo.Message.SucceededGetPhoto({ photo: finding })).model
    expect(polledAgain.work).toEqual(Photo.Work.Failed())
  })

  test('a photo that is not the person’s says so; one that did not load keeps what it showed and offers Try again', () => {
    expect(Photo.update(opened, Photo.Message.FailedGetPhoto({ error: 'NotFound' })).model.photo).toEqual(
      Photo.PhotoData.Failure({ error: 'NotFound' }),
    )
    const stale = Photo.update(loaded, Photo.Message.FailedGetPhoto({ error: 'Unavailable' })).model
    expect(stale.photo).toEqual(Photo.PhotoData.Stale({ error: 'Unavailable', data: ready }))
    expect(Photo.update(stale, Photo.Message.ClickedRetry()).commands?.map(({ name }) => name)).toEqual(['GetPhoto'])
  })

  test('a garment is confirmed or sent to the tray, the photo marked a favourite and worn again as a look', () => {
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
      model(({ photo }) =>
        expect(Option.map(AsyncData.getData(photo), ({ lookId }) => lookId)).toEqual(Option.some(look.id)),
      ),
    )
  })

  test('Cut out the outfit asks once, and says so when Styld found no one in the photo', () => {
    story(
      Photo.update,
      given(loaded),
      message(Photo.Message.ClickedCutOut()),
      Command.expectExact(Photo.CutOut({ photoId: ready.id })),
      model((cutting) => {
        expect(cutting.work).toEqual(Photo.Work.CuttingOut())
        // A second press while it works asks nothing more, and neither does a favourite.
        expect(Photo.update(cutting, Photo.Message.ClickedCutOut()).commands ?? []).toEqual([])
        expect(Photo.update(cutting, Photo.Message.ClickedFavourite({ favourite: true })).commands ?? []).toEqual([])
      }),
      Command.resolve(Photo.CutOut, Photo.Message.FailedCutOut({ reason: 'noPerson' })),
      model(({ work }) => expect(work).toEqual(Photo.Work.NoPerson())),
    )
  })

  test('a cut-out asked for too soon after others says to wait, apart from one that failed', () => {
    const cutting = Photo.update(loaded, Photo.Message.ClickedCutOut()).model
    expect(Photo.update(cutting, Photo.Message.FailedCutOut({ reason: 'slowDown' })).model.work).toEqual(
      Photo.Work.SlowDown(),
    )
    expect(Photo.update(cutting, Photo.Message.FailedCutOut({ reason: 'failed' })).model.work).toEqual(
      Photo.Work.Failed(),
    )
  })

  test('the cut-out shows as soon as it is made, and a board then gets the cut-out (T-17)', () => {
    const cut = { ...ready, hasCutout: true }
    story(
      Photo.update,
      given(loaded),
      message(Photo.Message.ClickedCutOut()),
      Command.resolve(Photo.CutOut, Photo.Message.SucceededChange({ photo: cut })),
      model(({ showing, work, saveToBoard }) => {
        expect(showing).toBe('cutout')
        expect(work).toEqual(Photo.Work.Idle())
        expect(saveToBoard.target).toEqual({ kind: 'cutout', id: ready.id })
      }),
      message(Photo.Message.ClickedShow({ showing: 'photo' })),
      model(({ showing, saveToBoard }) => {
        expect(showing).toBe('photo')
        expect(saveToBoard.target).toEqual({ kind: 'photo', id: ready.id })
      }),
    )
  })

  test('a sideways swipe shows the other picture; a short or a mostly upright one does not', () => {
    const withCutout = { ...opened, photo: Photo.PhotoData.Success({ data: { ...ready, hasCutout: true } }) }
    const left = swipe(withCutout, { x: 300, y: 400 }, { x: 180, y: 410 })
    expect(left.showing).toBe('cutout')
    expect(left.press).toEqual(Option.none())
    expect(swipe(left, { x: 100, y: 400 }, { x: 220, y: 400 }).showing).toBe('photo')
    expect(swipe(withCutout, { x: 300, y: 400 }, { x: 270, y: 400 }).showing).toBe('photo')
    expect(swipe(withCutout, { x: 300, y: 400 }, { x: 200, y: 560 }).showing).toBe('photo')
    // Without a cut-out there is nothing to swipe to.
    expect(swipe(loaded, { x: 300, y: 400 }, { x: 100, y: 400 }).showing).toBe('photo')
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

/** The app on a page with My Gallery showing a photo whose garments are being found. */
const galleryAt = (path: string) =>
  withPage(
    at(path, { signedIn: true }),
    lenses.photos,
    (photos) => Photos.update(photos, Photos.Message.SucceededListPhotos({ photos: [finding] })).model,
  )

/** What the app's gallery poll waits on at a path; none while it does not run. */
const galleryPolled = (path: string) =>
  appSubscriptions.photosWhileFinding.modelToDependencies(galleryAt(path)).maybeDependencies

describe('My Gallery follows its photos only while it shows', () => {
  test('on My Gallery the poll runs; on another tab, which keeps the gallery as it was, it does not', () => {
    expect(galleryPolled('/gallery')).toEqual(Option.some({ pendingIds: [finding.id] }))
    expect(galleryPolled('/wardrobe')).toEqual(Option.none())
  })
})
