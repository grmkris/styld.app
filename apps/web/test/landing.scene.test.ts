import { all, click, expect, first, given, inside, last, Mount, nth, role, scene, selector, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Session, update } from '../src/App.ts'
import { Message as LandingMessage, PlayWhileSeen, StartFilm } from '../src/page/Landing.ts'
import { view } from '../src/View.ts'
import { at } from './AppFixtures.ts'
import { opened } from './VisitFixtures.ts'

// The signed-out Home (owner, 4 November 2026): the wardrobe's film for everyone, its words over it, no control, and
// the page below it.

/** The landing as the server renders it, in `locale`. */
const landing = (locale: 'en' | 'sl' = 'en') =>
  modifyFields(at('/', { signedIn: false, locale }), { session: () => Session.SignedOut() })

/** The clips below the film: they wait for the screen, which the scene has none of. */
const clipsWait = [
  Mount.resolveAll([PlayWhileSeen, LandingMessage.SawClip()], [PlayWhileSeen, LandingMessage.SawClip()]),
]

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
      Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: true })),
      ...clipsWait,
      // The film plays with nothing to press: no Pause, no Play.
      expect(role('button', { name: /film/i })).not.toExist(),
    )
    scene(
      { update, view },
      given(landing('sl')),
      expect(role('heading', { level: 1, name: 'Vsak videz se začne v tvoji garderobi.' })).toExist(),
      expect(role('link', { name: 'Začni brezplačno' })).toHaveAttr('href', '/login'),
      expect(role('heading', { name: 'Koliko stane' })).toExist(),
      Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: true })),
      ...clipsWait,
    )
  })

  test('with reduced motion, or a film the browser refused to start, the film goes and the poster stays', () => {
    scene(
      { update, view },
      given(landing()),
      Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: false })),
      ...clipsWait,
      Mount.expectEnded(StartFilm),
      inside(
        role('region', { name: 'Every outfit starts in your wardrobe.' }),
        expect(selector('video')).not.toExist(),
        expect(selector('img[src="/cdn/landing/wardrobe-poster-wide.webp"]')).toExist(),
      ),
    )
  })

  test('below the film: three feature screens, the price as a list, four questions and Start free again', () => {
    scene(
      { update, view },
      given(landing()),
      Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: true })),
      ...clipsWait,
      expect(role('heading', { level: 2, name: 'Add it once' })).toExist(),
      expect(role('heading', { level: 2, name: 'Your wardrobe, as a shop' })).toExist(),
      expect(role('heading', { level: 2, name: 'One piece, many outfits' })).toExist(),
      expect(selector('video[poster="/cdn/landing/scan-tall.webp"]')).toExist(),
      // The coat's wide film, cropped to its one board: the tall cut showed the boards beside it as a mirror.
      expect(selector('video[poster="/cdn/landing/coat-poster-wide.webp"]')).toExist(),
      inside(
        role('region', { name: 'What it costs' }),
        expect(text('Try 3 cut-outs free, then from $4.99 a week. Every plan gives you 500 credits a day.')).toExist(),
        expect(first(all.selector('dt'))).toHaveText('Week'),
        expect(first(all.selector('dd'))).toHaveText('$4.99 once, for 7 days'),
        expect(last(all.selector('dt'))).toHaveText('Lifetime'),
        expect(last(all.selector('dd'))).toHaveText('$349 once, never ends'),
      ),
      inside(
        role('region', { name: 'Questions' }),
        expect(text('Who can see my wardrobe?')).toExist(),
        expect(text('Do I need to install an app?')).toExist(),
        expect(text('What does it cost?')).toExist(),
        expect(text('Can I delete everything?')).toExist(),
        expect(text(/^Your first 3 cut-outs are free, no card\. Then a plan gives you 500 credits a day/)).toExist(),
      ),
      inside(
        role('region', { name: 'Start with one photo.' }),
        expect(role('link', { name: 'Start free' })).toHaveAttr('href', '/login'),
      ),
    )
  })

  test('the shop: six pieces at most, each already yours, and a chip finds its category among all of them', () => {
    scene(
      { update, view },
      given(landing()),
      Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: true })),
      ...clipsWait,
      inside(
        role('region', { name: 'Your wardrobe, as a shop' }),
        expect(role('button', { name: 'All' })).toHaveAttr('aria-pressed', 'true'),
        expect(nth(all.role('listitem'), 5)).toContainText('Already yours'),
        expect(nth(all.role('listitem'), 6)).not.toExist(),
        expect(selector('img[src="/cdn/landing/shop-coat-camel.webp"]')).toExist(),
        // Tan loafers are past the six All shows; Shoes finds them.
        expect(text('Tan loafers')).not.toExist(),
        click(role('button', { name: 'Shoes' })),
        expect(role('button', { name: 'Shoes' })).toHaveAttr('aria-pressed', 'true'),
        expect(role('button', { name: 'All' })).toHaveAttr('aria-pressed', 'false'),
        expect(text('Tan loafers')).toExist(),
        expect(nth(all.role('listitem'), 3)).not.toExist(),
        expect(selector('img[src="/cdn/landing/shop-coat-camel.webp"]')).not.toExist(),
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
      Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: true })),
      ...clipsWait,
    )
    scene(
      { update, view },
      given(opened('/login')),
      inside(role('banner'), expect(role('link', { name: 'Sign in' })).not.toExist()),
    )
  })
})
