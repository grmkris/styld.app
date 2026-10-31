import { LinkRefused } from '@styld/protocol'
import { Effect, Option, Stream } from 'effect'
import type * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { fetchPublic } from '../mcp/ImageImport.ts'

// A product page as Styld reads it: its picture and its name, from the page's JSON-LD `Product`, else its Open
// Graph or Twitter tags. Only public https pages, fetched with the same guard as a photo; a shop that refuses
// answers that it did, so the person can send a photo instead.

/** What a product page says about itself. */
export interface ProductPage {
  readonly image: string
  readonly title: Option.Option<string>
}

/** The most of a page read: enough for its head and its JSON-LD. */
const pageBytes = 1_000_000

const entities: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" }
const unescaped = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|#39|apos);/gu, (_, name: string) => entities[name] ?? '')

/** A tag's attributes, by lowercase name. */
const attributesOf = (tag: string) =>
  new Map(
    [...tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)].map(
      (match) => [match[1]?.toLowerCase() ?? '', unescaped(match[2] ?? match[3] ?? '')] as const,
    ),
  )

/** The content of the first `<meta>` naming one of these properties. */
const metaContent = (html: string, names: ReadonlyArray<string>) =>
  Option.fromNullishOr(
    [...html.matchAll(/<meta\b[^>]*>/giu)]
      .map(([tag]) => attributesOf(tag))
      .find((attributes) => names.includes(attributes.get('property') ?? attributes.get('name') ?? ''))
      ?.get('content'),
  ).pipe(Option.filter((content) => content.trim().length > 0))

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Every object in a JSON-LD document, through arrays and `@graph`. */
const nodesOf = (value: unknown): ReadonlyArray<Readonly<Record<string, unknown>>> => {
  if (Array.isArray(value)) return value.flatMap(nodesOf)
  if (!isRecord(value)) return []
  return [value, ...nodesOf(value['@graph'])]
}

const isProduct = (node: Readonly<Record<string, unknown>>) => {
  const type = node['@type']
  return type === 'Product' || (Array.isArray(type) && type.includes('Product'))
}

/** A JSON-LD image: a string, the first of a list, or an object's `url`. */
const imageOf = (value: unknown): Option.Option<string> => {
  if (typeof value === 'string') return Option.some(value)
  if (Array.isArray(value)) return value.length === 0 ? Option.none() : imageOf(value[0])
  return isRecord(value) ? imageOf(value['url']) : Option.none()
}

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** The page's JSON-LD `Product`, if it has one. */
const productOf = (html: string) =>
  Option.fromNullishOr(
    [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)]
      .flatMap((match) => nodesOf(parsed(match[1] ?? '')))
      .find(isProduct),
  )

/** What a product page says about itself, read from its HTML; its picture's address is made absolute on the page. */
export const productFrom = (html: string, page: URL): Option.Option<ProductPage> => {
  const product = productOf(html)
  const image = Option.flatMap(product, (node) => imageOf(node['image'])).pipe(
    Option.orElse(() => metaContent(html, ['og:image', 'og:image:secure_url', 'twitter:image'])),
    Option.flatMap((address) => Option.fromNullishOr(URL.parse(address.trim(), page)?.href)),
  )
  const title = Option.flatMap(product, (node) =>
    typeof node['name'] === 'string' ? Option.some(node['name']) : Option.none(),
  ).pipe(
    Option.orElse(() => metaContent(html, ['og:title', 'twitter:title'])),
    Option.map((text) => unescaped(text).trim().slice(0, 80).trim()),
    Option.filter((text) => text.length > 0),
  )
  return Option.map(image, (address) => ({ image: address, title }))
}

const decoder = new TextDecoder()

/** The page's HTML, at most `pageBytes` of it. */
const htmlOf = (response: HttpClientResponse.HttpClientResponse) =>
  response.stream.pipe(
    Stream.mapError(() => LinkRefused.make({ reason: 'notReached' })),
    Stream.runFoldEffect(
      () => '',
      (text, chunk) => Effect.succeed(text.length > pageBytes ? text : text + decoder.decode(chunk, { stream: true })),
    ),
  )

/** Read a product page at a public https address: its picture and name, or why there is nothing to add. */
export const readProductPage = Effect.fn('Styld.Links.readProductPage')(function* (address: string) {
  const { response, url } = yield* fetchPublic(address, 'text/html').pipe(
    Effect.mapError((refused) =>
      LinkRefused.make({ reason: refused.reason === 'notHttps' ? 'notHttps' : 'notReached' }),
    ),
  )
  // Shops that keep robots out answer with a refusal or a challenge rather than the page.
  if ([401, 403, 429, 503].includes(response.status)) return yield* LinkRefused.make({ reason: 'blocked' })
  if (response.status !== 200) return yield* LinkRefused.make({ reason: 'notReached' })
  if (!(response.headers['content-type'] ?? '').toLowerCase().includes('html'))
    return yield* LinkRefused.make({ reason: 'notAPage' })
  const html = yield* htmlOf(response)
  return yield* Option.match(productFrom(html, url), {
    onNone: () => Effect.fail(LinkRefused.make({ reason: 'noPicture' })),
    onSome: Effect.succeed,
  })
})
