import {
  all,
  Command,
  expect,
  first,
  given,
  inside,
  last,
  Mount,
  nth,
  role,
  scene,
  selector,
  Subscription,
  text,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Session, update } from '../src/App.ts'
import { Message as AppMessage } from '../src/Message.ts'
import {
  Message as LandingMessage,
  PlayWhileSeen,
  ScrollRail,
  StartFilm,
  WatchChat,
  WatchRail,
} from '../src/page/Landing.ts'
import { view } from '../src/View.ts'
import { at } from './AppFixtures.ts'
import { opened } from './VisitFixtures.ts'

// The signed-out Home (owner, 4 November 2026): the wardrobe's film for everyone, then one full screen per feature
// (the wardrobe as a shop, one piece in many outfits, try-on, the turning rail, Ask Styld), then the way in, the price
// and four questions.

/** The landing as the server renders it, in `locale`. */
const landing = (locale: 'en' | 'sl' = 'en') =>
  modifyFields(at('/', { signedIn: false, locale }), { session: () => Session.SignedOut() })

/** Everything below the hero waits for the screen, which the scene has none of. */
const belowWaits = [
  Mount.resolveAll(
    [PlayWhileSeen, LandingMessage.SawClip()],
    [PlayWhileSeen, LandingMessage.SawClip()],
    [PlayWhileSeen, LandingMessage.SawClip()],
    [WatchRail, LandingMessage.NearedRail()],
    [WatchChat, LandingMessage.ShowedChat({ shown: false })],
  ),
]
const filmPlays = Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: true }))
/** A landing Message arriving later from a running Mount's stream or the tour's Subscription. */
const arrives = (message: LandingMessage) => Subscription.emit(AppMessage.GotLandingMessage({ message }))
const tick = arrives(LandingMessage.TickedRailTour())

