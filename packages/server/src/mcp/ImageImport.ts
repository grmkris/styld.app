import { ImageType, maximumImageBytes } from '@styld/protocol'
import { Effect, Layer, Option, Schema, Stream } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import type * as HttpClientResponse from 'effect/http/HttpClientResponse'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'

/** Why a photo address could not be imported, in words an assistant can act on. */
export class ImportRefused extends Schema.TaggedError<ImportRefused>()('ImportRefused', {
  reason: Schema.Literals(['notHttps', 'tooManyRedirects', 'notReached', 'notAnImage', 'tooLarge']),
}) {}

const maximumRedirects = 3
/** Styld names itself, as link previews do; a site that keeps robots out still can. */
const userAgent = 'Mozilla/5.0 (compatible; Styld/1.0; +https://styld.app)'
/** A photo server slower than this is treated as unreachable, so an assistant's call never hangs. */
const fetchTimeout = '10 seconds'

const refuse = (reason: ImportRefused['reason']) => ImportRefused.make({ reason })

/** Names that only resolve inside a network, never on the public web. */
const privateSuffixes = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.ts.net']

/** A public host name: not an IP address, not one label alone, not a private network's name. */
const isPublicHost = (hostname: string) =>
  hostname.includes('.') &&
  !hostname.includes(':') &&
  !hostname.startsWith('[') &&
  !/^[\d.]+$/u.test(hostname) &&
  hostname !== 'localhost' &&
  !privateSuffixes.some((suffix) => hostname.endsWith(suffix))

/** Only public https on the default port: no other schemes, ports, credentials or private hosts in the address. */
export const allowedUrl = (text: string, base?: URL): Option.Option<URL> => {
  const url = URL.parse(text, base)
  if (url === null) return Option.none()
  const plain = url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
  return plain && isPublicHost(url.hostname.toLowerCase()) ? Option.some(url) : Option.none()
}

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

/** The final response for a public https address, with the address it came from. Redirects are followed by hand,
 * at most three, and each hop must pass the same address rules; the HttpClient must not follow them itself. */
export const fetchPublic = Effect.fn('Styld.Mcp.fetchPublic')(function* (address: string, accept: string) {
  const client = yield* HttpClient.HttpClient
  const fetchHop = (url: URL) =>
    client.execute(HttpClientRequest.get(url, { headers: { accept, 'user-agent': userAgent } })).pipe(
      // Others' addresses carry signatures and tokens: they stay out of spans, and no trace goes to their sites.
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.timeout(fetchTimeout),
      Effect.mapError(() => refuse('notReached')),
    )
  let url = yield* Option.match(allowedUrl(address), {
    onNone: () => Effect.fail(refuse('notHttps')),
    onSome: Effect.succeed,
  })
  for (let hop = 0; hop <= maximumRedirects; hop += 1) {
    const response = yield* fetchHop(url)
    if (response.status < 300 || response.status >= 400) return { response, url }
    const next = allowedUrl(response.headers['location'] ?? '', url)
    if (Option.isNone(next)) return yield* refuse('notHttps')
    url = next.value
  }
  return yield* refuse('tooManyRedirects')
})

/** The client public fetches go through: it never follows a redirect itself, so each hop is checked here. */
export const publicClient = HttpClient.HttpClient.pipe(
  Effect.provide(
    FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: 'manual' }))),
  ),
)

/** Fetch a photo an assistant points at. */
export const importImage = Effect.fn('Styld.Mcp.importImage')(function* (address: string) {
  const { response } = yield* fetchPublic(address, 'image/*')
  return yield* photoFrom(response)
})

/** What an import needs of the wardrobe: making an upload and receiving its bytes. */
export type Uploads = Pick<Wardrobe['Service'], 'createUpload' | 'receiveUpload'>

/** Fetch a photo into a fresh received upload of the person's, through the same checks as one they send. */
export const importedUpload = (wardrobe: Uploads, address: string) =>
  Effect.flatMap(importImage(address), (image) => receivedUpload(wardrobe, image))

/** Picture bytes Styld holds as a fresh received upload of the person's, through the same checks as one they send. */
export const receivedUpload = (
  wardrobe: Uploads,
  { contentType, bytes }: { readonly contentType: ImageType; readonly bytes: Uint8Array },
) =>
  Effect.gen(function* () {
    const upload = yield* wardrobe.createUpload({ contentType, bytes: bytes.byteLength })
    // The upload's path carries its one-time token; the origin it is read against does not matter.
    const token = new URL(upload.path, 'https://styld.invalid').searchParams.get('token') ?? ''
    yield* wardrobe.receiveUpload({ uploadId: upload.uploadId, token, contentType, body: bytes })
    return upload.uploadId
  })
