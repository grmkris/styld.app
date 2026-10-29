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
  AddPiece: {},
  Piece: { pieceId: Schema.String },
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const homeRouter = pipe(root, mapTo(AppRoute.Home))
export const loginRouter = pipe(literal('login'), mapTo(AppRoute.Login))
const loginForConnectionRouter = pipe(literal('login'), slash(literal('connect')), mapTo(AppRoute.LoginForConnection))
export const accountRouter = pipe(literal('account'), mapTo(AppRoute.Account))
export const wardrobeRouter = pipe(literal('wardrobe'), mapTo(AppRoute.Wardrobe))
export const addPieceRouter = pipe(literal('wardrobe'), slash(literal('add')), mapTo(AppRoute.AddPiece))
export const pieceRouter = pipe(literal('wardrobe'), slash(string('pieceId')), mapTo(AppRoute.Piece))

// `/wardrobe/add` is declared before `/wardrobe/:pieceId`, which would otherwise take it.
const parser = oneOf(
  loginForConnectionRouter,
  loginRouter,
  accountRouter,
  addPieceRouter,
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
  AppRoute.guards.AddPiece(route) ||
  AppRoute.guards.Piece(route)

/** Where an assistant's connection resumes once the person has signed in (Yielded keeps the pending
 * authorization in a private cookie). */
export const connectionAuthorizePath = '/oauth/mcp/authorize'
