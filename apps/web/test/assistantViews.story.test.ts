import { BoardView, GalleryView, PieceId, PiecesView, PieceView, TryOnView, WardrobeView } from '@styld/protocol'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { Message, OpenLink, Showing, init, update } from '../src/assistant/Views.ts'

const groups = {
  tops: 'Tops',
  bottoms: 'Bottoms',
  dresses: 'Dresses & jumpsuits',
  outerwear: 'Outerwear',
  sport: 'Sport',
  swimLounge: 'Swim & lounge',
  shoes: 'Shoes',
  accessories: 'Accessories',
}
const labels = {
  wardrobeTitle: 'Wardrobe',
  empty: 'Your wardrobe is empty',
  openInStyld: 'Open in Styld',
  groups,
}
const wardrobe = WardrobeView.make({
  pieces: [
    { id: PieceId.make(`pc_${'a'.repeat(22)}`), name: 'Navy knit', group: 'tops', url: 'https://styld.test/w/1' },
  ],
  url: 'https://styld.test/wardrobe',
  labels: { en: labels, sl: { ...labels, openInStyld: 'Odpri v Styldu' } },
})

const boardLabels = {
  pinned: 'Pinned',
  empty: 'Nothing pinned yet',
  picture: 'A picture',
  openInStyld: 'Open in Styld',
}
const board = BoardView.make({
  name: 'Autumn',
  paper: 'sage',
  items: [],
  pins: [{ id: 'pn_1', name: 'Navy knit', image: `piece:pc_${'a'.repeat(22)}`, url: 'https://styld.test/w/1' }],
  url: 'https://styld.test/boards/1',
  labels: { en: boardLabels, sl: { ...boardLabels, pinned: 'V zbirki' } },
})

describe('the assistant view', () => {
  test('waits for a result, then shows it in the host language with its pictures', () => {
    story(
      update,
      given(init().model),
      model(({ showing }) => expect(Showing.guards.Waiting(showing)).toBe(true)),
      message(Message.ReceivedHost({ input: { _tag: 'ChangedLanguage', language: 'sl' } })),
      message(
        Message.ReceivedHost({
          input: {
            _tag: 'ShowedResult',
            view: wardrobe,
            images: { [`pc_${'a'.repeat(22)}`]: 'data:image/webp;base64,AA' },
          },
        }),
      ),
      model(({ showing, language, images }) => {
        expect(Showing.guards.Wardrobe(showing)).toBe(true)
        expect(language).toBe('sl')
        expect(Object.keys(images)).toHaveLength(1)
      }),
    )
  })

  test('opens a piece through the host rather than navigating its own frame', () => {
    story(
      update,
      given(init().model),
      message(Message.ClickedOpen({ url: 'https://styld.test/w/1' })),
      Command.expectExact(OpenLink({ url: 'https://styld.test/w/1' })),
      Command.resolve(OpenLink, Message.CompletedOpen()),
      model((shown) => expect(shown).toEqual(init().model)),
    )
  })

  test('shows a board after the wardrobe, keeping the pictures it already has', () => {
    story(
      update,
      given(init().model),
      message(
        Message.ReceivedHost({
          input: {
            _tag: 'ShowedResult',
            view: wardrobe,
            images: { [`pc_${'a'.repeat(22)}`]: 'data:image/webp;base64,AA' },
          },
        }),
      ),
      message(
        Message.ReceivedHost({
          input: {
            _tag: 'ShowedResult',
            view: board,
            images: { [`piece:pc_${'a'.repeat(22)}`]: 'data:image/webp;base64,BB' },
          },
        }),
      ),
      model(({ showing, images }) => {
        expect(Showing.guards.Board(showing)).toBe(true)
        expect(Object.keys(images)).toHaveLength(2)
      }),
    )
  })
})

