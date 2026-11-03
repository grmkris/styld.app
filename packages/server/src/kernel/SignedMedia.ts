import { CurrentAccount, type PieceRotation } from '@styld/protocol'
import { Clock, Context, Effect, Layer, Option, Redacted, Result } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'

// Owner-only pictures are loaded by address, not by session: the API signs each address it hands the owner's browser
// with HMAC-SHA256 over whose object it is, which object, how it is shown and until when, and `/cdn/media/…` serves
// what a valid address names without reading the session or D1. A wardrobe screen loads sixty to eighty pictures at
// once; checking each against the session and its rows queued D1 until it refused (2 November 2026).
//
// The address is the capability, so it is handed only to the website's browser (`via: 'session'`), never to an
// assistant. Expiry is rounded up to the hour, so the same picture keeps the same address, and stays in the browser's
// cache, for an hour at a time; every address lives between 24 and 25 hours.

/** The label the media key is derived under from the auth secret; a new label invalidates every address at once. */
const keyLabel = 'styld-media-v1'
const hourSeconds = 60 * 60
/** How long an address is good for, at least. */
const lifetimeSeconds = 24 * hourSeconds

/** One stored object of one account, shown one way: what an address grants. */
export interface MediaGrant {
  readonly accountId: string
  /** The piece, photo or picture the object belongs to; it names the address. */
  readonly entityId: string
  readonly key: string
  readonly contentType: string
  /** How it is shown, such as a size; the route decides which it serves. */
  readonly variant: string
  /** Changes whenever the object behind the grant may have, so a cached copy is never shown for a new one. */
  readonly version: string
  /** A clockwise quarter-turn for a piece image; omitted means the legacy orientation (zero degrees). */
  readonly rotation?: PieceRotation
}

/** A grant with the instant it ends, in seconds since the epoch. */
export interface SignedGrant extends MediaGrant {
  readonly expires: number
}

/** What a request presents: the address's path parameters and its query. */
export interface Presented {
  readonly entityId: string
  readonly variant: string
  readonly query: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>
}

/** A show-tool alone collects already-authorized thumbnails for its private UI metadata. Normal tools never
 * install this collector and never receive media addresses. */
class ViewThumbnails extends Context.Service<
  ViewThumbnails,
  { readonly add: (grant: MediaGrant) => Effect.Effect<void> }
>()('@styld/server/kernel/ViewThumbnails') {}

export const withViewThumbnails = <A, E, R>(load: Effect.Effect<A, E, R>) =>
  Effect.suspend(() => {
    const images = new Map<string, MediaGrant>()
    return load.pipe(
      Effect.provideService(ViewThumbnails, {
        add: (grant) =>
          Effect.sync(() => {
            if (grant.variant === 'thumb' && !images.has(grant.entityId)) images.set(grant.entityId, grant)
          }),
      }),
      Effect.map((value) => ({ value, images })),
    )
  })

const encoder = new TextEncoder()

/** The bytes the signature covers: every field of the grant, in one order, under the key's label. */
const signedBytes = (grant: SignedGrant) =>
  encoder.encode(
    JSON.stringify([
      keyLabel,
      grant.accountId,
      grant.entityId,
      grant.key,
      grant.contentType,
      grant.variant,
      grant.version,
      grant.expires,
      ...(grant.rotation === undefined || grant.rotation === 0 ? [] : [grant.rotation]),
    ]),
  )

/** When an address made now ends: the next full hour, a day on.
 * @internal Exported for its boundary tests. */
export const expiryOf = (nowMillis: number) =>
  (Math.floor(nowMillis / 1000 / hourSeconds) + 1) * hourSeconds + lifetimeSeconds

/** The HMAC key addresses are signed with, derived from the auth secret under `keyLabel`, so the media key is never
 * the secret itself and needs no secret of its own.
 * @internal Exported for its signature tests. */
export const mediaKey = (authSecret: Redacted.Redacted) =>
  Effect.promise(async () => {
    const algorithm = { name: 'HMAC', hash: 'SHA-256' }
    const secret = await crypto.subtle.importKey('raw', encoder.encode(Redacted.value(authSecret)), algorithm, false, [
      'sign',
    ])
    const derived = await crypto.subtle.sign('HMAC', secret, encoder.encode(keyLabel))
    return crypto.subtle.importKey('raw', derived, algorithm, false, ['sign', 'verify'])
  })

