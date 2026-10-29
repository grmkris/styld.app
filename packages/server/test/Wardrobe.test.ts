import { WardrobeUnavailable } from '@styld/protocol'
import { Effect, Option } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { describe, expect, test } from 'vitest'
import type { AccountLifecycle } from '../src/AccountLifecycle.ts'
import { importImage } from '../src/mcp/ImageImport.ts'
import { sniffImageType } from '../src/wardrobe/Media.ts'
import { processingAttempts, settleMessage } from '../src/wardrobe/Queue.ts'
import { Wardrobe } from '../src/wardrobe/Wardrobe.ts'

const png = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
)

describe('photo signatures', () => {
  test('name the type the bytes really are, whatever the request claimed', () => {
    expect(sniffImageType(png)).toEqual(Option.some('image/png'))
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual(Option.some('image/jpeg'))
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual(Option.none())
  })
})

/** A queue message that records how it was settled. */
const message = (body: unknown, attempts = 1) => {
  const settled: Array<'ack' | 'retry'> = []
  return {
    settled,
    message: {
      id: 'm1',
      timestamp: new Date(0),
      body,
      attempts,
      ack: () => settled.push('ack'),
      retry: () => settled.push('retry'),
    },
  }
}

const notUsed = () => Effect.die('not used by these tests')
const services = (
  processPiece: Effect.Effect<void, WardrobeUnavailable>,
  failPiece: Effect.Effect<void, WardrobeUnavailable> = Effect.void,
) => {
  const failed: Array<string> = []
  return {
    failed,
    services: {
      wardrobe: Wardrobe.of({
        listPieces: notUsed,
        getPiece: notUsed,
        createUpload: notUsed,
        receiveUpload: notUsed,
        pieceAddedBy: notUsed,
        addPiece: notUsed,
        updatePiece: notUsed,
        deletePiece: notUsed,
        pieceImage: notUsed,
        processPiece: () => processPiece,
        failPiece: (pieceId) => Effect.sync(() => failed.push(pieceId)).pipe(Effect.andThen(failPiece)),
      }),
      lifecycle: { deleteAccount: notUsed, finishDeletion: () => Effect.void } satisfies AccountLifecycle['Service'],
    },
  }
}

describe('the processing queue', () => {
  test('settles each message once: done, retried, or failed after the last attempt', async () => {
    const done = message({ pieceId: 'pc_1' })
    await Effect.runPromise(settleMessage(services(Effect.void).services, done.message))
    expect(done.settled).toEqual(['ack'])

    const again = message({ pieceId: 'pc_1' }, 1)
    const flaky = services(Effect.fail(WardrobeUnavailable.make({})))
    await Effect.runPromise(settleMessage(flaky.services, again.message))
    expect(again.settled).toEqual(['retry'])
    expect(flaky.failed).toEqual([])

    const last = message({ pieceId: 'pc_1' }, processingAttempts)
    await Effect.runPromise(settleMessage(flaky.services, last.message))
    expect(last.settled).toEqual(['ack'])
    expect(flaky.failed).toEqual(['pc_1'])
  })

  test('retries when the piece cannot even be marked failed, and drops what it cannot read', async () => {
    const last = message({ pieceId: 'pc_1' }, processingAttempts)
    await Effect.runPromise(
      settleMessage(
        services(Effect.fail(WardrobeUnavailable.make({})), Effect.fail(WardrobeUnavailable.make({}))).services,
        last.message,
      ),
    )
    expect(last.settled).toEqual(['retry'])
    const junk = message({ unexpected: true })
    await Effect.runPromise(settleMessage(services(Effect.void).services, junk.message))
    expect(junk.settled).toEqual(['ack'])
  })
})

/** An HTTP client that answers from a table of URLs. */
const serving = (routes: Record<string, () => Response>) =>
  HttpClient.make((request) =>
    Effect.sync(() =>
      HttpClientResponse.fromWeb(request, (routes[request.url] ?? (() => new Response(null, { status: 404 })))()),
    ),
  )

const run = (address: string, routes: Record<string, () => Response>) =>
  Effect.runPromise(
    importImage(address).pipe(
      Effect.provideService(HttpClient.HttpClient, serving(routes)),
      Effect.map(({ contentType, bytes }) => ({ contentType, size: bytes.byteLength })),
      Effect.catchTag('ImportRefused', ({ reason }) => Effect.succeed(reason)),
    ),
  )

const redirect = (location: string) => () => new Response(null, { status: 302, headers: { location } })
const photo = () => new Response(png, { headers: { 'content-type': 'image/png; charset=binary' } })

describe('photos assistants point at', () => {
  test('follow up to three redirects, each checked again', async () => {
    expect(
      await run('https://a.example/1', { 'https://a.example/1': redirect('/2'), 'https://a.example/2': photo }),
    ).toEqual({
      contentType: 'image/png',
      size: png.byteLength,
    })
    expect(await run('https://a.example/1', { 'https://a.example/1': redirect('http://a.example/2') })).toBe('notHttps')
    const loop = {
      'https://a.example/1': redirect('/2'),
      'https://a.example/2': redirect('/3'),
      'https://a.example/3': redirect('/4'),
      'https://a.example/4': redirect('/5'),
    }
    expect(await run('https://a.example/1', loop)).toBe('tooManyRedirects')
  })

  test('refuse what is not an accepted image, or too large to take', async () => {
    expect(
      await run('https://a.example/p', {
        'https://a.example/p': () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
      }),
    ).toBe('notAnImage')
    expect(
      await run('https://a.example/p', {
        'https://a.example/p': () =>
          new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(16 * 1024 * 1024) } }),
      }),
    ).toBe('tooLarge')
    expect(await run('https://a.example/p', {})).toBe('notReached')
  })
})
