import { Option } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { brandsOf, init, Message, newestOf, OutMessage, restore, shownPieces, update } from '../src/page/Wardrobe.ts'
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

  test('the address says how deep the browsing is: the groups, a group’s types, or a type’s pieces', () => {
    expect(init()).toMatchObject({ group: Option.none(), type: Option.none() })
    expect(init({ group: 'shoes' })).toMatchObject({ group: Option.some('shoes'), type: Option.none() })
    expect(init({ group: 'shoes', type: 'boots' })).toMatchObject({
      group: Option.some('shoes'),
      type: Option.some('boots'),
    })
    // A type that is not of the group is not shown under it.
    expect(init({ group: 'shoes', type: 'jeans' }).type).toEqual(Option.none())
    // Sportswear is the Sport group's, as in a shop (T-07).
    expect(init({ group: 'sport', type: 'sportswear' }).type).toEqual(Option.some('sportswear'))
    const browsing = restore(init({ group: 'shoes', type: 'boots' }), {})
    expect(browsing).toMatchObject({ group: Option.none(), type: Option.none() })
  })

  test('a category’s card shows its newest piece', () => {
    const older = pieceFixture('older', { createdAt: '2026-10-01T10:00:00.000Z' })
    const newer = pieceFixture('newer', { createdAt: '2026-11-02T10:00:00.000Z' })
    expect(newestOf([older, newer])).toEqual(Option.some(newer))
    expect(newestOf([newer, older])).toEqual(Option.some(newer))
    expect(newestOf([])).toEqual(Option.none())
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
