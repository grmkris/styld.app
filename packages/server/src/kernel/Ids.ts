import { Effect } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as Base64Url from 'effect/encoding/Base64Url'

// Ids and digests made one way. The Workers runtime's Web Crypto does not fail on these calls; if it does, the runtime
// is broken, so the failure is a defect rather than an error every caller would have to map.

/** A random token of the given bytes, URL-safe. */
export const randomToken = (bytes: number) =>
  Effect.flatMap(Crypto.Crypto, (crypto) => crypto.randomBytes(bytes)).pipe(Effect.map(Base64Url.encode), Effect.orDie)

/** A new entity id: its two-letter kind, then 16 random bytes (`pc_…`, 22 characters after the prefix). */
export const newId = (prefix: string) => Effect.map(randomToken(16), (token) => `${prefix}_${token}`)

/** The SHA-256 digest of a text, URL-safe: what a receipt compares a repeated request by. */
export const digestOf = (text: string) =>
  Effect.flatMap(Crypto.Crypto, (crypto) => crypto.digest('SHA-256', new TextEncoder().encode(text))).pipe(
    Effect.map(Base64Url.encode),
    Effect.orDie,
  )
