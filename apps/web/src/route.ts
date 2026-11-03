import type { MessageKey } from '@styld/i18n'
import { BrowseQuery } from './WardrobeBrowse.ts'
import { Effect, Equivalence, Option, Schema, pipe } from 'effect'
import {
  defineRouteUnion,
  literal,
  mapTo,
  oneOf,
  param,
  ParseError,
  parseUrlWithFallback,
  query,
  root,
  slash,
  string,
} from 'foldkit/route'

/** Every page of the website. A route both parses its URL and builds its link. */
export const AppRoute = defineRouteUnion({
  Home: {},
  /** Sign-in; `next` is the page of this site to return to once signed in (`returnPath` checks it). */
  Login: { next: Schema.Option(Schema.String) },
  /** Sign-in for an assistant's connection: success returns to the OAuth authorization. */
  LoginForConnection: {},
  Account: {},
  /** The person's public profile, edited. */
  Profile: {},
  Wardrobe: BrowseQuery.fields,
  AddPieces: {},
  /** Pieces found in the person's photos and videos, waiting for them to keep or drop. */
  Review: { from: Schema.optionalKey(Schema.String) },
  Piece: { pieceId: Schema.String, from: Schema.optionalKey(Schema.String) },
  Looks: {},
  /** My Gallery: the person's own outfit photos, a tab of the wardrobe. */
  Photos: {},
  Photo: { photoId: Schema.String },
  /** What the person wants one like: a tab of the wardrobe. */
  Look: { lookId: Schema.String },
  /** Search your wardrobe, ask the stylist through an assistant, or add clothes (Gallery 2's middle button). The
   * search stays in the address, so coming back to Ask brings it back. */
  Ask: { q: Schema.Option(Schema.String) },
  /** Styld, the stylist in the app: a chat about the person's own wardrobe. A question typed in Ask comes along. */
  Stylist: { q: Schema.Option(Schema.String) },
  Boards: {},
  /** A board: its collage above the grid of its pins. */
  Board: { boardId: Schema.String },
  /** The editor of a board's collage, which has the whole screen. */
  BoardCollage: { boardId: Schema.String },
  /** A person's published profile, `/@handle`, readable signed out. */
  Person: { handle: Schema.String },
  /** A piece as others see it, from a public profile, board or look. */
  PublicPiece: { pieceId: Schema.String },
  /** Edits from Styld, featured boards, people to follow and the newest public boards. */
  Explore: {},
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const homeRouter = pipe(root, mapTo(AppRoute.Home))
const loginRouter = pipe(
  literal('login'),
  query(Schema.Struct({ next: Schema.OptionFromOptional(Schema.String) })),
  mapTo(AppRoute.Login),
)
const loginForConnectionRouter = pipe(literal('login'), slash(literal('connect')), mapTo(AppRoute.LoginForConnection))
export const accountRouter = pipe(literal('account'), mapTo(AppRoute.Account))
export const profileRouter = pipe(literal('profile'), mapTo(AppRoute.Profile))
export const wardrobeRouter = pipe(literal('wardrobe'), query(BrowseQuery), mapTo(AppRoute.Wardrobe))
export const addPiecesRouter = pipe(literal('wardrobe'), slash(literal('add')), mapTo(AppRoute.AddPieces))
const returnQuery = Schema.Struct({ from: Schema.optionalKey(Schema.String) })
export const reviewRouter = pipe(
  literal('wardrobe'),
  slash(literal('review')),
  query(returnQuery),
  mapTo(AppRoute.Review),
)
export const pieceRouter = pipe(
  literal('wardrobe'),
  slash(string('pieceId')),
  query(returnQuery),
  mapTo(AppRoute.Piece),
)
export const looksRouter = pipe(literal('looks'), mapTo(AppRoute.Looks))
export const photosRouter = pipe(literal('wardrobe'), slash(literal('gallery')), mapTo(AppRoute.Photos))
export const photoRouter = pipe(
  literal('wardrobe'),
  slash(literal('gallery')),
  slash(string('photoId')),
  mapTo(AppRoute.Photo),
)
export const lookRouter = pipe(literal('looks'), slash(string('lookId')), mapTo(AppRoute.Look))
export const askRouter = pipe(
  literal('ask'),
  query(Schema.Struct({ q: Schema.OptionFromOptional(Schema.String) })),
  mapTo(AppRoute.Ask),
)
export const stylistRouter = pipe(
  literal('ask'),
  slash(literal('stylist')),
  query(Schema.Struct({ q: Schema.OptionFromOptional(Schema.String) })),
  mapTo(AppRoute.Stylist),
)
export const boardsRouter = pipe(literal('boards'), mapTo(AppRoute.Boards))
export const boardRouter = pipe(literal('boards'), slash(string('boardId')), mapTo(AppRoute.Board))
export const boardCollageRouter = pipe(
  literal('boards'),
  slash(string('boardId')),
  slash(literal('collage')),
  mapTo(AppRoute.BoardCollage),
)

/** `/@nika.kovac`: the segment after its `@` is the handle. */
const atHandle = param<{ readonly handle: string }>(
  '@handle',
  (segment) => {
    const at = segment.startsWith('%40') ? 3 : segment.startsWith('@') ? 1 : 0
    return at > 0 && segment.length > at
      ? Effect.succeed({ handle: segment.slice(at) })
      : Effect.fail(new ParseError({ message: 'Expected @handle', expected: '@handle', actual: segment }))
  },
  ({ handle }) => `@${handle}`,
)
export const personRouter = pipe(atHandle, mapTo(AppRoute.Person))
export const publicPieceRouter = pipe(literal('pieces'), slash(string('pieceId')), mapTo(AppRoute.PublicPiece))
export const exploreRouter = pipe(literal('explore'), mapTo(AppRoute.Explore))

// `/wardrobe/add`, `/wardrobe/review` and `/wardrobe/gallery` are declared before `/wardrobe/:pieceId`, which would
// otherwise take them.
const parser = oneOf(
  loginForConnectionRouter,
  loginRouter,
  accountRouter,
  profileRouter,
  addPiecesRouter,
  reviewRouter,
  photoRouter,
  photosRouter,
  pieceRouter,
  wardrobeRouter,
  lookRouter,
  looksRouter,
  stylistRouter,
  askRouter,
  boardCollageRouter,
  boardRouter,
  boardsRouter,
  publicPieceRouter,
  exploreRouter,
  personRouter,
  homeRouter,
)

/** The page for a URL; unknown paths are NotFound. */
export const routeFromUrl = parseUrlWithFallback(parser, AppRoute.NotFound)

/** The page for a request path; unknown paths are NotFound. */
export const routeFromPathname = (pathname: string): AppRoute =>
  routeFromUrl({
    protocol: 'https:',
    host: 'styld',
    port: Option.none(),
    pathname,
    search: Option.none(),
    hash: Option.none(),
  })

/** Sign-in, with nowhere in particular to return to. */
export const signInHref = loginRouter({ next: Option.none() })

/** Sign-in that returns to a page of this site, such as the profile where a visitor pressed Follow. */
export const signInReturningTo = (path: string) => loginRouter({ next: Option.some(path) })

const returnBase = 'https://styld.invalid'
const parseReturn = Option.liftThrowable((path: string) => new URL(path, returnBase))

/** Where sign-in may return to: a path on this site that names one of its pages other than sign-in itself. A path
 * that starts with `//` or `/\`, holds a backslash or whitespace (which browsers drop or read as `/`), carries a
 * scheme or leaves the origin is refused, so a link cannot send someone elsewhere once they have signed in. */
export const returnPath = (next: Option.Option<string>): Option.Option<string> =>
  pipe(
    next,
    Option.filter((path) => /^\/(?![/\\])/.test(path) && !/[\\\s]/.test(path)),
    Option.flatMap(parseReturn),
    Option.filter((url) => url.origin === returnBase),
    Option.filter((url) => {
      const route = routeFromPathname(url.pathname)
      return !(
        AppRoute.guards.NotFound(route) ||
        AppRoute.guards.Login(route) ||
        AppRoute.guards.LoginForConnection(route)
      )
    }),
    Option.map((url) => `${url.pathname}${url.search}${url.hash}`),
  )

/** Return links keep only the expected parent, even when their query is supplied by someone else. */
export const parentReturn = (from: string | undefined, parent: 'Wardrobe' | 'Photo') =>
  Option.filter(returnPath(Option.fromNullishOr(from)), (path) => {
    const url = new URL(path, returnBase)
    const route = routeFromPathname(url.pathname)
    return parent === 'Wardrobe' ? AppRoute.guards.Wardrobe(route) : AppRoute.guards.Photo(route)
  })

/** The pages the navigation moves between. They keep their place: each opens at once from what the app already
 * has, while every other page loads whole. */
export const Tab = Schema.Literals(['Home', 'Explore', 'Wardrobe', 'Looks', 'Photos', 'Ask', 'Boards', 'Account'])
export type Tab = typeof Tab.Type

/** The navigation's sections; a page marks the one it belongs to. */
export type Section = 'home' | 'wardrobe' | 'ask' | 'boards' | 'you'

/** What the app knows about a page besides its address: its route as a template (no ids or handles, so telemetry
 * names a slow page without naming whose it was), whether it needs a session, the tab it is, its title and the
 * navigation section it marks. Adding a page is adding its row to `routeMeta`. */
export type RouteMeta = Readonly<{
  template: string
  session: 'required' | 'optional'
  tab: Option.Option<Tab>
  title: MessageKey
  section: Option.Option<Section>
}>

const meta = (
  template: string,
  title: MessageKey,
  options: Readonly<{ session?: 'required'; tab?: Tab; section?: Section }> = {},
): RouteMeta => ({
  template,
  title,
  session: options.session ?? 'optional',
  tab: Option.fromNullishOr(options.tab),
  section: Option.fromNullishOr(options.section),
})

const required = 'required'

export const routeMeta = AppRoute.match<RouteMeta>({
  Home: () => meta('/', 'landing.title', { tab: 'Home', section: 'home' }),
  Login: () => meta('/login', 'auth.signInTitle'),
  LoginForConnection: () => meta('/login/connect', 'auth.signInTitle'),
  Account: () => meta('/account', 'account.title', { session: required, tab: 'Account', section: 'you' }),
  Profile: () => meta('/profile', 'profile.editor.title', { session: required, section: 'you' }),
  Wardrobe: () => meta('/wardrobe', 'wardrobe.title', { session: required, tab: 'Wardrobe', section: 'wardrobe' }),
  AddPieces: () => meta('/wardrobe/add', 'capture.addTitle', { session: required, section: 'wardrobe' }),
  Review: () => meta('/wardrobe/review', 'scan.toReview', { session: required, section: 'wardrobe' }),
  Piece: () => meta('/wardrobe/:piece', 'wardrobe.title', { session: required, section: 'wardrobe' }),
  Looks: () => meta('/looks', 'looks.title', { session: required, tab: 'Looks', section: 'wardrobe' }),
  Look: () => meta('/looks/:look', 'looks.title', { section: 'wardrobe' }),
  Photos: () =>
    meta('/wardrobe/gallery', 'wardrobe.tabGallery', { session: required, tab: 'Photos', section: 'wardrobe' }),
  Photo: () => meta('/wardrobe/gallery/:photo', 'wardrobe.tabGallery', { session: required, section: 'wardrobe' }),
  Ask: () => meta('/ask', 'ask.title', { session: required, tab: 'Ask', section: 'wardrobe' }),
  Stylist: () => meta('/ask/stylist', 'stylist.title', { session: required, section: 'ask' }),
  Boards: () => meta('/boards', 'boards.title', { session: required, tab: 'Boards', section: 'boards' }),
  Board: () => meta('/boards/:board', 'boards.title', { section: 'boards' }),
  BoardCollage: () => meta('/boards/:board/collage', 'boards.title', { session: required, section: 'boards' }),
  Person: () => meta('/@:handle', 'profile.public.people'),
  PublicPiece: () => meta('/pieces/:piece', 'profile.public.pieces'),
  // Explore is reached from Home's head (owner, 2026-10-31), so Home stays marked there.
  Explore: () => meta('/explore', 'explore.title', { tab: 'Explore', section: 'home' }),
  NotFound: () => meta('other', 'common.notFoundTitle'),
})

/** The tab page a route shows, if it is one. */
export const tabOf = (route: AppRoute): Option.Option<Tab> => routeMeta(route).tab

/** Whether two routes show the same tab page. */
export const isSameTab = (left: AppRoute, right: AppRoute) =>
  Option.makeEquivalence(Equivalence.String)(tabOf(left), tabOf(right))

/** The section of the account page about connecting an assistant, linked from Ask. */
export const assistantsSection = 'assistants'

/** Where an assistant's connection resumes once the person has signed in (Yielded keeps the pending
 * authorization in a private cookie). */
export const connectionAuthorizePath = '/oauth/mcp/authorize'
