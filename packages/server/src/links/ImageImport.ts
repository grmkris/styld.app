import { byCase, ImageType, maximumImageBytes, refusal } from '@styld/protocol'
import { Effect, Option, Schema, Stream } from 'effect'
import type * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { fetchPublic, fetchTimeout } from '../providers/PublicWeb.ts'
import { receivedUpload, type Uploads } from '../wardrobe/Received.ts'

// A photo at a public address, fetched into a received upload of the person's: what `Links.ts` and the product pages
// of `LinkPicture.ts` read, with refusals worded for the person or their assistant.

/** Why a photo address could not be imported, in words an assistant can act on. */
const ImportRefusal = Schema.Literals(['notHttps', 'tooManyRedirects', 'notReached', 'notAnImage', 'tooLarge'])

class ImportRefused extends Schema.TaggedError<ImportRefused>()(
  'ImportRefused',
  { reason: ImportRefusal },
  {
    guide: byCase<typeof ImportRefusal.Type>('reason', {
      notHttps: refusal(
        'photo_refused',
        'The photo address must be a plain https URL on the default port.',
        'Give an https:// address of the image itself.',
      ),
      tooManyRedirects: refusal(
        'photo_refused',
        'The photo address redirected more than three times.',
        'Give the final address of the image.',
      ),
      notReached: refusal(
        'photo_refused',
        'Styld could not download the photo from that address.',
        'Check the address is public, or upload the photo with upload_create.',
      ),
      notAnImage: refusal(
        'photo_refused',
        'The file is not a JPEG, PNG, WebP, AVIF or GIF image.',
        'Use a photo in one of those formats.',
      ),
      tooLarge: refusal('photo_refused', 'The photo is larger than 15 MB.', 'Use a smaller photo.'),
    }),
  },
) {}

const refuse = (reason: ImportRefused['reason']) => ImportRefused.make({ reason })

const isImageType = Schema.is(ImageType)

const concat = (chunks: ReadonlyArray<Uint8Array>, size: number) => {
  const bytes = new Uint8Array(size)
  chunks.reduce((offset, chunk) => {
    bytes.set(chunk, offset)
    return offset + chunk.byteLength
  }, 0)
  return bytes
}

/** The body, refused as soon as it passes the size limit rather than after reading it all. */
const readCapped = (stream: Stream.Stream<Uint8Array, unknown>) =>
  stream.pipe(
    Stream.mapError(() => refuse('notReached')),
    Stream.runFoldEffect(
      (): { readonly chunks: ReadonlyArray<Uint8Array>; readonly size: number } => ({ chunks: [], size: 0 }),
      ({ chunks, size }, chunk) =>
        size + chunk.byteLength > maximumImageBytes
          ? Effect.fail(refuse('tooLarge'))
          : Effect.succeed({ chunks: [...chunks, chunk], size: size + chunk.byteLength }),
    ),
    Effect.map(({ chunks, size }) => concat(chunks, size)),
  )

/** The response's media type, without parameters, if it is one Styld accepts. */
const imageTypeOf = (headers: Readonly<Record<string, string | undefined>>) =>
  Option.liftPredicate((headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '', isImageType)

/** The photo from a final (non-redirect) response, or why it is not one. */
const photoFrom = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.gen(function* () {
    if (response.status !== 200) return yield* refuse('notReached')
    const contentType = imageTypeOf(response.headers)
    if (Option.isNone(contentType)) return yield* refuse('notAnImage')
    if (Number(response.headers['content-length'] ?? 0) > maximumImageBytes) return yield* refuse('tooLarge')
    return {
      contentType: contentType.value,
      bytes: yield* readCapped(response.stream).pipe(
        Effect.timeout(fetchTimeout),
        Effect.catchTag('TimeoutError', () => Effect.fail(refuse('notReached'))),
      ),
    }
  })

/** Fetch a photo at an address the person or their assistant gives, through the public web's one transport
 * (`providers/PublicWeb.ts`).
 * @internal Exported for its tests. */
export const importImage = Effect.fn('Styld.Links.importImage')(function* (address: string) {
  const { response } = yield* fetchPublic(address, 'image/*').pipe(
    Effect.catchTag('PublicFetchRefused', ({ reason }) => Effect.fail(refuse(reason))),
  )
  return yield* photoFrom(response)
})

/** Fetch a photo into a fresh received upload of the person's, through the same checks as one they send. */
export const importedUpload = (wardrobe: Uploads, address: string) =>
  Effect.flatMap(importImage(address), (image) => receivedUpload(wardrobe, image))
