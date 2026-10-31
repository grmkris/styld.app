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
  Wardrobe: {},
  AddPieces: {},
  /** Pieces found in the person's photos and videos, waiting for them to keep or drop. */
  Review: {},
  Piece: { pieceId: Schema.String },
  Looks: {},
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
export const wardrobeRouter = pipe(literal('wardrobe'), mapTo(AppRoute.Wardrobe))
export const addPiecesRouter = pipe(literal('wardrobe'), slash(literal('add')), mapTo(AppRoute.AddPieces))
export const reviewRouter = pipe(literal('wardrobe'), slash(literal('review')), mapTo(AppRoute.Review))
export const pieceRouter = pipe(literal('wardrobe'), slash(string('pieceId')), mapTo(AppRoute.Piece))
export const looksRouter = pipe(literal('looks'), mapTo(AppRoute.Looks))
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

// `/wardrobe/add` and `/wardrobe/review` are declared before `/wardrobe/:pieceId`, which would otherwise take them.
const parser = oneOf(
  loginForConnectionRouter,
  loginRouter,
  accountRouter,
  profileRouter,
  addPiecesRouter,
  reviewRouter,
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

/** Pages that only make sense signed in. */
export const needsSession = (route: AppRoute) =>
  AppRoute.guards.Account(route) ||
  AppRoute.guards.Profile(route) ||
  AppRoute.guards.Wardrobe(route) ||
  AppRoute.guards.AddPieces(route) ||
  AppRoute.guards.Review(route) ||
  AppRoute.guards.Piece(route) ||
  AppRoute.guards.Looks(route) ||
  AppRoute.guards.Ask(route) ||
  AppRoute.guards.Stylist(route) ||
  AppRoute.guards.Boards(route) ||
  AppRoute.guards.BoardCollage(route)

/** The pages the navigation moves between. They keep their place: each opens at once from what the app already
 * has, while every other page loads whole. */
export const Tab = Schema.Literals(['Home', 'Explore', 'Wardrobe', 'Looks', 'Ask', 'Boards', 'Account'])
export type Tab = typeof Tab.Type

export const tabOf = AppRoute.match<Option.Option<Tab>>({
  Home: () => Option.some('Home'),
  Wardrobe: () => Option.some('Wardrobe'),
  Looks: () => Option.some('Looks'),
  Ask: () => Option.some('Ask'),
  Stylist: () => Option.none(),
  Boards: () => Option.some('Boards'),
  Account: () => Option.some('Account'),
  Login: () => Option.none(),
  LoginForConnection: () => Option.none(),
  Profile: () => Option.none(),
  AddPieces: () => Option.none(),
  Review: () => Option.none(),
  Piece: () => Option.none(),
  Look: () => Option.none(),
  Board: () => Option.none(),
  BoardCollage: () => Option.none(),
  Person: () => Option.none(),
  PublicPiece: () => Option.none(),
  Explore: () => Option.some('Explore'),
  NotFound: () => Option.none(),
})

/** Whether two routes show the same tab page. */
export const isSameTab = (left: AppRoute, right: AppRoute) =>
  Option.makeEquivalence(Equivalence.String)(tabOf(left), tabOf(right))

/** The section of the account page about connecting an assistant, linked from Ask. */
export const assistantsSection = 'assistants'

/** Where an assistant's connection resumes once the person has signed in (Yielded keeps the pending
 * authorization in a private cookie). */
export const connectionAuthorizePath = '/oauth/mcp/authorize'
