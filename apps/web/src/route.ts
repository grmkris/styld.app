import { Option, Schema, pipe } from 'effect'
import { defineRouteUnion, literal, mapTo, oneOf, parseUrlWithFallback, root, slash, string } from 'foldkit/route'

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

// `/wardrobe/add` and `/wardrobe/review` are declared before `/wardrobe/:pieceId`, which would otherwise take them.
const parser = oneOf(
  loginForConnectionRouter,
  loginRouter,
  accountRouter,
  addPiecesRouter,
  reviewRouter,
  pieceRouter,
  wardrobeRouter,
  homeRouter,
)

/** The page for a request path; unknown paths are NotFound. */
export const routeFromPathname = (pathname: string): AppRoute =>
  parseUrlWithFallback(
    parser,
    AppRoute.NotFound,
  )({ protocol: 'https:', host: 'styld', port: Option.none(), pathname, search: Option.none(), hash: Option.none() })

/** Pages that only make sense signed in. */
export const needsSession = (route: AppRoute) =>
  AppRoute.guards.Account(route) ||
  AppRoute.guards.Wardrobe(route) ||
  AppRoute.guards.AddPieces(route) ||
  AppRoute.guards.Review(route) ||
  AppRoute.guards.Piece(route)

/** Where an assistant's connection resumes once the person has signed in (Yielded keeps the pending
 * authorization in a private cookie). */
export const connectionAuthorizePath = '/oauth/mcp/authorize'
