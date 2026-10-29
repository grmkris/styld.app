import { SessionHttp } from '@styld/auth/config'
import { maximumImageBytes, PieceId, StyldApi, UploadId, type UploadRefused } from '@styld/protocol'
import { Effect, Layer, Option, Redacted, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import type { makeAuthHttp } from '../AuthHttp.ts'
import { CurrentAccount } from '../CurrentAccount.ts'
import { Wardrobe } from './Wardrobe.ts'

const asSessionAccount = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const { claims } = yield* SessionHttp.CurrentSession
    return yield* Effect.provideService(effect, CurrentAccount, { accountId: claims.accountId, via: 'session' })
  })

/** The website's wardrobe endpoints: each one is the matching `Wardrobe` operation for the session's
 * account. */
export const WardrobeHandlers = HttpApiBuilder.group(StyldApi, 'wardrobe', (handlers) =>
  Effect.gen(function* () {
    const wardrobe = yield* Wardrobe
    return handlers
      .handle('listPieces', () => asSessionAccount(wardrobe.listPieces()).pipe(Effect.map((pieces) => ({ pieces }))))
      .handle('getPiece', ({ params }) => asSessionAccount(wardrobe.getPiece(params.pieceId)))
      .handle('createUpload', ({ payload }) => asSessionAccount(wardrobe.createUpload(payload)))
      .handle('addPiece', ({ payload }) => asSessionAccount(wardrobe.addPiece(payload)))
      .handle('updatePiece', ({ params, payload }) => asSessionAccount(wardrobe.updatePiece(params.pieceId, payload)))
      .handle('deletePiece', ({ params }) => asSessionAccount(wardrobe.deletePiece(params.pieceId)))
  }),
)

const refusalStatus: { readonly [Reason in UploadRefused['reason']]: number } = {
  notFound: 404,
  expired: 410,
  notReceived: 409,
  alreadyUsed: 409,
  tooLarge: 413,
  notAnImage: 415,
  wrongType: 415,
}

const UploadTarget = Schema.Struct({ uploadId: UploadId, token: Schema.String })
const ImageTarget = Schema.Struct({ pieceId: PieceId, size: Schema.Literals(['thumb', 'full']) })

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
    if (declared > maximumImageBytes)
      return yield* HttpServerResponse.json({ _tag: 'UploadRefused', reason: 'tooLarge' }, { status: 413 })
    const body = yield* request.arrayBuffer.pipe(Effect.orDie)
    return yield* wardrobe
      .receiveUpload({
        uploadId: target.value.uploadId,
        token: target.value.token,
        contentType: request.headers['content-type'] ?? '',
        body: new Uint8Array(body),
      })
      .pipe(
        Effect.as(HttpServerResponse.empty({ status: 204 })),
        Effect.catchTags({
          UploadRefused: ({ reason }) =>
            HttpServerResponse.json({ _tag: 'UploadRefused', reason }, { status: refusalStatus[reason] }),
          WardrobeUnavailable: () => Effect.succeed(HttpServerResponse.empty({ status: 503 })),
        }),
        Effect.orDie,
      )
  })
})

/** The signed-in account behind the website's session cookie, for routes outside the typed API. */
const cookieAccount = (auth: ReturnType<typeof makeAuthHttp>) =>
  Effect.gen(function* () {
    const api = yield* auth.runtime.auth
    return Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const cookie = request.cookies[SessionHttp.cookieName]
      if (cookie === undefined) return Option.none<string>()
      return yield* api.verifySession(Redacted.make(cookie)).pipe(
        Effect.map(({ subjectId }) => Option.some<string>(subjectId)),
        Effect.orElseSucceed(() => Option.none<string>()),
      )
    })
  }).pipe(Effect.provide(auth.dependencies))

/** `GET /cdn/pieces/:pieceId/:size`: a piece's image for its owner only. Another account's piece
 * answers 404, like a missing one. */
const pieceImage = (auth: ReturnType<typeof makeAuthHttp>) =>
  Effect.gen(function* () {
    const wardrobe = yield* Wardrobe
    const account = yield* cookieAccount(auth)
    return Effect.gen(function* () {
      const accountId = yield* account
      if (Option.isNone(accountId)) return HttpServerResponse.empty({ status: 401 })
      const target = yield* HttpRouter.schemaPathParams(ImageTarget).pipe(Effect.option)
      if (Option.isNone(target)) return HttpServerResponse.empty({ status: 404 })
      const request = yield* HttpServerRequest.HttpServerRequest
      return yield* wardrobe.pieceImage(target.value.pieceId, target.value.size).pipe(
        Effect.provideService(CurrentAccount, { accountId: accountId.value, via: 'session' }),
        Effect.map(({ body, contentType, version }) => {
          const etag = `"${version}"`
          const headers = { etag, 'cache-control': 'private, max-age=86400', vary: 'Cookie' }
          return request.headers['if-none-match'] === etag
            ? HttpServerResponse.empty({ status: 304, headers })
            : HttpServerResponse.raw(body, { status: 200, contentType, headers })
        }),
        Effect.catchTags({
          PieceNotFound: () => Effect.succeed(HttpServerResponse.empty({ status: 404 })),
          WardrobeUnavailable: () => Effect.succeed(HttpServerResponse.empty({ status: 503 })),
        }),
      )
    })
  })

/** The wardrobe's routes outside the typed API: photo uploads and images. */
export const wardrobeRoutes = (auth: ReturnType<typeof makeAuthHttp>) =>
  Layer.mergeAll(
    Layer.unwrap(Effect.map(receiveUpload, (handler) => HttpRouter.add('PUT', '/api/uploads/:uploadId', handler))),
    Layer.unwrap(
      Effect.map(pieceImage(auth), (handler) => HttpRouter.add('GET', '/cdn/pieces/:pieceId/:size', handler)),
    ),
  )
