import * as BrowserCrypto from '@effect/platform-browser/BrowserCrypto'
import { CaptureId } from '@styld/protocol'
import { Effect, Layer, Option, Predicate, Schema } from 'effect'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { describe, expect, test } from 'vitest'
import { SendPhoto } from '../src/page/AddPieces/Commands.ts'
import { Message } from '../src/page/AddPieces/Message.ts'
import { styldClientLayer } from '../src/StyldClient.ts'
import { PictureEncoder } from '../src/Upload.ts'

const origin = 'https://styld.test'
const uploadId = `up_${'tee'.padEnd(22, 'x')}`
const captureId = `cp_${'tee'.padEnd(22, 'x')}`

/** What reached the server: each request's method, path and body. */
type Sent = { readonly method: string; readonly path: string; readonly body: HttpBody.HttpBody }

/** The API as far as adding a photo goes: an upload, its bytes, then the capture. */
const server = (sent: Array<Sent>) =>
  HttpClient.make((request) =>
    Effect.sync(() => {
      const path = new URL(request.url).pathname
      sent.push({ method: request.method, path, body: request.body })
      const answer =
        path === '/api/uploads'
          ? Response.json({ uploadId, path: `/api/uploads/${uploadId}`, expiresAt: '2026-11-01T12:00:00.000Z' })
          : path === '/api/captures'
            ? Response.json({ captureId })
            : new Response(null, { status: 204 })
      return HttpClientResponse.fromWeb(request, answer)
    }),
  )

/** A phone photo as picked: JPEG bytes with an EXIF block that names where it was taken. */
const picked = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66])], 'tee.jpg', {
  type: 'image/jpeg',
})

/** The picture as the device draws it afresh: only its pixels. */
const drawn = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: 'image/webp' })

/** A JSON request body, as sent. */
const jsonOf = (body: HttpBody.HttpBody | undefined): unknown =>
  body !== undefined &&
  Predicate.isTagged(body, 'Uint8Array') &&
  body instanceof Object &&
  'body' in body &&
  body.body instanceof Uint8Array
    ? JSON.parse(new TextDecoder().decode(body.body))
    : undefined

const sendPhoto = (sent: Array<Sent>) =>
  SendPhoto({
    index: 0,
    photo: picked,
    source: 'picker',
    side: Option.none(),
    pairsWith: Option.none(),
    importOf: Option.none(),
    operationId: Option.none(),
    uploadId: Option.none(),
  }).effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        styldClientLayer(origin).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, server(sent)))),
        Layer.succeed(PictureEncoder, { encode: () => Effect.succeed(drawn) }),
        // @effect-diagnostics-next-line unstableApiUsage:off -- the browser Web Crypto layer draws operation ids, as entry.ts does
        BrowserCrypto.layerSecureRandom,
      ),
    ),
  )

describe('adding pieces from photos', () => {
  test('a photo goes up drawn afresh as WebP, never as the file picked, so its location stays on the phone', async () => {
    const sent: Array<Sent> = []
    const message = await Effect.runPromise(sendPhoto(sent))
    expect(message).toEqual(Message.SucceededSend({ index: 0, captureId: Schema.decodeSync(CaptureId)(captureId) }))
    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /api/uploads',
      `PUT /api/uploads/${uploadId}`,
      'POST /api/captures',
    ])
    const [upload, bytes] = sent
    expect(jsonOf(upload?.body)).toMatchObject({ contentType: 'image/webp', bytes: drawn.size })
    expect(bytes?.body).toMatchObject({ _tag: 'Raw', body: drawn })
  })
})
