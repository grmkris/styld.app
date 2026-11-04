import { maximumImageBytes, maximumVideoBytes, StyldApi, UploadId, UploadRefused } from '@styld/protocol'
import { Effect, Layer, Option, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import type { DeliveredImage } from './Delivery.ts'
import { signedImage } from './SignedImage.ts'
import { Categories } from './Categories.ts'
import { Wardrobe } from './Wardrobe.ts'

/** The website's wardrobe endpoints: each one is the matching `Wardrobe` operation for the session's
 * account (`SessionAccount` admits changes). */
export const wardrobeHandlers = HttpApiBuilder.group(StyldApi, 'wardrobe', (handlers) =>
  Effect.gen(function* () {
    const wardrobe = yield* Wardrobe
    const categories = yield* Categories
    return handlers
      .handle('listPieces', () => wardrobe.listPieces().pipe(Effect.map((pieces) => ({ pieces }))))
      .handle('getPiece', ({ params }) => wardrobe.getPiece(params.pieceId))
      .handle('createUpload', ({ payload }) => wardrobe.createUpload(payload))
      .handle('createVideoUpload', ({ payload }) => wardrobe.createUpload(payload))
      .handle('addPiece', ({ payload }) => wardrobe.addPiece(payload))
      .handle('renameCategory', ({ payload }) => categories.rename(payload))
      .handle('deleteCategory', ({ payload }) => categories.delete(payload))
      .handle('updatePiece', ({ params, payload }) => wardrobe.updatePiece(params.pieceId, payload))
      .handle('deletePiece', ({ params, payload }) => wardrobe.deletePiece(params.pieceId, payload.operationId))
      .handle('deletePieces', ({ payload }) => wardrobe.deletePieces(payload))
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

/** An image a public route shows, and the version its ETag names. */
export type ShownImage = DeliveredImage & { readonly version: string }

/** The wardrobe's routes outside the typed API: photo uploads and owner-only pictures by signed address. */
export const wardrobeRoutes = Layer.mergeAll(
  Layer.unwrap(Effect.map(receiveUpload, (handler) => HttpRouter.add('PUT', '/api/uploads/:uploadId', handler))),
  Layer.unwrap(Effect.map(signedImage, (handler) => HttpRouter.add('GET', '/cdn/media/:entityId/:size', handler))),
)
