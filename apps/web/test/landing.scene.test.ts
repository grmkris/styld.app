import {
  all,
  expect,
  expectAll,
  first,
  given,
  inside,
  last,
  Mount,
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
import { Message as LandingMessage, StartFilm } from '../src/page/Landing.ts'
import { view } from '../src/View.ts'
import { at } from './AppFixtures.ts'
import { landingWaits } from './LandingFixtures.ts'
import { opened } from './VisitFixtures.ts'

// The signed-out Home (owner, 4 November 2026): the wardrobe's film for everyone, then one full screen per feature
// (the wardrobe as a shop, one piece in many outfits, try-on, the turning rail, Ask Styld), then the way in, the price
// and four questions.

/** The landing as the server renders it, in `locale`. */
const landing = (locale: 'en' | 'sl' = 'en') =>
  modifyFields(at('/', { signedIn: false, locale }), { session: () => Session.SignedOut() })

/** Everything below the hero waits for the screen, which the scene has none of. */
const belowWaits = [landingWaits]
const filmPlays = Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: true }))
/** A landing Message arriving later from a running Mount's stream or the tour's Subscription. */
const arrives = (message: LandingMessage) => Subscription.emit(AppMessage.GotLandingMessage({ message }))

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
      expect(role('region', { name: 'In ChatGPT and Claude' })).toExist(),
      expect(role('heading', { name: 'Add it once' })).not.toExist(),
      expect(role('heading', { name: 'Try it with your wardrobe' })).not.toExist(),
    )
  })

  test("the rail hangs the landing's five pieces for its player, which only the pointer drives", () => {
    scene(
      { update, view },
      given(landing()),
      filmPlays,
      ...belowWaits,
      inside(
        role('region', { name: 'Every side of it' }),
        expect(role('img', { name: /hang on an oak rail/ })).toExist(),
        expectAll(all.selector('[data-rail-piece]')).toHaveCount(5),
        expect(first(all.selector('[data-rail-piece]'))).toHaveAttr('data-rail-piece', 'coat-camel'),
        expect(selector('[data-rail-piece] canvas')).toHaveAttr('width', '384'),
      ),
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
      arrives(LandingMessage.ShowedChat({ chat: 'ask', shown: true })),
      inside(role('region', { name: 'Ask Styld' }), expect(selector('[data-play]')).toExist()),
      inside(role('region', { name: 'In ChatGPT and Claude' }), expect(selector('[data-play]')).not.toExist()),
    )
  })

  test("in ChatGPT and Claude, the visitor's question and Styld's card with pieces from their wardrobe", () => {
    scene(
      { update, view },
      given(landing()),
      filmPlays,
      ...belowWaits,
      inside(
        role('region', { name: 'In ChatGPT and Claude' }),
        expect(role('img', { name: /asks Styld what goes with a camel coat/ })).toExist(),
        expect(selector('img[src="/cdn/landing/shop-boots-black.webp"]')).toExist(),
      ),
      arrives(LandingMessage.ShowedChat({ chat: 'assistants', shown: true })),
      inside(role('region', { name: 'In ChatGPT and Claude' }), expect(selector('[data-play]')).toExist()),
    )
  })

  test('the ending: the plans and four questions, with no second title', () => {
    scene(
      { update, view },
      given(landing()),
      filmPlays,
      ...belowWaits,
      inside(
        role('region', { name: 'What it costs' }),
        expect(text('Try 3 cut-outs free, then from $4.99 a week. Every plan gives you 500 credits a day.')).toExist(),
        expect(first(all.selector('dt'))).toHaveText('Week'),
        expect(last(all.selector('dt'))).toHaveText('Lifetime'),
        expect(text('Who can see my wardrobe?')).toExist(),
        expect(text('Can I delete everything?')).toExist(),
      ),
      expect(text('Start with one photo.')).not.toExist(),
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
