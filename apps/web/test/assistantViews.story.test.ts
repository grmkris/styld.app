import { PieceId, WardrobeView } from '@styld/protocol'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { Message, OpenLink, Showing, init, update } from '../src/assistant/Views.ts'

const labels = {
  wardrobeTitle: 'Wardrobe',
  empty: 'Your wardrobe is empty',
  openInStyld: 'Open in Styld',
  categories: {
    top: 'Tops',
    bottom: 'Bottoms',
    dress: 'Dresses',
    outerwear: 'Outerwear',
    shoes: 'Shoes',
    accessory: 'Accessories',
  },
}
const wardrobe = WardrobeView.make({
  pieces: [
    { id: PieceId.make(`pc_${'a'.repeat(22)}`), name: 'Navy knit', category: 'top', url: 'https://styld.test/w/1' },
  ],
  url: 'https://styld.test/wardrobe',
  labels: { en: labels, sl: { ...labels, openInStyld: 'Odpri v Styldu' } },
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
})
