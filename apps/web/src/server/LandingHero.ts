import { LandingHero, landingHeroCookie, landingHeroCookieSeconds, landingHeroes } from '@styld/protocol'
import { Effect, Option, Random, Schema } from 'effect'

// Which film the signed-out Home opens on (owner, 4 November 2026). The server chooses, so the page it renders and the
// page the browser hydrates show the same one: `?hero=` forces one for a preview; otherwise the visitor's cookie keeps
// the one they got first, and a first visit gets one at random and the cookie with it. The edge counts each landing
// shown and each sign-in begun by the hero it names in `countHeader` (`EdgeWorker.ts`), so the measurement needs no
// tracker and no person: only the hero's name.

const isHero = Schema.is(LandingHero)

/** The response header naming what the edge counts; it never leaves the edge. Named again in `EdgeWorker.ts`, which
 * may export nothing but its entrypoint. */
export const countHeader = 'x-styld-count'

/** The hero this browser's cookie keeps, if any. */
export const heroInCookies = (cookies: string | null | undefined): Option.Option<LandingHero> =>
  Option.fromNullishOr(
    (cookies ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${landingHeroCookie}=`))
      .map((part) => part.slice(landingHeroCookie.length + 1))
      .find(isHero),
  )

/** The cookie that keeps `hero`: first-party, readable by no script, sent only to Styld. */
export const heroCookie = (hero: LandingHero, url: URL): string =>
  `${landingHeroCookie}=${hero}; Path=/; Max-Age=${String(landingHeroCookieSeconds)}; HttpOnly; SameSite=Lax` +
  (url.protocol === 'https:' ? '; Secure' : '')

/** What a request shows: the hero, whether it was forced, and the cookie to set when it is a first choice. */
export interface HeroChoice {
  readonly hero: LandingHero
  readonly forced: boolean
  readonly setCookie: Option.Option<string>
}

/** The hero for this request: forced by `?hero=`, kept by the cookie, or chosen now. */
export const chooseHero = (request: Request): Effect.Effect<HeroChoice> =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    const forced = url.searchParams.get('hero')
    if (isHero(forced)) return { hero: forced, forced: true, setCookie: Option.none() }
    const kept = heroInCookies(request.headers.get('cookie'))
    if (Option.isSome(kept)) return { hero: kept.value, forced: false, setCookie: Option.none() }
    const hero = landingHeroes[yield* Random.nextIntBetween(0, landingHeroes.length, { halfOpen: true })] ?? 'wardrobe'
    return { hero, forced: false, setCookie: Option.some(heroCookie(hero, url)) }
  })
