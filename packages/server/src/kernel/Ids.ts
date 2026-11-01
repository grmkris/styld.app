import { Effect } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'

// Ids and digests made one way, from the runtime's Web Crypto (Workers and Bun alike). It does not fail on these calls;
// if it did, the runtime would be broken, so a failure is a defect rather than an error every caller maps.

/** A random token of the given bytes, URL-safe. */
export const randomToken = (bytes: number) =>
  Effect.sync(() => Base64Url.encode(globalThis.crypto.getRandomValues(new Uint8Array(bytes))))

/** A new entity id: its two-letter kind, then 16 random bytes (`pc_…`, 22 characters after the prefix). */
export const newId = (prefix: string) => Effect.map(randomToken(16), (token) => `${prefix}_${token}`)

/** The SHA-256 digest of a text, URL-safe: what a receipt compares a repeated request by. */
export const digestOf = (text: string) =>
  Effect.promise(() => globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).pipe(
    Effect.map((buffer) => Base64Url.encode(new Uint8Array(buffer))),
  )