const knit = {
  id: PieceId.make(`pc_${'a'.repeat(22)}`),
  name: 'Navy knit',
  group: 'tops' as const,
  url: 'https://styld.test/w/1',
}
const tryOnLabels = {
  title: 'Try on',
  before: 'Before',
  after: 'After',
  drawing: 'Styld is still drawing this one.',
  stopped: 'Styld couldn’t draw this one.',
  wearing: 'Wearing',
  openInStyld: 'Open in Styld',
  groups,
}
const tryOn = TryOnView.make({
  id: `to_${'t'.repeat(22)}`,
  status: 'done',
  before: `photo:ph_${'p'.repeat(22)}`,
  after: `tryOn:to_${'t'.repeat(22)}`,
  pieces: [knit],
  url: 'https://styld.test/try-on/1',
  labels: { en: tryOnLabels, sl: { ...tryOnLabels, before: 'Prej' } },
})
const galleryLabels = { title: 'Your Gallery', empty: 'No photos yet', openInStyld: 'Open in Styld' }
const gallery = GalleryView.make({
  photos: [
    { id: `ph_${'p'.repeat(22)}`, number: 1, day: '2026-11-04', found: ['navy jeans'], url: 'https://styld.test/g/1' },
  ],
  url: 'https://styld.test/gallery',
  labels: { en: galleryLabels, sl: galleryLabels },
})
const piecesLabels = { title: 'Your pieces', outfit: 'Outfit', empty: 'None', openInStyld: 'Open in Styld', groups }
const outfits = PiecesView.make({
  title: null,
  outfits: true,
  rows: [[knit], [knit]],
  url: 'https://styld.test/wardrobe',
  labels: { en: piecesLabels, sl: piecesLabels },
})
const pictureNames = {
  shown: 'Main',
  clean: 'Shop-style',
  back: 'Back',
  backClean: 'Back, shop-style',
  photo: 'Photo',
  cutout: 'Cut-out',
}
const onePiece = PieceView.make({
  piece: knit,
  details: ['navy knit jumper'],
  pictures: [{ kind: 'clean', image: `piece:${knit.id}:clean` }],
  labels: {
    en: { pictures: pictureNames, openInStyld: 'Open in Styld', groups },
    sl: { pictures: pictureNames, openInStyld: 'Odpri v Styldu', groups },
  },
})

describe('the media views', () => {
  test('a try-on, the Gallery, outfits and one piece each show as their own view, keeping earlier pictures', () => {
    story(
      update,
      given(init().model),
      message(
        Message.ReceivedHost({
          input: { _tag: 'ShowedResult', view: tryOn, images: { [tryOn.before]: 'data:image/webp;base64,AA' } },
        }),
      ),
      model(({ showing }) => expect(Showing.guards.TryOn(showing)).toBe(true)),
      message(
        Message.ReceivedHost({
          input: { _tag: 'ShowedResult', view: gallery, images: { [`photo:ph_${'q'.repeat(22)}`]: 'data:x' } },
        }),
      ),
      model(({ showing }) => expect(Showing.guards.Gallery(showing)).toBe(true)),
      message(Message.ReceivedHost({ input: { _tag: 'ShowedResult', view: outfits, images: {} } })),
      model(({ showing }) => expect(Showing.guards.Pieces(showing)).toBe(true)),
      message(
        Message.ReceivedHost({
          input: { _tag: 'ShowedResult', view: onePiece, images: { [`piece:${knit.id}:clean`]: 'data:y' } },
        }),
      ),
      model(({ showing, images }) => {
        expect(Showing.guards.Piece(showing)).toBe(true)
        expect(Object.keys(images)).toHaveLength(3)
      }),
    )
  })

  test('a Gallery photo opens its page through the host', () => {
    story(
      update,
      given(init().model),
      message(Message.ReceivedHost({ input: { _tag: 'ShowedResult', view: gallery, images: {} } })),
      message(Message.ClickedOpen({ url: 'https://styld.test/g/1' })),
      Command.expectExact(OpenLink({ url: 'https://styld.test/g/1' })),
      Command.resolve(OpenLink, Message.CompletedOpen()),
      model(({ showing }) => expect(Showing.guards.Gallery(showing)).toBe(true)),
    )
  })
})
