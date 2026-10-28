import { makeAuthRuntime } from '@styld/auth'
import { Http, Sessions } from '@yielded/auth'
import { Effect, Layer, Redacted, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'

const SessionKeyring = Schema.Struct({
  activeKeyId: Schema.String,
  keys: Schema.Array(Schema.Struct({ id: Schema.String, material: Schema.String })),
})

export class AuthHttpConfigurationError extends Schema.TaggedError<AuthHttpConfigurationError>()(
  'AuthHttpConfigurationError',
  { reason: Schema.Literal('session-keys') },
) {}

export type AuthSessionKeyring = Sessions.SessionSigningKeyring

export type AuthHttpOptions = {
  readonly origin: string
  readonly secureCookies: boolean
  readonly secret: Redacted.Redacted
  readonly sessionKeys: AuthSessionKeyring
}

export const decodeAuthSessionKeyring = (value: unknown) =>
  Schema.decodeUnknownEffect(SessionKeyring)(value).pipe(
    Effect.map(({ activeKeyId, keys }) => ({
      activeKeyId,
      keys: keys.map(({ id, material }) => ({ id, material: Redacted.make(material) })),
    })),
    Effect.mapError(() => AuthHttpConfigurationError.make({ reason: 'session-keys' })),
  )

export const decodeAuthSecret = (value: unknown) =>
  Schema.decodeUnknownEffect(Schema.String.check(Schema.isMinLength(32)))(value).pipe(
    Effect.map(Redacted.make),
    Effect.mapError(() => AuthHttpConfigurationError.make({ reason: 'session-keys' })),
  )

/** Build the auth HTTP layer at the Worker boundary where the trusted origin
 * and the native D1 binding are available. */
export const makeAuthHttp = (database: QueryDatabaseClient, options: AuthHttpOptions) => {
  const runtime = makeAuthRuntime(database.raw, options.secret)
  const http = Http.make(runtime.auth, {
    origin: options.origin,
    cookie: { secure: options.secureCookies },
  })
  const dependencies = Layer.mergeAll(runtime.layer, Layer.succeed(Sessions.SessionSigningKeys, options.sessionKeys))
  return {
    layer: http.routes().pipe(Layer.provide(dependencies)),
    runtime,
    router: http,
  }
}

export const makeAuthHandler = (database: QueryDatabaseClient, options: AuthHttpOptions) => {
  const auth = makeAuthHttp(database, options)
  return Effect.map(HttpRouter.toHttpEffect(auth.layer).pipe(Effect.orDie), (handle) => ({ handle, auth }))
}
