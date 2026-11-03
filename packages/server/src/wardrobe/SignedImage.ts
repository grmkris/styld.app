import { Clock, Effect, Option, Predicate, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { Media } from '../kernel/Media.ts'
import { type SignedGrant, SignedMedia } from '../kernel/SignedMedia.ts'
import { collect } from '../Streams.ts'
import { deliverImage, transformedOnly } from './Delivery.ts'
import { ShownSize } from './Media.ts'

// `GET /cdn/media/:entityId/:size?…`: an owner-only picture by its signed address (`kernel/SignedMedia.ts`). The
// signature is the only credential: no session and no D1 on the way, so a screen of eighty thumbnails is eighty reads
// of R2 and the Images binding, or of the edge cache. A wrong, altered or expired address is refused before anything
// is read.

const SignedTarget = Schema.Struct({
  entityId: Schema.String,
  size: ShownSize,
  a: Schema.optionalKey(Schema.String),
  k: Schema.optionalKey(Schema.String),
  t: Schema.optionalKey(Schema.String),
  v: Schema.optionalKey(Schema.String),
  e: Schema.optionalKey(Schema.String),
  s: Schema.optionalKey(Schema.String),
})

/** How long the browser and the edge keep the picture: until its address expires. */
const lifetimeOf = (grant: SignedGrant, nowMillis: number) => Math.max(0, Math.floor(grant.expires - nowMillis / 1000))

const headersFor = (contentType: string, maxAge: number, scope: 'private' | 'public') => ({
  'content-type': contentType,
  'cache-control': `${scope}, max-age=${String(maxAge)}, immutable`,
})

/** The edge cache as this route uses it. */
interface EdgeCache {
  match(key: string): Promise<CachedPicture | undefined>
  put(key: string, response: Response): Promise<void>
}
interface CachedPicture {
  arrayBuffer(): Promise<ArrayBuffer>
  readonly headers: { get(name: string): string | null }
}

const isEdgeCache = (value: unknown): value is EdgeCache =>
  Predicate.hasProperty(value, 'match') &&
  Predicate.hasProperty(value, 'put') &&
  Predicate.isFunction(value.match) &&
  Predicate.isFunction(value.put)

/** The Workers runtime's default cache: workers-types declares `caches.default`, the DOM lib the server package also
 * compiles against does not, so it is read as what it is found to be. */
const zoneCache = (): Option.Option<EdgeCache> => {
  const storage: unknown = globalThis.caches
  return Predicate.hasProperty(storage, 'default') && isEdgeCache(storage.default)
    ? Option.some(storage.default)
    : Option.none()
}

/** The edge cache, keyed by the whole signed address: the address is the capability, so a copy there shows only to
 * whoever holds it. A cache that does not answer (none on this host, or a failure) is a miss, never an error. */
const edgeCache = {
  match: (key: string) =>
    Option.match(zoneCache(), {
      onNone: () => Effect.succeed(Option.none<CachedPicture>()),
      onSome: (cache) =>
        Effect.tryPromise(() => cache.match(key)).pipe(
          Effect.map(Option.fromNullishOr),
          Effect.orElseSucceed(() => Option.none<CachedPicture>()),
        ),
    }),
  put: (key: string, bytes: Uint8Array, contentType: string, maxAge: number) =>
    Option.match(zoneCache(), {
      onNone: () => Effect.void,
      onSome: (cache) =>
        Effect.tryPromise(() =>
          cache.put(key, new Response(new Uint8Array(bytes), { headers: headersFor(contentType, maxAge, 'public') })),
        ).pipe(Effect.ignore),
    }),
}

/** The picture a valid grant names, transformed to its size: from the edge cache, else R2 and the Images binding.
 * Only transformed bytes are served, never the stored object, since the address leaves the session behind. */
const picture = Effect.fnUntraced(function* (grant: SignedGrant, size: ShownSize, cacheKey: string, maxAge: number) {
  const cached = yield* edgeCache.match(cacheKey)
  if (Option.isSome(cached)) {
    const bytes = new Uint8Array(yield* Effect.tryPromise(() => cached.value.arrayBuffer()))
    return Option.some({ bytes, contentType: cached.value.headers.get('content-type') ?? 'image/webp' })
  }
  const stored = { key: grant.key, contentType: grant.contentType }
  const delivered = yield* deliverImage(yield* Media, stored, size, transformedOnly)
  if (Option.isNone(delivered)) return Option.none()
  const { body, contentType } = delivered.value
  const bytes = yield* Effect.tryPromise(() => collect(body))
  yield* edgeCache.put(cacheKey, bytes, contentType, maxAge)
  return Option.some({ bytes, contentType })
})

export const signedImage = Effect.gen(function* () {
  const signed = yield* SignedMedia
  const media = yield* Media
  return Effect.gen(function* () {
    const target = yield* HttpRouter.schemaParams(SignedTarget).pipe(Effect.option)
    if (Option.isNone(target)) return HttpServerResponse.empty({ status: 404 })
    const { entityId, size, ...query } = target.value
    const grant = yield* signed.verify({ entityId, variant: size, query })
    if (Option.isNone(grant)) return HttpServerResponse.empty({ status: 403 })
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = HttpServerRequest.toURL(request)
    if (Option.isNone(url)) return HttpServerResponse.empty({ status: 404 })
    const maxAge = lifetimeOf(grant.value, yield* Clock.currentTimeMillis)
    const shown = yield* picture(grant.value, size, url.value.href, maxAge).pipe(
      Effect.provideService(Media, media),
      Effect.option,
    )
    if (Option.isNone(shown)) return HttpServerResponse.empty({ status: 503 })
    if (Option.isNone(shown.value)) return HttpServerResponse.empty({ status: 404 })
    const { bytes, contentType } = shown.value.value
    return HttpServerResponse.uint8Array(bytes, {
      contentType,
      headers: { 'cache-control': headersFor(contentType, maxAge, 'private')['cache-control'] },
    })
  })
})
