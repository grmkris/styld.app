import { Option, Schema } from 'effect'
import { Dialog } from '@foldkit/ui'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { storySheetMoved } from './SheetFixtures.ts'
import * as Ask from '../src/page/Ask.ts'
import { PublicSearch } from '../src/page/Search.ts'
import { normalise, SearchResults } from '@styld/protocol'
import { matching } from '../src/page/AskSearch.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const knit = pieceFixture('knit', {
  type: 'shortSleeveTops',
  colours: ['navy'],
  name: 'Cable knit',
})
const shirt = pieceFixture('shirt', { type: 'shortSleeveTops', colours: ['blue'], name: 'Oxford shirt' })
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

// Ask's search lives only in its address (Foldkit's query-sync): the field shows `?q` as typed, a key replaces the
// address at once, and people and boards are searched once typing pauses.

/** Ask's update while the address shows `query`. */
const atQuery = (query: string) => (current: Ask.Model, next: Ask.Message) =>
  Ask.update(current, next, { query } satisfies Ask.Context)

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
      atQuery(''),
      given(Ask.init()),
      message(Ask.Message.SucceededLoadSearchLanguages()),
      model((current) => expect(Ask.SearchLanguages.guards.Both(current.languages)).toBe(true)),
    )
    expect(Ask.enter(Option.none())(Ask.init()).commands?.map(({ name }) => name)).toEqual(['LoadSearchLanguages'])
    expect(Ask.enter(Option.none())({ ...Ask.init(), languages: Ask.SearchLanguages.Both() }).commands ?? []).toEqual(
      [],
    )
    // Opening Ask at a search (Back, a reload, a link) searches people and boards for it at once.
    expect(
      Ask.enter(Option.some('knit'))({ ...Ask.init(), languages: Ask.SearchLanguages.Both() }).commands?.map(
        ({ name, args }) => ({ name, args }),
      ),
    ).toEqual([{ name: Ask.SearchPublic.name, args: { query: 'knit', revision: 1 } }])
  })

  test('every key replaces the address at once, as typed; people and boards are searched once typing pauses', () => {
    story(
      atQuery(''),
      given(Ask.init()),
      // A trailing space stays in the address (the field reads it back) and the words are searched without it.
      message(Ask.Message.UpdatedQuery({ value: 'knit ' })),
      Command.expectExact(Ask.ReplaceQuery({ q: 'knit ' }), Ask.WaitBeforeSearching({ query: 'knit', revision: 1 })),
      Command.resolve(Ask.ReplaceQuery, Ask.Message.CompletedReplaceQuery()),
      Command.resolve(Ask.WaitBeforeSearching, Ask.Message.ElapsedSearchPause({ query: 'knit', revision: 1 })),
      Command.expectExact(Ask.SearchPublic({ query: 'knit', revision: 1 })),
      Command.resolve(
        Ask.SearchPublic,
        Ask.Message.SucceededSearchPublic({ query: 'knit', revision: 1, results: knitResults }),
      ),
      model((searched) => expect(searched.search).toEqual(PublicSearch.Found({ query: 'knit', results: knitResults }))),
    )
    // The same words again (a space added) only replace the address; a pause for words since changed searches nothing.
    story(
      atQuery('knit'),
      given({ ...Ask.init(), revision: 2, search: PublicSearch.Waiting({ query: 'knit' }) }),
      message(Ask.Message.UpdatedQuery({ value: 'knit ' })),
      Command.expectExact(Ask.ReplaceQuery({ q: 'knit ' })),
      Command.resolve(Ask.ReplaceQuery, Ask.Message.CompletedReplaceQuery()),
      message(Ask.Message.ElapsedSearchPause({ query: 'kn', revision: 1 })),
      Command.expectNone(),
      model(({ search }) => expect(search).toEqual(PublicSearch.Waiting({ query: 'knit' }))),
    )
  })

  test('people and boards found for an older query are dropped', () => {
    story(
      atQuery('knitwear'),
      given({ ...Ask.init(), search: PublicSearch.Searching({ query: 'knitwear' }) }),
      message(Ask.Message.SucceededSearchPublic({ query: 'knit', revision: 0, results: knitResults })),
      model((searched) => expect(searched.search).toEqual(PublicSearch.Searching({ query: 'knitwear' }))),
    )
  })

  test('a public search that fails is marked failed for its words, and not for words typed since', () => {
    story(
      atQuery('knit'),
      given({ ...Ask.init(), search: PublicSearch.Searching({ query: 'knit' }) }),
      message(Ask.Message.FailedSearchPublic({ query: 'knit', revision: 0 })),
      model((searched) => expect(searched.search).toEqual(PublicSearch.Failed({ query: 'knit' }))),
      message(Ask.Message.FailedSearchPublic({ query: 'kn', revision: 0 })),
      model((searched) => expect(searched.search).toEqual(PublicSearch.Failed({ query: 'knit' }))),
    )
  })

  test('Enter searches what waits at once and shows what was found; clearing empties the address and the search', () => {
    story(
      atQuery('shoes'),
      given({ ...Ask.init(), revision: 3, search: PublicSearch.Waiting({ query: 'shoes' }) }),
      message(Ask.Message.SubmittedSearch()),
      Command.expectExact(Ask.SearchPublic({ query: 'shoes', revision: 4 }), Ask.FocusResults),
      Command.resolve(Ask.SearchPublic, Ask.Message.FailedSearchPublic({ query: 'shoes', revision: 4 })),
      Command.resolve(Ask.FocusResults, Ask.Message.CompletedFocus()),
      message(Ask.Message.ClickedClear()),
      model(({ search }) => expect(search).toEqual(PublicSearch.Off())),
      Command.expectExact(Ask.ReplaceQuery({ q: '' }), Ask.FocusSearch),
      Command.resolve(Ask.ReplaceQuery, Ask.Message.CompletedReplaceQuery()),
      Command.resolve(Ask.FocusSearch, Ask.Message.CompletedFocus()),
    )
  })

  test('the address moving within Ask: our own replace changes nothing; other words are searched at once', () => {
    const waiting = { ...Ask.init(), revision: 1, search: PublicSearch.Waiting({ query: 'knit' }) }
    expect(Ask.informQuery(Option.some('knit '))(waiting).commands ?? []).toEqual([])
    expect(Ask.informQuery(Option.some('boots'))(waiting).commands?.map(({ name, args }) => ({ name, args }))).toEqual([
      { name: Ask.SearchPublic.name, args: { query: 'boots', revision: 2 } },
    ])
    expect(Ask.informQuery(Option.none())(waiting).model.search).toEqual(PublicSearch.Off())
  })

  test('the + opens the sheet as a dialog, and leaving Ask closes it', () => {
    story(
      atQuery(''),
      given(Ask.init()),
      message(Ask.Message.ClickedAdd()),
      model(({ addSheet }) => expect(addSheet.isOpen).toBe(true)),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      ...storySheetMoved(1),
    )
    const open = atQuery('')(Ask.init(), Ask.Message.ClickedAdd()).model
    expect(Ask.leave(open).model.addSheet.isOpen).toBe(false)
  })
})
