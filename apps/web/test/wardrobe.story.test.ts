import { Option } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'
import { AppRoute, browseRouter, routeFromUrl } from '../src/route.ts'
import {
  brandsOf,
  CategoryEdit,
  type Context,
  DeleteCategory,
  init,
  Message,
  newestOf,
  OutMessage,
  RenameCategory,
  ReplaceBrowse,
  shownPieces,
  update,
} from '../src/page/Wardrobe.ts'
import { type Browse, browseGroup, browseType, noFilters, unfiltered } from '../src/WardrobeBrowse.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

// The wardrobe's browse lives only in its address (Foldkit's query-sync): the page reads it from the route, a filter
// replaces the address, and each parameter is read leniently, so an old or broken link opens the wardrobe without the
// part that is not ours instead of Not found.

/** The page's update while the address shows `browse`. */
const at = (browse: Browse) => (current: Parameters<typeof update>[0], next: Message) =>
  update(current, next, { maybeBrowse: Option.some(browse) } satisfies Context)

/** What the address `path` shows. */
const browseAt = (path: string): Option.Option<Browse> =>
  Option.flatMap(fromString(`https://styld.test${path}`), (url) => {
    const route = routeFromUrl(url)
    return AppRoute.guards.Wardrobe(route) ? Option.some(route.browse) : Option.none()
  })

const flats = browseType('flats')
const filtered = (filters: Partial<Browse['filters']>) =>
  modifyFields(flats, { filters: () => ({ ...noFilters, ...filters }) })

describe("the wardrobe's address", () => {
  test('prints what is browsed, filters included, and reads it back the same', () => {
    const browse = filtered({
      colours: ['blue', 'beige'],
      season: Option.some('winter'),
      rainproof: true,
      occasion: Option.some('smart'),
      brand: Option.some('COS'),
    })
    const path = browseRouter({ browse })
    expect(decodeURIComponent(path)).toBe(
      '/wardrobe?group=shoes&type=flats&colours=blue,beige&season=winter&rainproof=yes&occasion=smart&brand=COS',
    )
    expect(browseAt(path)).toEqual(Option.some(browse))
    expect(browseRouter({ browse: unfiltered })).toBe('/wardrobe')
    expect(browseRouter({ browse: browseType('sportswear', Option.some('Ski pants')) })).toBe(
      '/wardrobe?group=sport&type=sportswear&category=Ski+pants',
    )
  })

  test('a part that is not ours is left out, never Not found', () => {
    expect(browseAt('/wardrobe?group=nonsense')).toEqual(Option.some(unfiltered))
    // A type outside its group, or a type with no group, shows the group alone, or the groups.
    expect(browseAt('/wardrobe?group=shoes&type=jeans')).toEqual(Option.some(browseGroup('shoes')))
    expect(browseAt('/wardrobe?type=boots')).toEqual(Option.some(unfiltered))
    // A category and filters belong to a type.
    expect(browseAt('/wardrobe?group=sport&category=Ski+pants&colours=red')).toEqual(Option.some(browseGroup('sport')))
    expect(
      browseAt('/wardrobe?group=shoes&type=flats&colours=blue,teal,blue&rainproof=no&season=monsoon&brand='),
    ).toEqual(Option.some(filtered({ colours: ['blue'] })))
    expect(browseAt('/wardrobe?group=shoes&type=flats&rainproof=1')).toEqual(Option.some(flats))
  })
})

