import { makeAuthRuntime } from '@styld/auth'
import { csrf, SessionHttp } from '@styld/auth/config'
import { Unavailable } from '@styld/protocol'
import { Http, Proofs, Sessions } from '@yielded/auth'
import { Effect, Layer, Option, Redacted } from 'effect'
import type * as Headers from 'effect/http/Headers'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { AuthHttpOptions } from './AuthConfiguration.ts'
import { networkOf } from './kernel/Pacing.ts'

/** Build the auth HTTP layer at the Worker boundary where the trusted origin
 * and the native D1 binding are available. */
export const makeAuthHttp = (database: QueryDatabaseClient, options: AuthHttpOptions) => {
  const runtime = makeAuthRuntime(database.raw, options.secret, options.email)
  const http = Http.make(runtime.auth, {
    origin: options.origin,
    cookie: { secure: options.secureCookies },
    csrf,
  })
  const dependencies = Layer.mergeAll(runtime.layer, Layer.succeed(Sessions.SessionSigningKeys, options.sessionKeys))
  return {
    layer: http.routes().pipe(Layer.provide(dependencies)),
    dependencies,
    runtime,
    router: http,
  }
}

/** The website's auth over the Worker's database: its routes, its runtime and Yielded's request handling. */
export type AuthHttp = ReturnType<typeof makeAuthHttp>

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
