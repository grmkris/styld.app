import { Explore, PublicProfile, SearchResults } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { Work } from '../src/page/People.ts'
import {
  ExploreSearch,
  FocusExploreResults,
  FocusExploreSearch,
  FollowSuggested,
  init,
  Message,
  SearchExplore,
  suggestionOf,
  Target,
  update,
} from '../src/page/Visit.ts'

const profile = (yours: boolean) =>
  Schema.decodeUnknownSync(PublicProfile)({
    handle: 'nika.kovac',
    name: 'Nika Kovač',
    city: null,
    bio: null,
    tone: 'clay',
    boards: [],
    looks: [],
    pieces: null,
    yours,
  })

/** The Commands the person page sends once the profile is in. */
const loaded = (signedIn: boolean, yours: boolean) =>
  (
    update(
      init(Target.Person({ handle: 'nika.kovac' }), signedIn),
      Message.SucceededLoadPerson({ profile: profile(yours) }),
    ).commands ?? []
  ).map((command) => command.name)

test("reads where the visitor stands with a person only when signed in on someone else's profile", () => {
  expect(loaded(false, false)).toEqual([])
  expect(loaded(true, true)).toEqual([])
  expect(loaded(true, false)).toEqual(['LoadRelation'])
})

const explore = init(Target.Explore({ mood: Option.none() }), false)
const nika = Schema.decodeUnknownSync(SearchResults)({
  people: [{ handle: 'nika.kovac', name: 'Nika Kovač', tone: 'clay' }],
  boards: [],
})

describe('a profile', () => {
  test('opens on the first tab with something public in it, and on Boards when nothing is', () => {
    const knit = {
      id: `pc_${'knit'.padEnd(22, 'x')}`,
      name: 'Navy knit',
      category: 'top',
      subcategory: null,
      colours: [],
    }
    const onlyPieces = Schema.decodeUnknownSync(PublicProfile)({ ...profile(false), pieces: [knit] })
    const visiting = init(Target.Person({ handle: 'nika.kovac' }), false)
    expect(update(visiting, Message.SucceededLoadPerson({ profile: onlyPieces })).model.tab).toBe('pieces')
    expect(update(visiting, Message.SucceededLoadPerson({ profile: profile(false) })).model.tab).toBe('boards')
  })
})

describe('searching Explore', () => {
  test('Enter searches the trimmed words, signed out too, and focus moves to what was found', () => {
    story(
      update,
      given(explore),
      message(Message.UpdatedSearchQuery({ value: '  nika ' })),
      Command.expectNone(),
      message(Message.SubmittedSearch()),
      model(({ search }) => expect(search).toEqual(ExploreSearch.Searching({ query: 'nika' }))),
      Command.resolve(
        SearchExplore({ query: 'nika' }),
        Message.SucceededSearchExplore({ query: 'nika', results: nika }),
      ),
      model(({ search }) => expect(search).toEqual(ExploreSearch.Found({ query: 'nika', results: nika }))),
      Command.resolve(FocusExploreResults, Message.CompletedFocusExploreResults()),
    )
  })

  test('a blank search brings the sections back and sends nothing', () => {
    story(
      update,
      given(explore),
      message(Message.UpdatedSearchQuery({ value: '   ' })),
      message(Message.SubmittedSearch()),
      Command.expectNone(),
      model(({ search }) => expect(search).toEqual(ExploreSearch.Off())),
    )
  })

  test('an answer for words searched before is dropped, and typing on keeps focus in the field', () => {
    story(
      update,
      given({ ...explore, query: 'nika', search: ExploreSearch.Searching({ query: 'nika' }) }),
      message(Message.SucceededSearchExplore({ query: 'nik', results: nika })),
      model(({ search }) => expect(search).toEqual(ExploreSearch.Searching({ query: 'nika' }))),
      message(Message.UpdatedSearchQuery({ value: 'nika k' })),
      message(Message.SucceededSearchExplore({ query: 'nika', results: nika })),
      Command.expectNone(),
      model(({ search }) => expect(search).toEqual(ExploreSearch.Found({ query: 'nika', results: nika }))),
    )
  })

  test('a failed search says so and tries again; clearing empties the field and goes back to it', () => {
    story(
      update,
      given({ ...explore, query: 'nika', search: ExploreSearch.Searching({ query: 'nika' }) }),
      message(Message.FailedSearchExplore({ query: 'nika' })),
      model(({ search }) => expect(search).toEqual(ExploreSearch.Failed({ query: 'nika' }))),
      message(Message.ClickedRetrySearch()),
      Command.resolve(SearchExplore({ query: 'nika' }), Message.FailedSearchExplore({ query: 'nika' })),
      message(Message.ClickedClearSearch()),
      model(({ query, search }) => {
        expect(query).toBe('')
        expect(search).toEqual(ExploreSearch.Off())
      }),
      Command.resolve(FocusExploreSearch, Message.CompletedFocusExploreSearch()),
    )
  })
})

describe('following from Explore', () => {
  const nikaHandle = 'nika.kovac'
  const empty = Schema.decodeUnknownSync(Explore)({ edits: [], featured: [], people: [], newest: [] })

  test('follows someone suggested, waits for one change at a time, and keeps their standing when a change fails', () => {
    story(
      update,
      given(init(Target.Explore({ mood: Option.none() }), true)),
      message(Message.ClickedFollowSuggested({ handle: nikaHandle, following: true })),
      model((current) => {
        expect(suggestionOf(current, nikaHandle)).toEqual({ following: false, work: Work.Sending() })
        const tappedAgain = update(current, Message.ClickedFollowSuggested({ handle: nikaHandle, following: true }))
        expect(tappedAgain.commands).toBeUndefined()
      }),
      Command.resolve(
        FollowSuggested({ handle: nikaHandle, following: true }),
        Message.SucceededFollowSuggested({ handle: nikaHandle, following: true }),
      ),
      model((current) => expect(suggestionOf(current, nikaHandle)).toEqual({ following: true, work: Work.Idle() })),
      message(Message.ClickedFollowSuggested({ handle: nikaHandle, following: false })),
      Command.resolve(
        FollowSuggested({ handle: nikaHandle, following: false }),
        Message.FailedFollowSuggested({ handle: nikaHandle }),
      ),
      model((current) => expect(suggestionOf(current, nikaHandle)).toEqual({ following: true, work: Work.Failed() })),
    )
  })

  test('a fresh Explore starts its Follow buttons over: those already followed are no longer suggested', () => {
    story(
      update,
      given(init(Target.Explore({ mood: Option.none() }), true)),
      message(Message.SucceededFollowSuggested({ handle: nikaHandle, following: true })),
      message(Message.SucceededLoadExplore({ explore: empty })),
      model((current) => expect(current.suggestions).toEqual({})),
    )
  })
})
