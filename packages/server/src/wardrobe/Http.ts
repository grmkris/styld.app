import {
  maximumImageBytes,
  maximumVideoBytes,
  CurrentAccount,
  StyldApi,
  UploadId,
  UploadRefused,
  type Unavailable,
} from '@styld/protocol'
import { Effect, Layer, Option, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { type AuthHttp, sessionCookieAccount } from '../AuthHttp.ts'
import type { DeliveredImage } from './Delivery.ts'
import { signedImage } from './SignedImage.ts'
import { Wardrobe } from './Wardrobe.ts'

/** The website's wardrobe endpoints: each one is the matching `Wardrobe` operation for the session's
 * account (`SessionAccount` admits changes). */
export const wardrobeHandlers = HttpApiBuilder.group(StyldApi, 'wardrobe', (handlers) =>
  Effect.gen(function* () {
    const wardrobe = yield* Wardrobe
    return handlers
      .handle('listPieces', () => wardrobe.listPieces().pipe(Effect.map((pieces) => ({ pieces }))))
      .handle('getPiece', ({ params }) => wardrobe.getPiece(params.pieceId))
      .handle('createUpload', ({ payload }) => wardrobe.createUpload(payload))
      .handle('createVideoUpload', ({ payload }) => wardrobe.createUpload(payload))
      .handle('addPiece', ({ payload }) => wardrobe.addPiece(payload))
      .handle('updatePiece', ({ params, payload }) => wardrobe.updatePiece(params.pieceId, payload))
      .handle('deletePiece', ({ params, payload }) => wardrobe.deletePiece(params.pieceId, payload.operationId))
      .handle('setBack', ({ params, payload }) => wardrobe.setBack(params.pieceId, payload))
      .handle('removeBack', ({ params, payload }) => wardrobe.removeBack(params.pieceId, payload.operationId))
      .handle('choosePicture', ({ params, payload }) => wardrobe.choosePicture(params.pieceId, payload))
  }),
)

const refusalStatus: { readonly [Reason in UploadRefused['reason']]: number } = {
  notFound: 404,
  expired: 410,
  notReceived: 409,
  alreadyUsed: 409,
  tooLarge: 413,
  notAnImage: 415,
  tooLong: 413,
  wrongType: 415,
}

const UploadTarget = Schema.Struct({ uploadId: UploadId, token: Schema.String })

/** `PUT /api/uploads/:uploadId?token=`: a photo's bytes. The token in the query string, which Workers
 * logs redact, is the only credential, so an assistant can upload without the website's cookie. */
const receiveUpload = Effect.gen(function* () {
  const wardrobe = yield* Wardrobe
  return Effect.gen(function* () {
    const target = yield* HttpRouter.schemaParams(UploadTarget).pipe(Effect.option)
    if (Option.isNone(target)) return HttpServerResponse.empty({ status: 404 })
    const request = yield* HttpServerRequest.HttpServerRequest
    // Refuse an oversized photo before reading it; the body is at most 15 MB and read whole.
    const declared = Number(request.headers['content-length'] ?? Number.NaN)
    if (!Number.isSafeInteger(declared)) return HttpServerResponse.empty({ status: 411 })
    const contentType = request.headers['content-type'] ?? ''
    // A video streams into the bucket; a photo is at most 15 MB and read whole.
    const video = contentType.startsWith('video/')
    if (declared > (video ? maximumVideoBytes : maximumImageBytes))
      return yield* HttpServerResponse.json({ _tag: 'UploadRefused', reason: 'tooLarge' }, { status: 413 })
    const upload = { uploadId: target.value.uploadId, token: target.value.token, contentType }
    const received = video
      ? Effect.flatMap(HttpServerRequest.toWeb(request).pipe(Effect.orDie), (web) =>
          web.body === null
            ? Effect.fail(UploadRefused.make({ reason: 'tooLarge' }))
            : wardrobe.receiveVideoUpload({ ...upload, bytes: declared, body: web.body }),
        )
      : Effect.flatMap(request.arrayBuffer.pipe(Effect.orDie), (body) =>
          wardrobe.receiveUpload({ ...upload, body: new Uint8Array(body) }),
        )
    return yield* received.pipe(
      Effect.as(HttpServerResponse.empty({ status: 204 })),
      Effect.catchTags({
        UploadRefused: ({ reason }) =>
          HttpServerResponse.json({ _tag: 'UploadRefused', reason }, { status: refusalStatus[reason] }),
        Unavailable: () => Effect.succeed(HttpServerResponse.empty({ status: 503 })),
      }),
      Effect.orDie,
    )
  })
})

/** An image a route shows, and the version its ETag names. */
export type ShownImage = DeliveredImage & { readonly version: string }

/** A `GET` route that shows an image to its owner only, through the website's session cookie: 401 signed
 * out, and 404 for another account's image, like a missing one. */
export const ownerImage = <A, I extends Readonly<Record<string, string | undefined>>>(
  auth: AuthHttp,
  target: Schema.ConstraintCodec<A, I, never, unknown>,
  find: (target: A) => Effect.Effect<Option.Option<ShownImage>, Unavailable, CurrentAccount>,
) =>
  Effect.gen(function* () {
    const account = yield* sessionCookieAccount(auth)
    return Effect.gen(function* () {
      const accountId = yield* account
      if (Option.isNone(accountId)) return HttpServerResponse.empty({ status: 401 })
      const params = yield* HttpRouter.schemaPathParams(target).pipe(Effect.option)
      if (Option.isNone(params)) return HttpServerResponse.empty({ status: 404 })
      const request = yield* HttpServerRequest.HttpServerRequest
      return yield* find(params.value).pipe(
        Effect.provideService(CurrentAccount, { accountId: accountId.value, via: 'session' }),
        Effect.map(
          Option.match({
            onNone: () => HttpServerResponse.empty({ status: 404 }),
            onSome: ({ body, contentType, version }) => {
              const etag = `"${version}"`
              // Revalidated every time: a processed photo replaces the image behind the same address.
              const headers = { etag, 'cache-control': 'private, no-cache', vary: 'Cookie' }
              return request.headers['if-none-match'] === etag
                ? HttpServerResponse.empty({ status: 304, headers })
                : HttpServerResponse.raw(body, { status: 200, contentType, headers })
            },
          }),
        ),
      )
    }).pipe(Effect.catchTag('Unavailable', () => Effect.succeed(HttpServerResponse.empty({ status: 503 }))))
  })

/** The wardrobe's routes outside the typed API: photo uploads and owner-only pictures by signed address. */
export const wardrobeRoutes = Layer.mergeAll(
  Layer.unwrap(Effect.map(receiveUpload, (handler) => HttpRouter.add('PUT', '/api/uploads/:uploadId', handler))),
  Layer.unwrap(Effect.map(signedImage, (handler) => HttpRouter.add('GET', '/cdn/media/:entityId/:size', handler))),
)
