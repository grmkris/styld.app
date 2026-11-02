import { Unavailable } from '@styld/protocol'
import { Effect, Option } from 'effect'
import type { Media } from '../kernel/Media.ts'
import type { ByteStream } from '../Streams.ts'
import { type ImageSize, imageSizes } from './Media.ts'

/** An image as a route answers it. Callers only read it, so it is typed as any byte stream, Worker or DOM. */
export interface DeliveredImage {
  readonly body: ByteStream
  readonly contentType: string
}

const unavailable = () => Unavailable.make({})

/** A stored photo resized to WebP by the Images binding, at one of the sizes the website shows. A photo the
 * binding cannot transform is served as it was stored; a photo no longer in the bucket is none. */
export const deliverImage = Effect.fnUntraced(function* (
  bindings: Media['Service'],
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
      const bytes = object.body as Parameters<Media['Service']['images']['input']>[0]
      const result = await bindings.images
        .input(bytes)
        .transform({ width: imageSizes[size], fit: 'scale-down' })
        .output({ format: 'image/webp', quality: 82 })
      return Option.some<DeliveredImage>({ body: result.image(), contentType: result.contentType() })
    },
    catch: unavailable,
  }).pipe(
    // The transform consumed the first read, so the stored photo is read again.
    Effect.catchTag('Unavailable', (error) =>
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
