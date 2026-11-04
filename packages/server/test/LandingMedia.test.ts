import { Layer } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServer from 'effect/http/HttpServer'
import { afterAll, describe, expect, test } from 'vitest'
import { type LandingBucket, serveLandingFile } from '../src/LandingMedia.ts'

/** A bucket holding one film of ten bytes, recording each range it was asked for. */
const film = new TextEncoder().encode('0123456789')
const reads: Array<{ readonly key: string; readonly range: unknown }> = []
const bucket: LandingBucket = {
  head: (key) => Promise.resolve(key === 'landing/coat-loop-tall.mp4' ? { size: film.length, httpEtag: '"v1"' } : null),
  get: (key, options) => {
    reads.push({ key, range: options?.range })
    if (key !== 'landing/coat-loop-tall.mp4') return Promise.resolve(null)
    const { offset, length } = options?.range ?? { offset: 0, length: film.length }
    return Promise.resolve({ body: new Blob([film.slice(offset, offset + length)]).stream() })
  },
}

const app = HttpRouter.toWebHandler(
  HttpRouter.add('GET', '/cdn/landing/:name', serveLandingFile(bucket)).pipe(Layer.provide(HttpServer.layerServices)),
  { disableLogger: true },
)
afterAll(() => app.dispose())

const get = (name: string, headers: Readonly<Record<string, string>> = {}) =>
  app.handler(new Request(`https://styld.test/cdn/landing/${name}`, { headers }))

describe('the landing files', () => {
  test('a film goes out whole, typed and cached for a year', async () => {
    const response = await get('coat-loop-tall.mp4')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(await response.text()).toBe('0123456789')
  })

  test('a byte range answers 206 with only those bytes, as Safari asks for a video', async () => {
    const response = await get('coat-loop-tall.mp4', { range: 'bytes=2-5' })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(response.headers.get('content-length')).toBe('4')
    expect(await response.text()).toBe('2345')
  })

  test('an open range and a suffix range read to the end', async () => {
    const open = await get('coat-loop-tall.mp4', { range: 'bytes=7-' })
    expect(open.headers.get('content-range')).toBe('bytes 7-9/10')
    expect(await open.text()).toBe('789')
    const suffix = await get('coat-loop-tall.mp4', { range: 'bytes=-3' })
    expect(suffix.status).toBe(206)
    expect(await suffix.text()).toBe('789')
  })

  test('a range past the end is refused with the size', async () => {
    const response = await get('coat-loop-tall.mp4', { range: 'bytes=10-' })
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */10')
  })

  test('a name outside the allowlist is not found, and never read', async () => {
    reads.length = 0
    expect((await get('secret.mp4')).status).toBe(404)
    expect((await get('..%2Faccounts%2Fac_1%2Fphoto.jpg')).status).toBe(404)
    expect(reads).toEqual([])
  })

  test('an allowlisted name not uploaded yet is not found', async () => {
    expect((await get('mirror-loop-wide.mp4')).status).toBe(404)
  })

  test('a browser holding the file is told it is unchanged', async () => {
    expect((await get('coat-loop-tall.mp4', { 'if-none-match': '"v1"' })).status).toBe(304)
  })
})