/** @internal The address of a grant that ends at `expires`, signed with `key`. Exported for its tests. */
export const signGrant = (key: CryptoKey, grant: SignedGrant) =>
  Effect.map(
    Effect.promise(() => crypto.subtle.sign('HMAC', key, signedBytes(grant))),
    (signature) =>
      `/cdn/media/${encodeURIComponent(grant.entityId)}/${encodeURIComponent(grant.variant)}?${new URLSearchParams({
        a: grant.accountId,
        k: grant.key,
        t: grant.contentType,
        v: grant.version,
        e: String(grant.expires),
        ...(grant.rotation === undefined || grant.rotation === 0 ? {} : { r: String(grant.rotation) }),
        s: Base64Url.encode(new Uint8Array(signature)),
      }).toString()}`,
  )

const one = (value: string | ReadonlyArray<string> | undefined) => (typeof value === 'string' ? value : undefined)

/** The grant a presented address was signed for, at `nowMillis`: none for a wrong signature, an altered field, an
 * expired address, one that claims to live longer than any is made to, or a key outside its account's prefix.
 * @internal Exported for its tamper and expiry tests. */
export const verifyGrant = Effect.fnUntraced(function* (key: CryptoKey, presented: Presented, nowMillis: number) {
  const { query } = presented
  const [accountId, objectKey, contentType, version, expiresText, signature, rotationText] = [
    'a',
    'k',
    't',
    'v',
    'e',
    's',
    'r',
  ].map((name) => one(query[name]))
  if (
    accountId === undefined ||
    objectKey === undefined ||
    contentType === undefined ||
    version === undefined ||
    signature === undefined
  )
    return Option.none<SignedGrant>()
  const expires = Number(expiresText)
  const rotation = rotationText === undefined ? 0 : Number(rotationText)
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) return Option.none<SignedGrant>()
  const nowSeconds = nowMillis / 1000
  if (!Number.isSafeInteger(expires) || expires <= nowSeconds || expires > expiryOf(nowMillis))
    return Option.none<SignedGrant>()
  if (!objectKey.startsWith(`accounts/${accountId}/`)) return Option.none<SignedGrant>()
  const decoded = Base64Url.decode(signature)
  if (Result.isFailure(decoded)) return Option.none<SignedGrant>()
  const grant: SignedGrant = {
    accountId,
    entityId: presented.entityId,
    key: objectKey,
    contentType,
    variant: presented.variant,
    version,
    expires,
    rotation,
  }
  const signatureBytes = Uint8Array.from(decoded.success)
  const valid = yield* Effect.promise(() => crypto.subtle.verify('HMAC', key, signatureBytes, signedBytes(grant)))
  return valid ? Option.some(grant) : Option.none<SignedGrant>()
})

/** Signs addresses for the owner's browser and checks the ones it presents. */
export class SignedMedia extends Context.Service<
  SignedMedia,
  {
    /** The address of one of the current account's objects, for the website's browser only: none for an assistant,
     * which is never handed a capability to a picture. */
    readonly address: (
      grant: Omit<MediaGrant, 'accountId'>,
    ) => Effect.Effect<Option.Option<string>, never, CurrentAccount>
    /** The grant a request's address was signed for, if it is valid now. */
    readonly verify: (presented: Presented) => Effect.Effect<Option.Option<SignedGrant>>
  }
>()('@styld/server/kernel/SignedMedia') {
  static readonly layer = (authSecret: Redacted.Redacted) =>
    Layer.effect(
      this,
      Effect.map(mediaKey(authSecret), (key) =>
        SignedMedia.of({
          address: (grant) =>
            Effect.gen(function* () {
              const { accountId, via } = yield* CurrentAccount
              if (!grant.key.startsWith(`accounts/${accountId}/`)) return Option.none()
              if (via !== 'session') {
                const collector = yield* Effect.serviceOption(ViewThumbnails)
                if (Option.isSome(collector)) yield* collector.value.add({ ...grant, accountId })
                return Option.none()
              }
              const expires = expiryOf(yield* Clock.currentTimeMillis)
              return Option.some(yield* signGrant(key, { ...grant, accountId, expires }))
            }),
          verify: (presented) => Effect.flatMap(Clock.currentTimeMillis, (now) => verifyGrant(key, presented, now)),
        }),
      ),
    )
}

/** Two sizes of an already-authorized stored image. The underlying key and version are covered by each signature. */
export const imageAddresses = Effect.fnUntraced(function* (grant: Omit<MediaGrant, 'accountId' | 'variant'>) {
  const signed = yield* SignedMedia
  return Option.all({
    thumb: yield* signed.address({ ...grant, variant: 'thumb' }),
    full: yield* signed.address({ ...grant, variant: 'full' }),
  })
})