describe('the landing', () => {
  test("the hero: the wardrobe's poster in both shapes, its words and Start free, in English and Slovenian", () => {
    scene(
      { update, view },
      given(landing()),
      inside(
        role('region', { name: 'Every outfit starts in your wardrobe.' }),
        expect(role('heading', { level: 1, name: 'Every outfit starts in your wardrobe.' })).toExist(),
        expect(role('link', { name: 'Start free' })).toHaveAttr('href', '/login'),
        expect(selector('source')).toHaveAttr('srcset', '/cdn/landing/wardrobe-poster-tall.webp'),
        expect(selector('img')).toHaveAttr('src', '/cdn/landing/wardrobe-poster-wide.webp'),
        // No source until the browser has said it takes motion.
        expect(selector('video')).not.toHaveAttr('src'),
      ),
      filmPlays,
      ...belowWaits,
      // The films play with nothing to press: no Pause, no Play.
      expect(role('button', { name: /film/i })).not.toExist(),
    )
    scene(
      { update, view },
      given(landing('sl')),
      expect(role('heading', { level: 1, name: 'Vsak videz se začne v tvoji garderobi.' })).toExist(),
      expect(role('link', { name: 'Začni brezplačno' })).toExist(),
      expect(role('heading', { level: 2, name: 'Tvoja garderoba kot trgovina' })).toExist(),
      filmPlays,
      ...belowWaits,
    )
  })

  test('with reduced motion, or a film the browser refused to start, the film goes and the poster stays', () => {
    scene(
      { update, view },
      given(landing()),
      Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: false })),
      ...belowWaits,
      Mount.expectEnded(StartFilm),
      inside(
        role('region', { name: 'Every outfit starts in your wardrobe.' }),
        expect(selector('video')).not.toExist(),
        expect(selector('img[src="/cdn/landing/wardrobe-poster-wide.webp"]')).toExist(),
      ),
    )
  })

  test('one full screen per feature, each with its film or its own motion, and no scanner or try-with screens', () => {
    scene(
      { update, view },
      given(landing()),
      filmPlays,
      ...belowWaits,
      inside(
        role('region', { name: 'Your wardrobe, as a shop' }),
        expect(role('img', { name: /heap of clothes/ })).toExist(),
        expect(selector('img[src="/cdn/landing/pile-poster-wide.webp"]')).toExist(),
      ),
      inside(
        role('region', { name: 'One piece, many outfits' }),
        // The coat's tall cut is its one board; the earlier one showed the boards beside it as a mirror.
        expect(selector('source')).toHaveAttr('srcset', '/cdn/landing/coat-board-poster-tall.webp'),
        expect(selector('img')).toHaveAttr('src', '/cdn/landing/coat-poster-wide.webp'),
      ),
      inside(
        role('region', { name: 'See it on you' }),
        expect(selector('img[src="/cdn/landing/mirror-poster-wide.webp"]')).toExist(),
      ),
      expect(role('region', { name: 'Every side of it' })).toExist(),
      expect(role('region', { name: 'Ask Styld' })).toExist(),
      expect(role('heading', { name: 'Add it once' })).not.toExist(),
      expect(role('heading', { name: 'Try it with your wardrobe' })).not.toExist(),
    )
  })

  test('the rail turns the piece in front once it shows, tours on by itself, rests after a touch, and turns again on return', () => {
    scene(
      { update, view },
      given(landing()),
      filmPlays,
      ...belowWaits,
      expect(selector('#landing-rail [data-front]')).not.toExist(),
      arrives(LandingMessage.ShowedRail({ shown: true, moving: true })),
      expect(nth(all.selector('#landing-rail div'), 0)).toHaveAttr('data-front', ''),
      tick,
      Command.resolve(ScrollRail, LandingMessage.CompletedScrollRail()),
      expect(nth(all.selector('#landing-rail div'), 0)).not.toHaveAttr('data-front'),
      expect(nth(all.selector('#landing-rail div'), 1)).toHaveAttr('data-front', ''),
      // A swipe settles on the fourth piece; a touch then holds the tour for two beats.
      arrives(LandingMessage.SettledRail({ index: 3 })),
      arrives(LandingMessage.TouchedRail()),
      tick,
      tick,
      expect(nth(all.selector('#landing-rail div'), 3)).toHaveAttr('data-front', ''),
      tick,
      Command.resolve(ScrollRail, LandingMessage.CompletedScrollRail()),
      expect(nth(all.selector('#landing-rail div'), 4)).toHaveAttr('data-front', ''),
      // Off screen every piece shows its side, so the one in front turns again when the rail comes back.
      arrives(LandingMessage.ShowedRail({ shown: false, moving: true })),
      expect(selector('#landing-rail [data-front]')).not.toExist(),
    )
  })

  test("Ask Styld plays Styld's answer in each time its chat shows", () => {
    scene(
      { update, view },
      given(landing()),
      filmPlays,
      ...belowWaits,
      inside(
        role('region', { name: 'Ask Styld' }),
        expect(text('What should I wear to dinner on Friday?')).toExist(),
        expect(text(/^Your camel coat over the black turtleneck/)).toExist(),
        expect(selector('img[src="/cdn/landing/shop-loafers-tan.webp"]')).toExist(),
        expect(selector('[data-play]')).not.toExist(),
      ),
      arrives(LandingMessage.ShowedChat({ shown: true })),
      inside(role('region', { name: 'Ask Styld' }), expect(selector('[data-play]')).toExist()),
    )
  })

  test('the ending: Start free first, then the plans and four questions', () => {
    scene(
      { update, view },
      given(landing()),
      filmPlays,
      ...belowWaits,
      inside(
        role('region', { name: 'Start with one photo.' }),
        expect(role('link', { name: 'Start free' })).toHaveAttr('href', '/login'),
        expect(text('Try 3 cut-outs free, then from $4.99 a week. Every plan gives you 500 credits a day.')).toExist(),
        expect(first(all.selector('dt'))).toHaveText('Week'),
        expect(last(all.selector('dt'))).toHaveText('Lifetime'),
        expect(text('Who can see my wardrobe?')).toExist(),
        expect(text('Can I delete everything?')).toExist(),
      ),
    )
  })

  test('signed out, the bar offers Sign in, except on the sign-in page itself', () => {
    scene(
      { update, view },
      given(opened('/')),
      inside(
        role('banner'),
        expect(role('link', { name: 'Sign in' })).toHaveAttr('href', '/login'),
        expect(role('link', { name: 'Explore' })).not.toExist(),
      ),
      filmPlays,
      ...belowWaits,
    )
    scene(
      { update, view },
      given(opened('/login')),
      inside(role('banner'), expect(role('link', { name: 'Sign in' })).not.toExist()),
    )
  })
})
