import { Option } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { brandsOf, DrawPictures, enter, init, Message, OutMessage, shownPieces, update } from '../src/page/Wardrobe.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

describe('the wardrobe tab', () => {
  test('a wardrobe that cannot load asks the app for its pieces again on retry', () => {
    story(
      update,
      given(init()),
      message(Message.ClickedRetry()),
      Command.expectNone(),
      model((current) => expect(current).toEqual(init())),
      expectOutMessage(OutMessage.RequestedPieces()),
    )
  })

  test('a group, then one of its types, filters the grid; another group starts from all its types', () => {
    story(
      update,
      given(init()),
      message(Message.ClickedGroup({ group: Option.some('shoes') })),
      message(Message.ClickedType({ type: Option.some('boots') })),
      model(({ group, type }) => {
        expect(group).toEqual(Option.some('shoes'))
        expect(type).toEqual(Option.some('boots'))
      }),
      message(Message.ClickedGroup({ group: Option.some('clothing') })),
      model(({ type }) => expect(type).toEqual(Option.none())),
      message(Message.ClickedGroup({ group: Option.none() })),
      model(({ group }) => expect(group).toEqual(Option.none())),
    )
  })
})

describe('clean pictures for the pieces that have none', () => {
  test('the wardrobe page counts them, and one tap asks for all of them and has the pieces read again', () => {
    story(
      update,
      given(enter(init()).model),
      message(Message.CompletedCountUndrawn({ pieces: 4 })),
      model(({ undrawn }) => expect(undrawn).toBe(4)),
      message(Message.ClickedDrawPictures()),
      Command.expectExact(DrawPictures),
      Command.resolve(DrawPictures, Message.SucceededDrawPictures()),
      model(({ undrawn, backfill }) => expect({ undrawn, backfill }).toEqual({ undrawn: 0, backfill: 'sent' })),
      expectOutMessage(OutMessage.RequestedPieces()),
    )
    expect(enter(init()).commands?.map(({ name }) => name)).toEqual(['CountUndrawn'])
    // A second tap while the first is on its way asks for nothing more.
    const sending = update(init(), Message.ClickedDrawPictures()).model
    expect(update(sending, Message.ClickedDrawPictures()).commands ?? []).toEqual([])
  })
})

describe('filtering the wardrobe', () => {
  const coat = pieceFixture('coat', { type: 'coats', colours: ['beige'], season: 'cold', brand: 'COS' })
  const tee = pieceFixture('tee', { type: 'tops', colours: ['white'], season: 'warm', occasions: ['casual'] })
  const jeans = pieceFixture('jeans', { type: 'jeans', colours: ['blue'], season: 'allYear', brand: 'Levi’s' })
  const pieces = [coat, tee, jeans]
  const shown = (current: Parameters<typeof update>[0]) => shownPieces(pieces, current).map(({ id }) => id)

  test('any chosen colour, the season (all-year pieces too), the occasion and the brand narrow the grid', () => {
    story(
      update,
      given(init()),
      message(Message.ChoseFilterSeason({ season: 'cold' })),
      model((current) => expect(shown(current)).toEqual([coat.id, jeans.id])),
      message(Message.ToggledFilterColour({ colour: 'blue' })),
      message(Message.ToggledFilterColour({ colour: 'beige' })),
      model((current) => expect(shown(current)).toEqual([coat.id, jeans.id])),
      message(Message.ChoseFilterBrand({ brand: 'COS' })),
      model((current) => expect(shown(current)).toEqual([coat.id])),
      message(Message.ChoseFilterBrand({ brand: 'COS' })),
      message(Message.ChoseFilterOccasion({ occasion: 'casual' })),
      model((current) => expect(shown(current)).toEqual([])),
      message(Message.ClickedClearFilters()),
      model((current) => expect(shown(current)).toEqual([coat.id, tee.id, jeans.id])),
    )
  })

  test('offers the brands written on the pieces, once each, in order', () => {
    expect(brandsOf([...pieces, pieceFixture('bag', { brand: 'COS' })])).toEqual(['COS', 'Levi’s'])
  })
})
