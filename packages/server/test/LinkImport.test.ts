import { UploadId } from '@styld/protocol'
import { Effect, Option } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import { describe, expect, test } from 'vitest'
import { productFrom, readProductPage } from '../src/links/LinkImport.ts'
import { CurrentAccount } from '../src/CurrentAccount.ts'
import { pictureFromLink } from '../src/links/LinkPicture.ts'
import type { Uploads } from '../src/mcp/ImageImport.ts'
import { serving } from './HttpFixture.ts'

const page = new URL('https://shop.test/products/navy-knit')

describe('reading a product page', () => {
  test('takes the JSON-LD Product first: its name and its first picture, made absolute', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.shop.test/og.jpg">
      <meta property="og:title" content="Shop &amp; Co">
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},
        {"@type":"Product","name":"Navy cable knit","image":["/img/knit-front.jpg","/img/knit-back.jpg"]}]}</script>
    </head></html>`
    expect(productFrom(html, page)).toEqual(
      Option.some({ image: 'https://shop.test/img/knit-front.jpg', title: Option.some('Navy cable knit') }),
    )
  })

  test('falls back to Open Graph, in either attribute order, with entities read', () => {
    const html = `<meta content="https://cdn.shop.test/a.jpg?w=800&amp;h=1000" property="og:image" />
      <meta name="twitter:title" content="Raincoat &quot;Mila&quot;">`
    expect(productFrom(html, page)).toEqual(
      Option.some({ image: 'https://cdn.shop.test/a.jpg?w=800&h=1000', title: Option.some('Raincoat "Mila"') }),
    )
  })

  test('a page without a picture gives nothing to add, and broken JSON-LD is passed over', () => {
    expect(productFrom('<script type="application/ld+json">{oops</script><title>Shop</title>', page)).toEqual(
      Option.none(),
    )
  })
})

const run = (address: string, routes: Record<string, () => Response>) =>
  Effect.runPromise(
    readProductPage(address).pipe(
      Effect.provideService(HttpClient.HttpClient, serving(routes)),
      Effect.map(({ image }) => image),
      Effect.catchTag('LinkRefused', ({ reason }) => Effect.succeed(reason)),
    ),
  )

const html = (body: string) => () => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })

describe('fetching a product page', () => {
  test('follows a redirect to the page and reads its picture', async () => {
    expect(
      await run('https://shop.test/p/1', {
        'https://shop.test/p/1': () => new Response(null, { status: 301, headers: { location: '/products/1' } }),
        'https://shop.test/products/1': html('<meta property="og:image" content="/i/1.jpg">'),
      }),
    ).toBe('https://shop.test/i/1.jpg')
  })

  test('says a shop that keeps robots out blocked it, so the person can send a photo instead', async () => {
    expect(
      await run('https://shop.test/p/2', { 'https://shop.test/p/2': () => new Response('', { status: 403 }) }),
    ).toBe('blocked')
  })

  test('refuses anything but a public https page', async () => {
    expect(await run('http://shop.test/p/3', {})).toBe('notHttps')
    expect(await run('https://shop.test:8443/p/3', {})).toBe('notHttps')
    expect(
      await run('https://shop.test/p/4', {
        'https://shop.test/p/4': () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
      }),
    ).toBe('notAPage')
  })
})

describe('a product page for the review tray', () => {
  const uploadId = UploadId.make(`up_${'knit'.padEnd(22, 'x')}`)
  const received: Array<{ readonly token: string; readonly contentType: string; readonly bytes: number }> = []
  const uploads: Uploads = {
    createUpload: () =>
      Effect.succeed({ uploadId, path: `/api/uploads/${uploadId}?token=once`, expiresAt: '2026-10-31T09:00:00.000Z' }),
    receiveUpload: (input: { readonly token: string; readonly contentType: string; readonly body: Uint8Array }) =>
      Effect.as(
        Effect.sync(() =>
          received.push({ token: input.token, contentType: input.contentType, bytes: input.body.byteLength }),
        ),
        undefined,
      ),
  }
  const read = (routes: Record<string, () => Response>) =>
    Effect.runPromise(
      pictureFromLink(uploads, 'https://shop.test/p/knit').pipe(
        Effect.provideService(HttpClient.HttpClient, serving(routes)),
        Effect.provideService(CurrentAccount, { accountId: 'acc_1', via: 'session' }),
        Effect.catchTag('LinkRefused', ({ reason }) => Effect.succeed(reason)),
      ),
    )
  const knitPage = html(
    '<meta property="og:image" content="/i/knit.webp"><meta property="og:title" content="Navy knit">',
  )

  test('takes the page’s picture into a received upload, with the page’s name', async () => {
    expect(
      await read({
        'https://shop.test/p/knit': knitPage,
        'https://shop.test/i/knit.webp': () =>
          new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } }),
      }),
    ).toEqual({ uploadId, name: 'Navy knit' })
    expect(received).toEqual([{ token: 'once', contentType: 'image/webp', bytes: 3 }])
  })

  test('a picture Styld cannot take counts as none, so the person is asked for a photo', async () => {
    expect(
      await read({
        'https://shop.test/p/knit': knitPage,
        'https://shop.test/i/knit.webp': () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
      }),
    ).toBe('noPicture')
  })
})
