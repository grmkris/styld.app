import type * as Cloudflare from '@alchemy.run/cloudflare'
import { WardrobeUnavailable } from '@styld/protocol'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { Effect, Option } from 'effect'
import type { ByteStream } from '../Streams.ts'
import { type ImageSize, imageSizes } from './Media.ts'

type Runtime<Client extends { readonly raw: Effect.Effect<unknown> | Effect.Effect<unknown, never, RuntimeContext> }> =
  Effect.Success<Client['raw']>

/** The bucket photos are stored in and the Images binding that resizes them, as Alchemy's runtime objects. */
export interface ImageBindings {
  readonly bucket: Runtime<Cloudflare.R2.ReadWriteBucketClient>
  readonly images: Runtime<Cloudflare.Images.ImagesClient>
}

/** An image as a route answers it. Callers only read it, so it is typed as any byte stream, Worker or DOM. */
export interface DeliveredImage {
  readonly body: ByteStream
  readonly contentType: string
}

const unavailable = () => WardrobeUnavailable.make({})

/** A stored photo resized to WebP by the Images binding, at one of the sizes the website shows. A photo the
 * binding cannot transform is served as it was stored; a photo no longer in the bucket is none. */
export const deliverImage = Effect.fnUntraced(function* (
  bindings: ImageBindings,
  stored: { readonly key: string; readonly contentType: string },
  size: ImageSize,
  /** `none` for anything others see: a failed transform answers no image rather than the stored bytes, which may
   * be an original photo with its metadata. */
  options: { readonly fallback: 'stored' | 'none' } = { fallback: 'stored' },
) {
  const read = Effect.tryPromise({ try: () => bindings.bucket.get(stored.key), catch: unavailable })
  const object = yield* read
  if (object === null) return Option.none<DeliveredImage>()
  return yield* Effect.tryPromise({
    try: async () => {
      // SAFETY: an R2 object's body is the stored image's bytes -- workers-types declares the body as ReadableStream<any>
      const bytes = object.body as Parameters<ImageBindings['images']['input']>[0]
      const result = await bindings.images
        .input(bytes)
        .transform({ width: imageSizes[size], fit: 'scale-down' })
        .output({ format: 'image/webp', quality: 82 })
      return Option.some<DeliveredImage>({ body: result.image(), contentType: result.contentType() })
    },
    catch: unavailable,
  }).pipe(
    // The transform consumed the first read, so the stored photo is read again.
    Effect.catchTag('WardrobeUnavailable', (error) =>
      options.fallback === 'none'
        ? Effect.fail(error)
        : Effect.map(read, (again) =>
            Option.map(Option.fromNullishOr(again), ({ body, httpMetadata }): DeliveredImage => ({
              body,
              contentType: httpMetadata?.contentType ?? stored.contentType,
            })),
          ),
    ),
  )
})
