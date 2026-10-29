import { Option, Schema, pipe } from 'effect'
import { defineRouteUnion, literal, mapTo, oneOf, parseUrlWithFallback, root, slash } from 'foldkit/route'

/** Every page of the website. A route both parses its URL and builds its link. */
export const AppRoute = defineRouteUnion({
  Home: {},
  Login: {},
  /** Sign-in for an assistant's connection: success returns to the OAuth authorization. */
  LoginForConnection: {},
  Account: {},
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const homeRouter = pipe(root, mapTo(AppRoute.Home))
export const loginRouter = pipe(literal('login'), mapTo(AppRoute.Login))
const loginForConnectionRouter = pipe(literal('login'), slash(literal('connect')), mapTo(AppRoute.LoginForConnection))
export const accountRouter = pipe(literal('account'), mapTo(AppRoute.Account))

const parser = oneOf(loginForConnectionRouter, loginRouter, accountRouter, homeRouter)

/** The page for a request path; unknown paths are NotFound. */
export const routeFromPathname = (pathname: string): AppRoute =>
  parseUrlWithFallback(
    parser,
    AppRoute.NotFound,
  )({ protocol: 'https:', host: 'styld', port: Option.none(), pathname, search: Option.none(), hash: Option.none() })

/** Where an assistant's connection resumes once the person has signed in (Yielded keeps the pending
 * authorization in a private cookie). */
export const connectionAuthorizePath = '/oauth/mcp/authorize'
