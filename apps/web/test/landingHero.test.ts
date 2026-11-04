import { SessionHttp } from '@styld/auth/config'
import { Effect, Option } from 'effect'
import * as Server from 'foldkit/experimental/server'
import { describe, expect, test } from 'vitest'
import { renderDocument, renderRequest } from '../src/entry.server.ts'
import { heroInCookies } from '../src/server/LandingHero.ts'

// The hero is the server's choice (owner, 4 November 2026): the page it renders and the page the browser hydrates show
// the same film, a first visit gets one at random and a cookie that keeps it, and the edge counts what the response
// names in `x-styld-count`.

const assets = { entryScript: '/entry.js', stylesheets: [], modulePreloads: [] }

const headlines = {
  mirror: 'Try it on before you get dressed.',
  coat: 'One coat, six outfits.',
  wardrobe: 'Every outfit starts in your wardrobe.',
} as const

const render = async (path: string, cookie?: string) => {
  const result = await Effect.runPromise(
    renderRequest(
      new Request(`https://styld.test${path}`, {
        headers: { 'accept-language': 'en', ...(cookie === undefined ? {} : { cookie }) },
      }),
      { buildId: 'test-release' },
    ),
  )
  const response = Server.toResponse((app) => renderDocument(app, assets), result)
  return { response, html: await response.text() }
}

/** The hero the rendered page shows by its headline. */
const shownHero = (html: string) =>
  (['mirror', 'coat', 'wardrobe'] as const).filter((hero) => html.includes(headlines[hero]))

describe('the landing hero', () => {
  test('a first visit gets one hero at random, the cookie that keeps it, and its landing counted', async () => {
    const seen = new Set<string>()
    for (let visit = 0; visit < 12; visit++) {
      const { response, html } = await render('/')
      const cookie = response.headers.get('set-cookie') ?? ''
      expect(cookie).toMatch(
        /^styld_hero=(mirror|coat|wardrobe); Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/,
      )
      const hero = cookie.slice('styld_hero='.length, cookie.indexOf(';'))
      seen.add(hero)
      // The page shows that hero, and hands the same one to the browser in its flags, so hydration matches.
      expect(shownHero(html)).toEqual([hero])
      expect(html).toContain(`"landingHero":"${hero}"`)
      expect(response.headers.get('x-styld-count')).toBe(`landing.shown.${hero}`)
    }
    expect(seen.size).toBeGreaterThan(1)
  }, 30_000)

  test('a second visit shows the hero its cookie keeps, and sets no new cookie', async () => {
    for (const hero of ['mirror', 'coat', 'wardrobe'] as const) {
      const { response, html } = await render('/', `styld_locale=en; styld_hero=${hero}`)
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(shownHero(html)).toEqual([hero])
      expect(response.headers.get('x-styld-count')).toBe(`landing.shown.${hero}`)
    }
  })

  test('?hero= forces one for a preview, keeps no cookie and counts nothing', async () => {
    const { response, html } = await render('/?hero=mirror', 'styld_hero=coat')
    expect(shownHero(html)).toEqual(['mirror'])
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('x-styld-count')).toBeNull()
  })

  test('a cookie or ?hero= naming no hero is ignored', async () => {
    const { response } = await render('/?hero=../../admin', 'styld_hero=<script>')
    expect(response.headers.get('set-cookie')).toMatch(/^styld_hero=(mirror|coat|wardrobe);/)
    expect(Option.isNone(heroInCookies('styld_hero=<script>; other=1'))).toBe(true)
  })

  test('the sign-in page counts a sign-in begun by the hero this browser was shown', async () => {
    const shown = await render('/login', 'styld_hero=coat')
    expect(shown.response.headers.get('x-styld-count')).toBe('signin.started.coat')
    expect(shown.response.headers.get('set-cookie')).toBeNull()
    const never = await render('/login')
    expect(never.response.headers.get('x-styld-count')).toBeNull()
    expect(never.response.headers.get('set-cookie')).toBeNull()
  })

  test('someone with a session gets no landing, no cookie and no count', async () => {
    const { response } = await render('/', `${SessionHttp.cookieName}=x`)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('x-styld-count')).toBeNull()
  })
})
