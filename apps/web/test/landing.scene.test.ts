import {
  all,
  click,
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
  text,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Session, update } from '../src/App.ts'
import { Message as LandingMessage, PlayWhileSeen, SetFilm, StartFilm } from '../src/page/Landing.ts'
import { view } from '../src/View.ts'
import { at } from './AppFixtures.ts'
import { opened } from './VisitFixtures.ts'

// The signed-out Home (owner, 4 November 2026): one of three heroes the server chose, its film over its words, and the
// one page below for all of them.

type Hero = 'mirror' | 'coat' | 'wardrobe'

/** The landing as the server renders it for `hero`, in `locale`. */
const landing = (hero: Hero, locale: 'en' | 'sl' = 'en') =>
  modifyFields(at('/', { signedIn: false, locale }), {
    session: () => Session.SignedOut(),
    context: (context) => ({ ...context, landingHero: hero }),
  })

/** The clips below the film: they wait for the screen, which the scene has none of. */
const clipsWait = [
  Mount.resolveAll([PlayWhileSeen, LandingMessage.SawClip()], [PlayWhileSeen, LandingMessage.SawClip()]),
]

const headlines: Record<Hero, { readonly en: string; readonly sl: string }> = {
  mirror: { en: 'Try it on before you get dressed.', sl: 'Pomerjaj, preden se oblečeš.' },
  coat: { en: 'One coat, six outfits.', sl: 'En plašč, šest videzov.' },
  wardrobe: { en: 'Every outfit starts in your wardrobe.', sl: 'Vsak videz se začne v tvoji garderobi.' },
}

describe('the landing', () => {
  for (const hero of ['mirror', 'coat', 'wardrobe'] as const) {
    test(`the ${hero} hero: its film's poster in both shapes, its words and Start free, in English and Slovenian`, () => {
      scene(
        { update, view },
        given(landing(hero)),
        inside(
          role('region', { name: headlines[hero].en }),
          expect(role('heading', { level: 1, name: headlines[hero].en })).toExist(),
          expect(role('link', { name: 'Start free' })).toHaveAttr('href', '/login'),
          expect(selector('source')).toHaveAttr('srcset', `/cdn/landing/${hero}-poster-tall.webp`),
          expect(selector('img')).toHaveAttr('src', `/cdn/landing/${hero}-poster-wide.webp`),
          // No source until the browser has said it takes motion.
          expect(selector('video')).not.toHaveAttr('src'),
        ),
        Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: true })),
        ...clipsWait,
      )
      scene(
        { update, view },
        given(landing(hero, 'sl')),
        expect(role('heading', { level: 1, name: headlines[hero].sl })).toExist(),
        expect(role('link', { name: 'Začni brezplačno' })).toHaveAttr('href', '/login'),
        expect(role('heading', { name: 'Koliko stane' })).toExist(),
        Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: true })),
        ...clipsWait,
      )
    })
  }

  test('the mirror hero still says Start free: try-on is not built', () => {
    scene(
      { update, view },
      given(landing('mirror')),
      expect(role('link', { name: 'Start free' })).toExist(),
      expect(role('link', { name: /try/i })).not.toExist(),
      Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: true })),
      ...clipsWait,
    )
  })

  test('with reduced motion the film goes and the poster stays, with no control', () => {
    scene(
      { update, view },
      given(landing('coat')),
      Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: false })),
      ...clipsWait,
      Mount.expectEnded(StartFilm),
      expect(selector('#landing-film')).not.toExist(),
      expect(selector('img[src="/cdn/landing/coat-poster-wide.webp"]')).toExist(),
      expect(role('button', { name: 'Pause the film' })).not.toExist(),
      expect(role('button', { name: 'Play the film' })).not.toExist(),
    )
  })

  test('the control follows the film: Play while refused, Pause once it plays, and a pause holds every clip', () => {
    scene(
      { update, view },
      given(landing('wardrobe')),
      expect(role('button', { name: 'Pause the film' })).not.toExist(),
      Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: true })),
      ...clipsWait,
      // The browser has not started it (iOS Low Power refuses): the control offers Play.
      expect(role('button', { name: 'Play the film' })).toExist(),
      click(role('button', { name: 'Play the film' })),
      Command.resolve(SetFilm, LandingMessage.CompletedSetFilm()),
      expect(selector('main[data-held]')).not.toExist(),
    )
  })

  test('below the film: three feature screens, the price as a list, four questions and Start free again', () => {
    scene(
      { update, view },
      given(landing('coat')),
      Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: true })),
      ...clipsWait,
      expect(role('heading', { level: 2, name: 'Add it once' })).toExist(),
      expect(role('heading', { level: 2, name: 'Your wardrobe, as a shop' })).toExist(),
      expect(role('heading', { level: 2, name: 'One piece, many outfits' })).toExist(),
      expect(selector('video[poster="/cdn/landing/scan-tall.webp"]')).toExist(),
      expect(selector('video[poster="/cdn/landing/outfits-tall.webp"]')).toExist(),
      inside(
        role('region', { name: 'What it costs' }),
        expect(first(all.selector('dt'))).toHaveText('Free'),
        expect(first(all.selector('dd'))).toContainText('100 credits every day, no card.'),
        expect(last(all.selector('dt'))).toHaveText('Premium week'),
        expect(last(all.selector('dd'))).toHaveText('$4.99 once: 500 credits a day for 7 days.'),
      ),
      inside(
        role('region', { name: 'Questions' }),
        expect(text('Who can see my wardrobe?')).toExist(),
        expect(text('Do I need to install an app?')).toExist(),
        expect(text('What does it cost?')).toExist(),
        expect(text('Can I delete everything?')).toExist(),
        expect(text(/^Nothing to start: 100 credits every day/)).toExist(),
      ),
      inside(
        role('region', { name: 'Start with one photo.' }),
        expect(role('link', { name: 'Start free' })).toHaveAttr('href', '/login'),
      ),
    )
  })

  test('the shop: every piece is already yours, and a chip shows only its category', () => {
    scene(
      { update, view },
      given(landing('coat')),
      Mount.resolve(StartFilm, LandingMessage.CheckedMotion({ moving: true })),
      ...clipsWait,
      inside(
        role('region', { name: 'Your wardrobe, as a shop' }),
        expect(role('button', { name: 'All' })).toHaveAttr('aria-pressed', 'true'),
        expect(nth(all.role('listitem'), 12)).toContainText('Already yours'),
        expect(selector('img[src="/cdn/landing/shop-coat-camel.webp"]')).toExist(),
        click(role('button', { name: 'Shoes' })),
        expect(role('button', { name: 'Shoes' })).toHaveAttr('aria-pressed', 'true'),
        expect(role('button', { name: 'All' })).toHaveAttr('aria-pressed', 'false'),
        expect(nth(all.role('listitem'), 2)).toContainText('Tan loafers'),
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