describe('the wardrobe tab', () => {
  test('a wardrobe that cannot load asks the app for its pieces again on retry', () => {
    story(
      at(unfiltered),
      given(init()),
      message(Message.ClickedRetry()),
      Command.expectNone(),
      model((current) => expect(current).toEqual(init())),
      expectOutMessage(OutMessage.RequestedPieces()),
    )
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
  const coat = pieceFixture('coat', { type: 'coats', colours: ['beige'], seasons: ['autumn', 'winter'], brand: 'COS' })
  const tee = pieceFixture('tee', {
    type: 'shortSleeveTops',
    colours: ['white'],
    seasons: ['summer'],
    occasions: ['casual'],
  })
  const jeans = pieceFixture('jeans', {
    type: 'jeans',
    colours: ['blue'],
    seasons: [],
    rainproof: true,
    brand: 'Levi’s',
  })
  const pieces = [coat, tee, jeans]
  const everything = modifyFields(unfiltered, { filters: () => noFilters })
  const shown = (filters: Partial<Browse['filters']>) =>
    shownPieces(pieces, modifyFields(everything, { filters: () => ({ ...noFilters, ...filters }) })).map(({ id }) => id)

  test('any chosen colour, the season (pieces with no season too), Rainproof, the occasion and the brand narrow the grid', () => {
    expect(shown({ season: Option.some('winter') })).toEqual([coat.id, jeans.id])
    expect(shown({ season: Option.some('winter'), rainproof: true })).toEqual([jeans.id])
    expect(shown({ colours: ['blue', 'beige'] })).toEqual([coat.id, jeans.id])
    expect(shown({ colours: ['blue', 'beige'], brand: Option.some('COS') })).toEqual([coat.id])
    expect(shown({ colours: ['blue', 'beige'], occasion: Option.some('casual') })).toEqual([])
    expect(shown({})).toEqual([coat.id, tee.id, jeans.id])
  })

  test('each filter replaces the address with the browse it makes; choosing one again clears it', () => {
    const winter = filtered({ season: Option.some('winter') })
    story(
      at(flats),
      given(init()),
      message(Message.ChoseFilterSeason({ season: 'winter' })),
      Command.expectExact(ReplaceBrowse({ browse: winter })),
      Command.resolve(ReplaceBrowse, Message.CompletedReplaceBrowse()),
      // The page keeps no copy: only the address changes.
      model((current) => expect(current).toEqual(init())),
    )
    story(
      at(winter),
      given(init()),
      message(Message.ChoseFilterSeason({ season: 'winter' })),
      Command.expectExact(ReplaceBrowse({ browse: flats })),
      Command.resolve(ReplaceBrowse, Message.CompletedReplaceBrowse()),
    )
    story(
      at(winter),
      given(init()),
      message(Message.ToggledFilterColour({ colour: 'blue' })),
      Command.expectExact(ReplaceBrowse({ browse: filtered({ season: Option.some('winter'), colours: ['blue'] }) })),
      Command.resolve(ReplaceBrowse, Message.CompletedReplaceBrowse()),
    )
    story(
      at(filtered({ colours: ['blue'], rainproof: true })),
      given(init()),
      message(Message.ClickedClearFilters()),
      Command.expectExact(ReplaceBrowse({ browse: flats })),
      Command.resolve(ReplaceBrowse, Message.CompletedReplaceBrowse()),
    )
  })

  test('with no wardrobe on screen a filter changes nothing', () => {
    expect(update(init(), Message.ToggledFilterRainproof(), { maybeBrowse: Option.none() }).commands ?? []).toEqual([])
  })

  test('offers the brands written on the pieces, once each, in order', () => {
    expect(brandsOf([...pieces, pieceFixture('bag', { brand: 'COS' })])).toEqual(['COS', 'Levi’s'])
  })
})

describe("a category of the person's own, from its page (T-12)", () => {
  const skiPants = browseType('sportswear', Option.some('Ski pants'))

  test('renamed: its pieces move to the new name, the address shows it, and the app reads the pieces again', () => {
    story(
      at(skiPants),
      given(init()),
      message(Message.ClickedRenameCategory()),
      model(({ categoryEdit }) =>
        expect(categoryEdit).toEqual(CategoryEdit.Renaming({ name: 'Ski pants', sending: false, failed: false })),
      ),
      message(Message.UpdatedCategoryName({ value: ' Snow trousers ' })),
      message(Message.SubmittedCategoryName()),
      Command.expectExact(RenameCategory({ type: 'sportswear', name: 'Ski pants', to: 'Snow trousers' })),
      Command.resolve(
        RenameCategory,
        Message.SucceededRenameCategory({ type: 'sportswear', name: 'Ski pants', to: 'Snow trousers' }),
      ),
      Command.expectExact(ReplaceBrowse({ browse: browseType('sportswear', Option.some('Snow trousers')) })),
      model(({ categoryEdit }) => expect(categoryEdit).toEqual(CategoryEdit.Idle())),
      expectOutMessage(OutMessage.RequestedPieces()),
      Command.resolve(ReplaceBrowse, Message.CompletedReplaceBrowse()),
    )
  })

  test('deleted after asking: the address shows the plain type, and a failed try says so', () => {
    story(
      at(skiPants),
      given(init()),
      message(Message.ClickedDeleteCategory()),
      message(Message.ClickedConfirmDeleteCategory()),
      Command.expectExact(DeleteCategory({ type: 'sportswear', name: 'Ski pants' })),
      Command.resolve(DeleteCategory, Message.FailedCategoryEdit()),
      model(({ categoryEdit }) =>
        expect(categoryEdit).toEqual(CategoryEdit.Deleting({ sending: false, failed: true })),
      ),
      message(Message.ClickedConfirmDeleteCategory()),
      Command.resolve(DeleteCategory, Message.SucceededDeleteCategory({ type: 'sportswear', name: 'Ski pants' })),
      Command.expectExact(ReplaceBrowse({ browse: browseType('sportswear') })),
      expectOutMessage(OutMessage.RequestedPieces()),
      Command.resolve(ReplaceBrowse, Message.CompletedReplaceBrowse()),
    )
  })

  test('a rename that lands after the person browsed elsewhere leaves the address alone', () => {
    const landed = at(browseGroup('shoes'))(
      init(),
      Message.SucceededRenameCategory({ type: 'sportswear', name: 'Ski pants', to: 'Snow trousers' }),
    )
    expect(landed.commands ?? []).toEqual([])
    expect(landed.outMessage).toEqual(OutMessage.RequestedPieces())
  })

  test('the same name again, or none, sends nothing', () => {
    const renaming = at(skiPants)(init(), Message.ClickedRenameCategory()).model
    expect(at(skiPants)(renaming, Message.SubmittedCategoryName()).commands ?? []).toEqual([])
    const emptied = at(skiPants)(renaming, Message.UpdatedCategoryName({ value: '  ' })).model
    expect(at(skiPants)(emptied, Message.SubmittedCategoryName()).commands ?? []).toEqual([])
  })
})
