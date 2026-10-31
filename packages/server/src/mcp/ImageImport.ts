import { ImageType, maximumImageBytes } from '@styld/protocol'
import { Effect, Option, Schema, Stream } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import type * as HttpClientResponse from 'effect/http/HttpClientResponse'

/** Why a photo address could not be imported, in words an assistant can act on. */
export class ImportRefused extends Schema.TaggedError<ImportRefused>()('ImportRefused', {
  reason: Schema.Literals(['notHttps', 'tooManyRedirects', 'notReached', 'notAnImage', 'tooLarge']),
}) {}

const maximumRedirects = 3
/** A photo server slower than this is treated as unreachable, so an assistant's call never hangs. */
const fetchTimeout = '10 seconds'

const refuse = (reason: ImportRefused['reason']) => ImportRefused.make({ reason })

/** Only public https on the default port: no other schemes, ports or credentials in the address. */
const allowedUrl = (text: string, base?: URL): Option.Option<URL> => {
  const url = URL.parse(text, base)
  if (url === null) return Option.none()
  const plain = url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
  return plain ? Option.some(url) : Option.none()
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
    client.execute(HttpClientRequest.get(url, { headers: { accept } })).pipe(
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

/** Fetch a photo an assistant points at. */
export const importImage = Effect.fn('Styld.Mcp.importImage')(function* (address: string) {
  const { response } = yield* fetchPublic(address, 'image/*')
  return yield* photoFrom(response)
})
