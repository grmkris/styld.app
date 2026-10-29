import { makeAuthRuntime } from '@styld/auth'
import { Http, Proofs, Sessions } from '@yielded/auth'
import { Effect, Layer, Redacted } from 'effect'
import type * as Headers from 'effect/http/Headers'
import * as HttpRouter from 'effect/http/HttpRouter'
import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { AuthHttpOptions } from './AuthConfiguration.ts'

/** Build the auth HTTP layer at the Worker boundary where the trusted origin
 * and the native D1 binding are available. */
export const makeAuthHttp = (database: QueryDatabaseClient, options: AuthHttpOptions) => {
  const runtime = makeAuthRuntime(database.raw, options.secret, options.email)
  const http = Http.make(runtime.auth, {
    origin: options.origin,
    cookie: { secure: options.secureCookies },
  })
  const dependencies = Layer.mergeAll(runtime.layer, Layer.succeed(Sessions.SessionSigningKeys, options.sessionKeys))
  return {
    layer: http.routes().pipe(Layer.provide(dependencies)),
    dependencies,
    runtime,
    router: http,
  }
}

/** The network a code request comes from, for the per-network request limit. A Worker has no
 * socket peer, so the key is the visitor address Cloudflare sets in `cf-connecting-ip` (absent
 * only under local tooling, where every request shares one bucket). Provided per request. */
export const withRequestNetwork =
  (headers: Headers.Headers) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(
      effect,
      Proofs.ProofRequestContext,
      Effect.succeed({ networkKey: Redacted.make(headers['cf-connecting-ip'] ?? 'unknown') }),
    )

export const makeAuthHandler = (database: QueryDatabaseClient, options: AuthHttpOptions) => {
  const auth = makeAuthHttp(database, options)
  return Effect.map(HttpRouter.toHttpEffect(auth.layer).pipe(Effect.orDie), (handle) => ({ handle, auth }))
}
