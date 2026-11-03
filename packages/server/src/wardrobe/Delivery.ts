import { Unavailable, type PieceRotation } from '@styld/protocol'
import { Effect, Option } from 'effect'
import type { Media } from '../kernel/Media.ts'
import type { ByteStream } from '../Streams.ts'
import { type ImageSize, imageSizes } from './Media.ts'

/** An image as a route answers it. Callers only read it, so it is typed as any byte stream, Worker or DOM. */
export interface DeliveredImage {
  readonly body: ByteStream
  readonly contentType: string
}

/** The storage and transform operations needed to deliver a picture. */
type BoundTransformer = ReturnType<Media['Service']['images']['input']>
interface ImageTransformer {
  readonly transform: (options: Parameters<BoundTransformer['transform']>[0]) => ImageTransformer
  readonly output: (options: Parameters<BoundTransformer['output']>[0]) => Promise<{
    readonly image: () => ByteStream
    readonly contentType: () => string
  }>
}
export interface ImageBindings {
  readonly bucket: {
    readonly get: (key: string) => Promise<{
      readonly body: ByteStream
      readonly httpMetadata?: { readonly contentType?: string }
    } | null>
  }
  readonly images: {
    readonly input: (bytes: Parameters<Media['Service']['images']['input']>[0]) => ImageTransformer
  }
}

const unavailable = () => Unavailable.make({})

/** What a failed transform answers: the stored bytes (the owner's own browser), or no image (anything that leaves
 * Styld: others' pages, an assistant's host), since the stored bytes may be an original photo with its metadata. */
export interface Delivery {
  readonly fallback: 'stored' | 'none'
  readonly rotation?: PieceRotation | undefined
}

/** Only what the Images binding transformed: no original bytes, so no EXIF or GPS. */
export const transformedOnly: Delivery = { fallback: 'none' }

/** A stored photo resized to WebP by the Images binding, at one of the sizes the website shows. A photo the
 * binding cannot transform is served as it was stored; a photo no longer in the bucket is none. */
export const deliverImage = Effect.fnUntraced(function* (
  bindings: ImageBindings,
  stored: { readonly key: string; readonly contentType: string },
  size: ImageSize,
  options: Delivery = { fallback: 'stored' },
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
        .transform({ width: imageSizes[size], fit: 'scale-down', rotate: options.rotation ?? 0 })
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
