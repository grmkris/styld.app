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

/** The content of the page's `<meta>` for the first of these properties it has. */
const metaContent = (html: string, names: ReadonlyArray<string>) => {
  const metas = [...html.matchAll(/<meta\b[^>]*>/giu)].map(([tag]) => attributesOf(tag))
  return Option.fromNullishOr(
    names
      .map((name) => metas.find((attributes) => (attributes.get('property') ?? attributes.get('name')) === name))
      .map((attributes) => attributes?.get('content'))
      .find((content) => content !== undefined && content.trim().length > 0),
  )
}

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

/** The bodies of the page's JSON-LD scripts, found in one pass: a page of unclosed tags costs no more than its
 * length. */
const jsonLdBlocks = (html: string): ReadonlyArray<string> => {
  const lower = html.toLowerCase()
  const blocks: Array<string> = []
  let from = 0
  for (;;) {
    const open = lower.indexOf('<script', from)
    if (open < 0) return blocks
    const tagEnd = lower.indexOf('>', open)
    if (tagEnd < 0) return blocks
    const close = lower.indexOf('</script', tagEnd)
    if (close < 0) return blocks
    if (lower.slice(open, tagEnd).includes('application/ld+json')) blocks.push(html.slice(tagEnd + 1, close))
    from = close + 1
  }
}

/** The page's JSON-LD `Product`, if it has one. */
const productOf = (html: string) =>
  Option.fromNullishOr(
    jsonLdBlocks(html)
      .flatMap((block) => nodesOf(parsed(block)))
      .find(isProduct),
  )

/** What a product page says about itself, read from its HTML; its picture's address is made absolute on the page.
 * @internal Exported for its tests. */
export const productFrom = (html: string, page: URL): Option.Option<ProductPage> => {
  const product = productOf(html)
  const image = Option.flatMap(product, (node) => imageOf(node['image'])).pipe(
    Option.orElse(() => metaContent(html, ['og:image:secure_url', 'og:image', 'twitter:image'])),
    Option.flatMap((address) => Option.fromNullishOr(URL.parse(address.trim(), page))),
    // Shops still name pictures over plain http that their CDN serves over https too; only https is fetched.
    Option.map((url) => (url.protocol === 'http:' ? `https:${url.href.slice('http:'.length)}` : url.href)),
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

/** A page slower than this to arrive is treated as unreachable. */
const pageTimeout = '10 seconds'

/** The page's HTML, at most `pageBytes` of it: the rest is never read, and a page that trickles is given up. */
const htmlOf = (response: HttpClientResponse.HttpClientResponse) => {
  let read = 0
  return response.stream.pipe(
    Stream.takeWhile((chunk) => {
      const within = read < pageBytes
      read += chunk.byteLength
      return within
    }),
    Stream.mapError(() => LinkRefused.make({ reason: 'notReached' })),
    Stream.runFoldEffect(
      () => '',
      (text, chunk) => Effect.succeed(text + decoder.decode(chunk, { stream: true })),
    ),
    Effect.timeout(pageTimeout),
    Effect.catchTag('TimeoutError', () => Effect.fail(LinkRefused.make({ reason: 'notReached' }))),
  )
}

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
