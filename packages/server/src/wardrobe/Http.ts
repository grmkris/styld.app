import { SessionHttp } from '@styld/auth/config'
import {
  maximumImageBytes,
  maximumVideoBytes,
  PieceId,
  RequestRefused,
  StyldApi,
  UploadId,
  UploadRefused,
  type WardrobeUnavailable,
} from '@styld/protocol'
import type { AuthRequest } from '@yielded/auth/Auth'
import { Effect, Layer, Option, Redacted, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import type { makeAuthHttp } from '../AuthHttp.ts'
import { CurrentAccount } from '../CurrentAccount.ts'
import type { DeliveredImage } from './Delivery.ts'
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
        .handle('setBack', ({ params, payload }) => admit(asSessionAccount(wardrobe.setBack(params.pieceId, payload))))
        .handle('removeBack', ({ params }) => admit(asSessionAccount(wardrobe.removeBack(params.pieceId))))
        .handle('choosePicture', ({ params, payload }) =>
          admit(asSessionAccount(wardrobe.choosePicture(params.pieceId, payload.use))),
        )
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
/** The sizes an image route serves (`imageSizes`). */
export const ShownSize = Schema.Literals(['thumb', 'full'])
const ImageTarget = Schema.Struct({ pieceId: PieceId, size: ShownSize })
/** One picture of a piece in particular: its photo, its clean drawing (ready or proposed), or its back. */
const PictureTarget = Schema.Struct({
  pieceId: PieceId,
  which: Schema.Literals(['photo', 'clean', 'back']),
  size: ShownSize,
})

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

/** An image a route shows, and the version its ETag names. */
export type ShownImage = DeliveredImage & { readonly version: string }

/** A `GET` route that shows an image to its owner only, through the website's session cookie: 401 signed
 * out, and 404 for another account's image, like a missing one. */
export const ownerImage = <A, I extends Readonly<Record<string, string | undefined>>>(
  auth: ReturnType<typeof makeAuthHttp>,
  target: Schema.ConstraintCodec<A, I, never, unknown>,
  find: (target: A) => Effect.Effect<Option.Option<ShownImage>, WardrobeUnavailable, CurrentAccount>,
) =>
  Effect.gen(function* () {
    const account = yield* cookieAccount(auth)
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
        Effect.catchTag('WardrobeUnavailable', () => Effect.succeed(HttpServerResponse.empty({ status: 503 }))),
      )
    })
  })

/** `GET /cdn/pieces/:pieceId/:size`: the picture a piece shows, and `GET /cdn/pieces/:pieceId/:which/:size`: its
 * photo, its clean drawing or its back, for its owner only. */
const pieceImage = (auth: ReturnType<typeof makeAuthHttp>) =>
  Effect.gen(function* () {
    const wardrobe = yield* Wardrobe
    const found = (image: ReturnType<typeof wardrobe.pieceImage>) =>
      image.pipe(
        Effect.map(Option.some),
        Effect.catchTag('PieceNotFound', () => Effect.succeed(Option.none<ShownImage>())),
      )
    return {
      shown: yield* ownerImage(auth, ImageTarget, ({ pieceId, size }) => found(wardrobe.pieceImage(pieceId, size))),
      either: yield* ownerImage(auth, PictureTarget, ({ pieceId, which, size }) =>
        found(wardrobe.pieceImage(pieceId, size, which)),
      ),
    }
  })

/** The wardrobe's routes outside the typed API: photo uploads and images. */
export const wardrobeRoutes = (auth: ReturnType<typeof makeAuthHttp>) =>
  Layer.mergeAll(
    Layer.unwrap(Effect.map(receiveUpload, (handler) => HttpRouter.add('PUT', '/api/uploads/:uploadId', handler))),
    Layer.unwrap(
      Effect.map(pieceImage(auth), ({ shown, either }) =>
        Layer.mergeAll(
          HttpRouter.add('GET', '/cdn/pieces/:pieceId/:size', shown),
          HttpRouter.add('GET', '/cdn/pieces/:pieceId/:which/:size', either),
        ),
      ),
    ),
  )
