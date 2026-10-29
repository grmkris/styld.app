import { SessionHttp } from '@styld/auth/config'
import {
  maximumImageBytes,
  maximumVideoBytes,
  PieceId,
  RequestRefused,
  StyldApi,
  UploadId,
  UploadRefused,
} from '@styld/protocol'
import type { AuthRequest } from '@yielded/auth/Auth'
import { Effect, Layer, Option, Redacted, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import type { makeAuthHttp } from '../AuthHttp.ts'
import { CurrentAccount } from '../CurrentAccount.ts'
import { Wardrobe } from './Wardrobe.ts'

export const asSessionAccount = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const { claims } = yield* SessionHttp.CurrentSession
    return yield* Effect.provideService(effect, CurrentAccount, { accountId: claims.accountId, via: 'session' })
  })

/** Admits a change only from the website itself (its Origin and CSRF header), before it runs. */
export type Admit = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | RequestRefused, R | AuthRequest>

/** Yielded's mutation admission as the protocol's refusal. */
export const admitWith =
  (auth: ReturnType<typeof makeAuthHttp>): Admit =>
  (effect) =>
    auth.router.protect(effect).pipe(Effect.catchTag('HookDenied', () => Effect.fail(RequestRefused.make({}))))

/** The website's wardrobe endpoints: each one is the matching `Wardrobe` operation for the session's
 * account; changes are admitted first. */
export const wardrobeHandlers = (admit: Admit) =>
  HttpApiBuilder.group(StyldApi, 'wardrobe', (handlers) =>
    Effect.gen(function* () {
      const wardrobe = yield* Wardrobe
      return handlers
        .handle('listPieces', () => asSessionAccount(wardrobe.listPieces()).pipe(Effect.map((pieces) => ({ pieces }))))
        .handle('getPiece', ({ params }) => asSessionAccount(wardrobe.getPiece(params.pieceId)))
        .handle('createUpload', ({ payload }) => admit(asSessionAccount(wardrobe.createUpload(payload))))
        .handle('createVideoUpload', ({ payload }) => admit(asSessionAccount(wardrobe.createUpload(payload))))
        .handle('addPiece', ({ payload }) => admit(asSessionAccount(wardrobe.addPiece(payload))))
        .handle('updatePiece', ({ params, payload }) =>
          admit(asSessionAccount(wardrobe.updatePiece(params.pieceId, payload))),
        )
        .handle('deletePiece', ({ params }) => admit(asSessionAccount(wardrobe.deletePiece(params.pieceId))))
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
        WardrobeUnavailable: () => Effect.succeed(HttpServerResponse.empty({ status: 503 })),
      }),
      Effect.orDie,
    )
  })
})

/** The signed-in account behind the website's session cookie, for routes outside the typed API. */
export const cookieAccount = (auth: ReturnType<typeof makeAuthHttp>) =>
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
          // Revalidated every time: a processed photo replaces the image behind the same address.
          const headers = { etag, 'cache-control': 'private, no-cache', vary: 'Cookie' }
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
