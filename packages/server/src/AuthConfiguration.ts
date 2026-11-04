import type { EmailEntryOptions, GoogleClient } from '@styld/auth'
import type { OAuth, Sessions } from '@yielded/auth'
import { Effect, Option, Redacted, Result, Schema } from 'effect'
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

class AuthHttpConfigurationError extends Schema.TaggedError<AuthHttpConfigurationError>()(
  'AuthHttpConfigurationError',
  { reason: Schema.Literals(['session-keys', 'secret', 'proof-keys', 'request-binding-keys', 'oauth-keys']) },
) {}

type AuthSessionKeyring = Sessions.SessionSigningKeyring

/** Auth's facts about the deployment: its public origin and its secrets (`Config.ts` decodes them). */
export interface AuthSecrets {
  readonly origin: string
  readonly secret: Redacted.Redacted
  readonly sessionKeys: AuthSessionKeyring
  readonly proofKeys: EmailEntryOptions['proofKeys']
  readonly requestBindingKeys: EmailEntryOptions['requestBindingKeys']
  /** Sign in with Google: the OAuth client and the keys that seal each sign-in in progress. Absent, Google is not
   * offered. */
  readonly google?: { readonly client: GoogleClient; readonly transactionKeys: OAuth.OAuthTransactionKeyring }
}

export type AuthHttpOptions = {
  readonly origin: string
  readonly secureCookies: boolean
  readonly secret: Redacted.Redacted
  readonly sessionKeys: AuthSessionKeyring
  readonly email: EmailEntryOptions
  readonly google: Option.Option<NonNullable<AuthSecrets['google']>>
}

type KeyringReason = 'session-keys' | 'proof-keys' | 'request-binding-keys' | 'oauth-keys'

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
/** Yielded seals OAuth transactions with exactly 32-byte keys (43 base64url characters), at most 8. */
export const decodeOAuthKeyring = (value: unknown) =>
  decodeKeyring('oauth-keys', { keys: 8, material: 43 })(value).pipe(
    Effect.filterOrFail(
      ({ keys }) => keys.every(({ material }) => Redacted.value(material).length === 43),
      () => AuthHttpConfigurationError.make({ reason: 'oauth-keys' }),
    ),
  )

export const decodeAuthSecret = (value: unknown) =>
  Schema.decodeUnknownEffect(Schema.String.check(Schema.isMinLength(32)))(value).pipe(
    Effect.map(Redacted.make),
    Effect.mapError(() => AuthHttpConfigurationError.make({ reason: 'secret' })),
  )

/** Auth's options from the secrets, sending code mail as `from`. */
export const authOptions = (
  configuration: AuthSecrets,
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
  google: Option.fromNullishOr(configuration.google),
})
