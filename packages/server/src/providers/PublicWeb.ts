import { Effect, Layer, Option, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

// The public web as Styld reads it for the person: a photo or a shop's page at an address someone gave. Only public
// https hosts, redirects followed by hand and each hop checked, a deadline on every hop, and no trace of it in Styld's
// spans or sent to the site. The one HTTP transport to addresses that are not a provider's; callers map its refusal
// to their own.

/** Why an address could not be fetched: not a public https address, too many redirects, or no answer in time. */
export class PublicFetchRefused extends Schema.TaggedError<PublicFetchRefused>()('PublicFetchRefused', {
  reason: Schema.Literals(['notHttps', 'tooManyRedirects', 'notReached']),
}) {}

const maximumRedirects = 3
/** Styld names itself, as link previews do; a site that keeps robots out still can. */
const userAgent = 'Mozilla/5.0 (compatible; Styld/1.0; +https://styld.app)'
/** A server slower than this is treated as unreachable, so an assistant's call never hangs. */
export const fetchTimeout = '10 seconds'

const refuse = (reason: PublicFetchRefused['reason']) => PublicFetchRefused.make({ reason })

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

/** Only public https on the default port: no other schemes, ports, credentials or private hosts in the address.
 * @internal Exported for its tests. */
export const allowedUrl = (text: string, base?: URL): Option.Option<URL> => {
  const url = URL.parse(text, base)
  if (url === null) return Option.none()
  const plain = url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
  return plain && isPublicHost(url.hostname.toLowerCase()) ? Option.some(url) : Option.none()
}

/** The final response for a public https address, with the address it came from. Redirects are followed by hand,
 * at most three, and each hop must pass the same address rules; the HttpClient must not follow them itself. */
export const fetchPublic = Effect.fn('Styld.PublicWeb.fetch')(function* (address: string, accept: string) {
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

/** The HTTP transport to the public web: it never follows a redirect itself, so whoever reads through it checks each
 * hop (`fetchPublic` here, the MCP OAuth server for client metadata documents). */
export const publicWebTransport = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: 'manual' })),
)

/** The client public fetches go through. */
export const publicClient = HttpClient.HttpClient.pipe(Effect.provide(publicWebTransport))
