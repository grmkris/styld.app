import type { EmailEntryOptions } from '@styld/auth'
import type { Sessions } from '@yielded/auth'
import { Effect, Redacted, Result, Schema } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'

const KeyId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/))
const KeyMaterial = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43,342}$/),
  Schema.makeFilter((value) => {
    const bytes = Result.getOrUndefined(Base64Url.decode(value))
    return bytes !== undefined && bytes.length >= 32
  }),
)
const SessionKeyring = Schema.Struct({
  activeKeyId: KeyId,
  keys: Schema.Array(Schema.Struct({ id: KeyId, material: KeyMaterial })).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
  ),
}).check(
  Schema.makeFilter(
    ({ activeKeyId, keys }) =>
      keys.some(({ id }) => id === activeKeyId) && new Set(keys.map(({ id }) => id)).size === keys.length,
  ),
)

export class AuthHttpConfigurationError extends Schema.TaggedError<AuthHttpConfigurationError>()(
  'AuthHttpConfigurationError',
  { reason: Schema.Literals(['session-keys', 'secret', 'proof-keys', 'request-binding-keys']) },
) {}

export type AuthSessionKeyring = Sessions.SessionSigningKeyring

export type AuthHttpOptions = {
  readonly origin: string
  readonly secureCookies: boolean
  readonly secret: Redacted.Redacted
  readonly sessionKeys: AuthSessionKeyring
  readonly email: EmailEntryOptions
}

type KeyringReason = 'session-keys' | 'proof-keys' | 'request-binding-keys'

/** A JSON keyring: `{"activeKeyId":"k1","keys":[{"id":"k1","material":"<base64url, >=32 bytes>"}]}`.
 * Yielded holds code and request-binding keyrings to 8 keys of at most 172 characters. */
const decodeKeyring =
  (reason: KeyringReason, limits: { readonly keys: number; readonly material: number }) => (value: unknown) =>
    Schema.decodeUnknownEffect(
      Schema.fromJsonString(
        SessionKeyring.check(
          Schema.makeFilter(
            ({ keys }) =>
              keys.length <= limits.keys && keys.every(({ material }) => material.length <= limits.material),
          ),
        ),
      ),
    )(value).pipe(
      Effect.map(({ activeKeyId, keys }) => ({
        activeKeyId,
        keys: keys.map(({ id, material }) => ({ id, material: Redacted.make(material) })),
      })),
      Effect.mapError(() => AuthHttpConfigurationError.make({ reason })),
    )

export const decodeAuthSessionKeyring = decodeKeyring('session-keys', { keys: 16, material: 342 })
export const decodeProofKeyring = decodeKeyring('proof-keys', { keys: 8, material: 172 })
export const decodeRequestBindingKeyring = decodeKeyring('request-binding-keys', { keys: 8, material: 172 })

export const decodeAuthSecret = (value: unknown) =>
  Schema.decodeUnknownEffect(Schema.String.check(Schema.isMinLength(32)))(value).pipe(
    Effect.map(Redacted.make),
    Effect.mapError(() => AuthHttpConfigurationError.make({ reason: 'secret' })),
  )

/** The auth origin and keyrings bound as secrets. Missing or malformed ones stop the Worker. */
export const authConfiguration = (env: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const origin = env['AUTH_ORIGIN']
    if (typeof origin !== 'string' || origin.length === 0)
      return yield* Effect.die(new Error('AUTH_ORIGIN binding is required'))
    return {
      origin,
      sessionKeys: yield* decodeAuthSessionKeyring(env['AUTH_SESSION_KEYS']).pipe(Effect.orDie),
      secret: yield* decodeAuthSecret(env['AUTH_SECRET']).pipe(Effect.orDie),
      proofKeys: yield* decodeProofKeyring(env['AUTH_PROOF_KEYS']).pipe(Effect.orDie),
      requestBindingKeys: yield* decodeRequestBindingKeyring(env['AUTH_REQUEST_BINDING_KEYS']).pipe(Effect.orDie),
    }
  })

/** Auth's options from the secrets, sending code mail as `from`. */
export const authOptions = (
  configuration: Effect.Success<ReturnType<typeof authConfiguration>>,
  sender: EmailEntryOptions['sender'],
  from: EmailEntryOptions['from'],
): AuthHttpOptions => ({
  origin: configuration.origin,
  secret: configuration.secret,
  secureCookies: true,
  sessionKeys: configuration.sessionKeys,
  email: {
    sender,
    from,
    proofKeys: configuration.proofKeys,
    requestBindingKeys: configuration.requestBindingKeys,
    returnTargets: ['/'],
  },
})
