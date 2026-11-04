import { Effect, Option, Result } from 'effect'
import * as Base64 from 'effect/encoding/Base64'

// Dodo signs every webhook the Standard Webhooks way (https://www.standardwebhooks.com): an HMAC-SHA256, keyed by the
// endpoint's secret, over `<webhook-id>.<webhook-timestamp>.<raw body>`, sent base64 in `webhook-signature` as
// space-separated `v1,<signature>` entries (several while a secret rotates). Checked here with WebCrypto, which
// compares in constant time; a delivery older or newer than five minutes is refused, so a captured one cannot be
// replayed later.

/** How far a delivery's timestamp may be from now, in seconds.
 * @internal Exported for its tests. */
export const toleranceSeconds = 5 * 60

/** The HMAC key of an endpoint's secret, `whsec_<base64>`; nothing when it is not one. */
export const webhookKeyOf = (secret: string): Option.Option<Uint8Array> => {
  const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  return Option.filter(Result.getSuccess(Base64.decode(encoded)), (key) => key.length > 0)
}

/** A delivery's three Standard Webhooks headers, as they came. */
export interface WebhookHeaders {
  readonly id: string | undefined
  readonly timestamp: string | undefined
  readonly signature: string | undefined
}

/** Whether a delivery is signed by the endpoint's key and recent, at `nowSeconds` (Unix seconds). */
export const isSignedDelivery = Effect.fnUntraced(function* (
  key: Uint8Array,
  headers: WebhookHeaders,
  body: string,
  nowSeconds: number,
) {
  const { id, timestamp, signature } = headers
  if (id === undefined || timestamp === undefined || signature === undefined) return false
  if (!/^\d{1,12}$/u.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) return false
  const signatures = signature
    .split(' ')
    .flatMap((entry) =>
      entry.startsWith('v1,') ? Option.toArray(Result.getSuccess(Base64.decode(entry.slice(3)))) : [],
    )
  if (signatures.length === 0) return false
  const hmac = yield* Effect.promise(() =>
    crypto.subtle.importKey('raw', Uint8Array.from(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']),
  )
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`)
  const matches = yield* Effect.forEach(signatures, (candidate) =>
    Effect.promise(() => crypto.subtle.verify('HMAC', hmac, Uint8Array.from(candidate), signed)),
  )
  return matches.includes(true)
})
