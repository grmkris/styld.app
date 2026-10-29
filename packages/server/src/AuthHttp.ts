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

/** Per request, the network a code request comes from and whether it may ask for another. A
 * Worker has no socket peer, so the key is the visitor address Cloudflare sets in
 * `cf-connecting-ip` (absent only under local tooling, where every request shares one key). The
 * limit is the host's, shared by every isolate; Yielded's default would count per isolate. */
export const withCodeRequestPolicy =
  (headers: Headers.Headers, allow: (networkKey: string) => Effect.Effect<boolean>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(
        Proofs.ProofRequestContext,
        Effect.succeed({ networkKey: Redacted.make(headers['cf-connecting-ip'] ?? 'unknown') }),
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

export const makeAuthHandler = (database: QueryDatabaseClient, options: AuthHttpOptions) => {
  const auth = makeAuthHttp(database, options)
  return Effect.map(HttpRouter.toHttpEffect(auth.layer).pipe(Effect.orDie), (handle) => ({ handle, auth }))
}
