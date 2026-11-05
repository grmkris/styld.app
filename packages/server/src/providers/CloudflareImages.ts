import { busy } from './Errors.ts'
import { costs } from './Costs.ts'
import { deadlines, providerCall } from './Call.ts'
import { Effect } from 'effect'
import type { PieceRotation } from '@styld/protocol'
import type { ImagesBinding } from '../kernel/Media.ts'
import type { CaptureMetrics } from '../kernel/Metrics.ts'
import { type WorkingCopies } from '../capture/Providers.ts'
import { collect } from '../Streams.ts'

type ImageTransform = Parameters<ReturnType<ImagesBinding['input']>['transform']>[0]
type ImageOutput = Parameters<ReturnType<ImagesBinding['input']>['output']>[0]

const failed = (cause?: unknown) => busy('cloudflare-images', cause)

/** The bytes as the stream the Images binding reads. */
const streamOf = (bytes: Uint8Array) =>
  // SAFETY: a Response body is the Worker runtime's own ReadableStream -- the server package types globals with the DOM lib and the Images binding with workers-types
  new Response(bytes.slice().buffer).body as never

/** The width and height a PNG declares in its IHDR chunk.
 * @internal Exported for its tests. */
export const pngSize = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return png.byteLength >= 24 ? { width: view.getUint32(16), height: view.getUint32(20) } : { width: 0, height: 0 }
}

/** Styld's working copies of a photo are at most this wide or tall. */
const workingSize = 2048

/** Cloudflare Images through the Worker binding: working copies, background removal, thumbnails. */
export const makePictureWork = (images: ImagesBinding, metrics: CaptureMetrics['Service']) => {
  const transform = (
    bytes: Uint8Array,
    kind: 'normalise' | 'foreground',
    options: ImageTransform,
    output: ImageOutput,
  ) =>
    providerCall(
      metrics,
      {
        provider: 'cloudflare-images',
        model: options.segment === undefined ? 'transform' : 'segment',
        kind,
        deadline: deadlines.images,
        replaySafe: true,
      },
      Effect.tryPromise({
        try: async () => {
          const result = await images.input(streamOf(bytes)).transform(options).output(output)
          return collect(result.image())
        },
        catch: failed,
      }),
      () => ({ units: 1, costMicroUsd: costs.imagesPerTransform }),
    )
  const sized = { width: workingSize, height: workingSize, fit: 'scale-down' } as const
  return {
    workingCopies: Effect.fn('Styld.Capture.workingCopies')(function* (original: Uint8Array) {
      const [png, jpeg, small] = yield* Effect.all(
        [
          transform(original, 'normalise', sized, { format: 'image/png' }),
          transform(original, 'normalise', sized, { format: 'image/jpeg', quality: 88 }),
          transform(
            original,
            'normalise',
            { width: 768, height: 768, fit: 'scale-down' },
            { format: 'image/jpeg', quality: 80 },
          ),
        ],
        { concurrency: 3 },
      )
      return { ...pngSize(png), png, jpeg, small } satisfies WorkingCopies
    }),
    foreground: Effect.fn('Styld.Capture.foreground')(function* (original: Uint8Array) {
      return yield* transform(original, 'foreground', { ...sized, segment: 'foreground' }, { format: 'image/png' })
    }),
    jpeg: Effect.fn('Styld.Capture.jpeg')(function* (image: Uint8Array) {
      return yield* transform(image, 'normalise', sized, { format: 'image/jpeg', quality: 92 })
    }),
    thumbnail: Effect.fn('Styld.Capture.thumbnail')(function* (
      image: Uint8Array,
      width: number,
      rotate: PieceRotation = 0,
    ) {
      return yield* transform(
        image,
        'normalise',
        { width, height: width, fit: 'scale-down', rotate },
        { format: 'image/webp', quality: 75 },
      )
    }),
  }
}
