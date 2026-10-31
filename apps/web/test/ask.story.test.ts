import { Option, Schema } from 'effect'
import { Dialog } from '@foldkit/ui'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { storySheetMoved } from './SheetFixtures.ts'
import * as Ask from '../src/page/Ask.ts'
import { normalise, SearchResults } from '@styld/protocol'
import { matching } from '../src/page/AskSearch.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const knit = pieceFixture('knit', {
  type: 'tops',
  colours: ['navy'],
  name: 'Cable knit',
})
const shirt = pieceFixture('shirt', { type: 'tops', colours: ['blue'], name: 'Oxford shirt' })
const shorts = pieceFixture('shorts', {
  type: 'shorts',
  colours: ['blue'],
  name: 'Denim shorts',
})
const trousers = pieceFixture('trousers', { type: 'trousers', colours: ['green'], name: null })
const derbies = pieceFixture('derbies', { type: 'trainers', colours: ['black'], name: 'Derby shoes' })
const jacket = pieceFixture('jacket', { type: 'jackets', colours: ['black'], name: null })
const dress = pieceFixture('dress', { type: 'dresses', colours: ['white'], name: null })
const drying = pieceFixture('drying', { type: 'trainers', status: 'processing', name: 'New boots' })
const wardrobe = [knit, shirt, shorts, trousers, derbies, jacket, dress, drying]
const found = (query: string, locales: ReadonlyArray<'en' | 'sl'>) =>
  matching(wardrobe, query, locales).map((piece) => piece.id)

const knitResults = Schema.decodeUnknownSync(SearchResults)({
  people: [{ handle: 'nika.kovac', name: 'Nika Kovač', tone: 'clay' }],
  boards: [],
})

describe('searching your wardrobe', () => {
  test('any case, accents or not, and commas between words', () => {
    expect(normalise('  Črne, ČEVLJI. ')).toBe('crne cevlji')
    expect(normalise('Đon')).toBe('don')
  })

  test('in English: by name, kind or colour, a word started or with an ending', () => {
    expect(found('knit', ['en'])).toEqual([knit.id])
    expect(found('green', ['en'])).toEqual([trousers.id])
    expect(found('Derby, shoes', ['en'])).toEqual([derbies.id])
    expect(found('SHOES', ['en'])).toEqual([derbies.id])
    expect(found('shoe', ['en'])).toEqual([derbies.id])
    expect(found('nothing like this', ['en'])).toEqual([])
  })

  test('in Slovenian: the words people use, with any ending, with or without č, š and ž', () => {
    const sl = ['sl'] as const
    expect(found('čevlji', sl)).toEqual([derbies.id])
    expect(found('cevlji', sl)).toEqual([derbies.id])
    expect(found('obutev', sl)).toEqual([derbies.id])
    expect(found('črne', sl)).toEqual([derbies.id, jacket.id])
    expect(found('modro', sl)).toEqual([knit.id, shirt.id, shorts.id])
    expect(found('jakna', sl)).toEqual([jacket.id])
    expect(found('obleka', sl)).toEqual([dress.id])
    expect(found('zelene hlače', sl)).toEqual([trousers.id])
    expect(found('modra, čevlji', sl)).toEqual([])
  })

  test('both languages at once, once the other has loaded, and only pieces that are ready', () => {
    // The jacket has no name: on a Slovenian page "outerwear" finds it only once English has loaded.
    expect(found('outerwear', ['sl'])).toEqual([])
    expect(found('outerwear', ['sl', 'en'])).toEqual([jacket.id])
    expect(found('boots', ['en'])).toEqual([])
    expect(found('', ['en'])).toHaveLength(7)
  })

  test('opening Ask loads the other language once', () => {
    story(
      Ask.update,
      given(Ask.init()),
      message(Ask.Message.SucceededLoadSearchLanguages()),
      model((current) => expect(Ask.SearchLanguages.guards.Both(current.languages)).toBe(true)),
    )
    expect(Ask.enter(Option.none())(Ask.init()).commands?.map(({ name }) => name)).toEqual(['LoadSearchLanguages'])
    expect(Ask.enter(Option.none())({ ...Ask.init(), languages: Ask.SearchLanguages.Both() }).commands).toBeUndefined()
    expect(Command).toBeDefined()
  })

  test('the address follows the search once typing pauses, and only the newest search is written', () => {
    story(
      Ask.update,
      given({ ...Ask.init(), query: 'knit' }),
      message(Ask.Message.ElapsedQueryPause({ query: 'kn' })),
      Command.expectNone(),
      message(Ask.Message.ElapsedQueryPause({ query: 'knit' })),
      Command.expectExact(Ask.WriteQuery, Ask.SearchPublic),
      Command.resolve(Ask.WriteQuery, Ask.Message.CompletedWriteQuery()),
      Command.resolve(Ask.SearchPublic, Ask.Message.SucceededSearchPublic({ query: 'knit', results: knitResults })),
      model((searched) => {
        expect(searched.query).toBe('knit')
        expect(searched.found).toEqual(Option.some({ query: 'knit', results: knitResults }))
      }),
    )
  })

  test('people and boards found for an older query are dropped', () => {
    story(
      Ask.update,
      given({ ...Ask.init(), query: 'knitwear' }),
      message(Ask.Message.SucceededSearchPublic({ query: 'knit', results: knitResults })),
      model((searched) => expect(searched.found).toEqual(Option.none())),
    )
  })

  test('Enter shows what was found; clearing empties the search and goes back to the field', () => {
    story(
      Ask.update,
      given({ ...Ask.init(), query: 'shoes' }),
      message(Ask.Message.SubmittedSearch()),
      Command.expectExact(Ask.WriteQuery, Ask.FocusResults),
      Command.resolve(Ask.WriteQuery, Ask.Message.CompletedWriteQuery()),
      Command.resolve(Ask.FocusResults, Ask.Message.CompletedFocus()),
      message(Ask.Message.ClickedClear()),
      model(({ query }) => expect(query).toBe('')),
      Command.expectExact(Ask.WriteQuery, Ask.FocusSearch),
      Command.resolve(Ask.WriteQuery, Ask.Message.CompletedWriteQuery()),
      Command.resolve(Ask.FocusSearch, Ask.Message.CompletedFocus()),
    )
  })

  test('the + opens the sheet as a dialog, and leaving Ask closes it', () => {
    story(
      Ask.update,
      given(Ask.init()),
      message(Ask.Message.ClickedAdd()),
      model(({ addSheet }) => expect(addSheet.isOpen).toBe(true)),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      ...storySheetMoved(1),
    )
    const open = Ask.update(Ask.init(), Ask.Message.ClickedAdd()).model
    expect(Ask.leave(open).model.addSheet.isOpen).toBe(false)
  })
})
