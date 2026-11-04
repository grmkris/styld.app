import { googleProvider, makeAuthRuntime } from '@styld/auth'
import { csrf, SessionHttp } from '@styld/auth/config'
import { Unavailable } from '@styld/protocol'
import { Http, Proofs, Sessions } from '@yielded/auth'
import { Context, Effect, Layer, Option, Redacted } from 'effect'
import type * as Headers from 'effect/http/Headers'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { AuthHttpOptions } from './AuthConfiguration.ts'
import { networkOf } from './kernel/Pacing.ts'
import { publicWebTransport } from './providers/PublicWeb.ts'

/** Where Google returns: v1's path, so the redirect address registered on v1's OAuth client for styld.app keeps working
 * when styld.app moves to v2. */
const googleCallbackPath = '/api/auth/callback/google'

/** Build the auth HTTP layer at the Worker boundary where the trusted origin
 * and the native D1 binding are available. */
export const makeAuthHttp = (database: QueryDatabaseClient, options: AuthHttpOptions) => {
  const runtime = makeAuthRuntime(database.raw, options.secret, options.email, {
    transactionKeys: Option.map(options.google, ({ transactionKeys }) => transactionKeys),
    // A Google sign-in comes back to the login page, which goes on to where the person was going (`SignInReturn`).
    returnTargets: ['/login', '/login/connect'],
  })
  const http = Http.make(runtime.auth, {
    origin: options.origin,
    cookie: { secure: options.secureCookies },
    csrf,
    oauth: {
      providers: {
        google: googleProvider(
          Option.map(options.google, ({ client }) => client),
          database.raw,
        ),
      },
      // Google returns `scope`, `authuser` and `prompt` with every code, and `hd` for a Workspace account; Yielded
      // refuses a callback carrying any parameter it was not told of, which failed every real Google sign-in.
      callbacks: {
        google: { path: googleCallbackPath, allowedQueryParameters: ['scope', 'authuser', 'prompt', 'hd'] },
      },
    },
  })
  const dependencies = runtime
    .provide(http.layer)
    .pipe(
      Layer.provide(publicWebTransport),
      Layer.provideMerge(Layer.succeed(Sessions.SessionSigningKeys, options.sessionKeys)),
      Layer.provideMerge(runtime.shared),
    )
  return {
    layer: http.routes().pipe(Layer.provide(dependencies)),
    dependencies,
    runtime,
    router: http,
  }
}

/** The website's auth over the Worker's database: its routes, its runtime and Yielded's request handling. */
export type AuthHttp = ReturnType<typeof makeAuthHttp>

/** The website's auth, built once per runtime, for the modules whose routes read the session cookie. */
export class Auth extends Context.Service<Auth, AuthHttp>()('@styld/server/Auth') {}

/** Routes built over the website's auth. */
export const withAuth = <A, E, R>(routes: (auth: AuthHttp) => Layer.Layer<A, E, R>) =>
  Layer.unwrap(Effect.map(Auth, routes))

/** The account behind the website's session cookie, for the routes outside the typed API (owner-only images and
 * files, public pages a signed-in reader sees, the OAuth login): none signed out or with a session that is no longer
 * valid, `Unavailable` when the session could not be checked. */
export const sessionCookieAccount = (auth: AuthHttp) =>
  Effect.gen(function* () {
    const api = yield* auth.runtime.auth
    return Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const cookie = request.cookies[SessionHttp.cookieName]
      if (cookie === undefined) return Option.none()
      return yield* api.verifySession(Redacted.make(cookie)).pipe(
        Effect.map(({ subjectId }) => Option.some(subjectId)),
        Effect.catchTag('SessionInvalid', () => Effect.succeedNone),
        Effect.mapError(() => Unavailable.make({})),
      )
    })
  }).pipe(Effect.provide(auth.dependencies))

/** Per request, the network a code request comes from (`networkOf`) and whether it may ask for another. The limit
 * is the host's, shared by every isolate; Yielded's default would count per isolate. */
export const withCodeRequestPolicy =
  (headers: Headers.Headers, allow: (networkKey: string) => Effect.Effect<boolean>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(
        Proofs.ProofRequestContext,
        Effect.succeed({ networkKey: Redacted.make(networkOf(headers)) }),
      ),
      Effect.provideService(
        Proofs.HostIngressLimiter,
        Proofs.HostIngressLimiter.of({
          check: ({ networkKey }) =>
            allow(Redacted.value(networkKey)).pipe(
              Effect.flatMap((allowed) => (allowed ? Effect.void : Effect.fail(Proofs.ProofIngressDenied.make({})))),
            ),
        }),
      ),
    )
