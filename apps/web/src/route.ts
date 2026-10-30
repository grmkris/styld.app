import { Equivalence, Option, Schema, pipe } from 'effect'
import {
  defineRouteUnion,
  literal,
  mapTo,
  oneOf,
  parseUrlWithFallback,
  query,
  root,
  slash,
  string,
} from 'foldkit/route'

/** Every page of the website. A route both parses its URL and builds its link. */
export const AppRoute = defineRouteUnion({
  Home: {},
  Login: {},
  /** Sign-in for an assistant's connection: success returns to the OAuth authorization. */
  LoginForConnection: {},
  Account: {},
  Wardrobe: {},
  AddPieces: {},
  /** Pieces found in the person's photos and videos, waiting for them to keep or drop. */
  Review: {},
  Piece: { pieceId: Schema.String },
  Looks: {},
  Look: { lookId: Schema.String },
  /** Search your wardrobe, ask the stylist through an assistant, or add clothes (Gallery 2's middle button). The
   * search stays in the address, so coming back to Ask brings it back. */
  Ask: { q: Schema.Option(Schema.String) },
  Boards: {},
  Board: { boardId: Schema.String },
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const homeRouter = pipe(root, mapTo(AppRoute.Home))
export const loginRouter = pipe(literal('login'), mapTo(AppRoute.Login))
const loginForConnectionRouter = pipe(literal('login'), slash(literal('connect')), mapTo(AppRoute.LoginForConnection))
export const accountRouter = pipe(literal('account'), mapTo(AppRoute.Account))
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
export const boardsRouter = pipe(literal('boards'), mapTo(AppRoute.Boards))
export const boardRouter = pipe(literal('boards'), slash(string('boardId')), mapTo(AppRoute.Board))

// `/wardrobe/add` and `/wardrobe/review` are declared before `/wardrobe/:pieceId`, which would otherwise take them.
const parser = oneOf(
  loginForConnectionRouter,
  loginRouter,
  accountRouter,
  addPiecesRouter,
  reviewRouter,
  pieceRouter,
  wardrobeRouter,
  lookRouter,
  looksRouter,
  askRouter,
  boardRouter,
  boardsRouter,
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

/** Pages that only make sense signed in. */
export const needsSession = (route: AppRoute) =>
  AppRoute.guards.Account(route) ||
  AppRoute.guards.Wardrobe(route) ||
  AppRoute.guards.AddPieces(route) ||
  AppRoute.guards.Review(route) ||
  AppRoute.guards.Piece(route) ||
  AppRoute.guards.Looks(route) ||
  AppRoute.guards.Look(route) ||
  AppRoute.guards.Ask(route) ||
  AppRoute.guards.Boards(route) ||
  AppRoute.guards.Board(route)

/** The pages the navigation moves between. They keep their place: each opens at once from what the app already
 * has, while every other page loads whole. */
export const Tab = Schema.Literals(['Home', 'Wardrobe', 'Looks', 'Ask', 'Boards', 'Account'])
export type Tab = typeof Tab.Type

export const tabOf = AppRoute.match<Option.Option<Tab>>({
  Home: () => Option.some('Home'),
  Wardrobe: () => Option.some('Wardrobe'),
  Looks: () => Option.some('Looks'),
  Ask: () => Option.some('Ask'),
  Boards: () => Option.some('Boards'),
  Account: () => Option.some('Account'),
  Login: () => Option.none(),
  LoginForConnection: () => Option.none(),
  AddPieces: () => Option.none(),
  Review: () => Option.none(),
  Piece: () => Option.none(),
  Look: () => Option.none(),
  Board: () => Option.none(),
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
