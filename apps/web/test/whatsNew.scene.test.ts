import * as Challenges from '../src/page/Challenges.ts'
import { Option } from 'effect'
import { all, click, Command, expect, expectAll, given, inside, Mount, role, scene, selector } from 'foldkit/scene'
import { AsyncData } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import { FavouriteData, TrayData } from '../src/page/PickUp.ts'
import { FeedData, Message, More, ReadFeed, ReadMore, WatchListEnd } from '../src/page/WhatsNew.ts'
import { view } from '../src/View.ts'
import { at, withPage } from './AppFixtures.ts'
import { feedOf, generatedFeedOf } from './WhatsNewFixtures.ts'

// Home in Eva's order (4 November): the day, What's new along a strip, today's outfit, Challenges (coming soon),
// Pick up, and the rest of What's new, which reads more as it nears the screen or on Show more.

const home = (feed: FeedData, locale: 'en' | 'sl' = 'en') =>
  withPage(at('/', { signedIn: true, locale }), lenses.today, (today) =>
    modifyFields(today, {
      pickUp: () => ({
        tray: TrayData.Success({ data: { waiting: 0, pictures: [], allowance: { remaining: 97, daily: 100 } } }),
        favourite: FavouriteData.Success({ data: Option.none() }),
      }),
      whatsNew: () => ({ feed, more: More.Idle(), challenges: Challenges.init() }),
    }),
  )

const ids = (count: number) => Array.from({ length: count }, (_, index) => `b${index}`)

describe("Home's What's new", () => {
  test('the strip holds the eight newest, each a link with whose it is, and the rest come under earlier', () => {
    scene(
      { update, view },
      given(home(FeedData.Success({ data: feedOf(ids(10), null) }))),
      inside(
        role('region', { name: 'What’s new' }),
        expectAll(all.role('link', { name: /^Board b\d.*By nika\.kovac$/ })).toHaveCount(8),
      ),
      inside(
        role('region', { name: 'What’s new, earlier' }),
        expectAll(all.role('link', { name: /^Board b\d.*By nika\.kovac$/ })).toHaveCount(2),
        expect(role('button', { name: 'Show more' })).not.toExist(),
      ),
    )
  })

  test('Challenges come after the outfit, marked coming soon, with nothing to tap', () => {
    scene(
      { update, view },
      given(home(FeedData.Success({ data: feedOf([], null) }))),
      inside(
        role('region', { name: 'Challenges' }),
        expect(role('heading', { name: 'Challenges' })).toExist(),
        expect(role('listitem', { name: '30 days of red' })).toExist(),
        expect(role('link')).not.toExist(),
        expect(role('button')).not.toExist(),
      ),
      expect(role('region', { name: 'What’s new, earlier' })).not.toExist(),
    )
  })

  test('says when there is nothing new yet, and when the newest did not load, with Try again', () => {
    scene(
      { update, view },
      given(home(FeedData.Success({ data: feedOf([], null) }))),
      inside(
        role('region', { name: 'What’s new' }),
        expect(role('paragraph')).toHaveText('Nothing new yet. Boards and looks people share on Styld show up here.'),
      ),
    )
    scene(
      { update, view },
      given(home(FeedData.Failure({ error: 'Unavailable' }))),
      inside(role('region', { name: 'What’s new' }), click(role('button', { name: 'Try again' }))),
      Command.resolve(ReadFeed, Message.SucceededReadFeed({ feed: feedOf(['a'], null) })),
      expect(role('link', { name: /^Board a.*By/ })).toExist(),
    )
  })

  test('holds the strip’s shape while the newest come', () => {
    scene(
      { update, view },
      given(home(AsyncData.Loading())),
      inside(role('region', { name: 'What’s new' }), expect(selector('[data-skeleton]')).toExist()),
    )
  })

  test('the end of the list nearing the screen reads the next page, and Show more does too', () => {
    scene(
      { update, view },
      given(home(FeedData.Success({ data: feedOf(ids(9), 'c1') }))),
      Mount.resolve(WatchListEnd, Message.ReachedListEnd({ cursor: 'c1' })),
      Command.resolve(ReadMore, Message.SucceededReadMore({ cursor: 'c1', feed: feedOf(['z'], null) })),
      // The list has no next page, so its watcher goes.
      Mount.expectEnded(WatchListEnd),
      inside(
        role('region', { name: 'What’s new, earlier' }),
        expectAll(all.role('link', { name: /^Board [bz]\d?.*By/ })).toHaveCount(2),
        expect(role('button', { name: 'Show more' })).not.toExist(),
      ),
    )
  })

  test.each([
    ['en', 'Generated', 'Pieces generated with AI, for inspiration'],
    ['sl', 'Ustvarjeno', 'Kosi, ustvarjeni z umetno inteligenco, za navdih'],
  ] as const)('a house board of generated garments is marked so, always shown (%s)', (locale, mark, hint) => {
    scene(
      { update, view },
      given(home(FeedData.Success({ data: generatedFeedOf(['h1']) }), locale)),
      inside(
        role('region', { name: locale === 'en' ? 'What’s new' : 'Novosti' }),
        expect(selector(`[title="${hint}"]`)).toHaveText(mark),
      ),
    )
  })
})
