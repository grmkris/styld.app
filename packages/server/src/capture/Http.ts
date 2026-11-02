import { CurrentAccount, DetectionId, PieceId, SheetRefused, StyldApi, type Unavailable } from '@styld/protocol'
import { Effect, Layer, Option, Result, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as Encoding from 'effect/encoding/Base64'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { type AuthHttp, sessionCookieAccount } from '../AuthHttp.ts'
import { Captures } from './Service.ts'

/** A frame the camera sent, if it is a JPEG: the camera sends nothing else. */
const jpegOf = (text: string) =>
  Option.filter(
    Result.getSuccess(Encoding.decode(text)),
    (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  )

/** The answer for a frame that is not a JPEG, which Styld does not check. */
const notJpeg = { held: false, side: 'unclear', samePrevious: false, holding: false } as const

/** The website's capture endpoints, each the matching `Captures` operation for the session's account. */
export const captureHandlers = HttpApiBuilder.group(StyldApi, 'capture', (handlers) =>
  Effect.gen(function* () {
    const captures = yield* Captures
    return handlers
      .handle('createCapture', ({ payload }) => captures.createCapture(payload))
      .handle('createVideoCapture', ({ payload }) => captures.createVideoCapture(payload))
      .handle('tray', () => captures.tray())
      .handle('review', ({ payload }) => captures.review(payload))
      .handle('split', ({ params, payload }) => captures.split(params.detectionId, payload.operationId))
      .handle('retry', ({ params, payload }) => captures.retry(params.captureId, payload.operationId))
      .handle('remove', ({ params, payload }) => captures.remove(params.captureId, payload.operationId))
      .handle('redrawPicture', ({ params, payload }) => captures.redrawPicture(params.pieceId, payload))
      .handle('makeTurn', ({ params, payload }) => captures.makeTurn(params.pieceId, payload.operationId))
      .handle('turnSheet', ({ params, payload }) =>
        Effect.gen(function* () {
          const sheet = yield* Effect.fromResult(Encoding.decode(payload.sheet)).pipe(
            Effect.mapError(() => SheetRefused.make({})),
          )
          return yield* captures.acceptSheet(params.pieceId, payload.operationId, payload.layout, sheet)
        }),
      )
      .handle('check', ({ payload }) => {
        const frame = jpegOf(payload.frame)
        if (Option.isNone(frame)) return Effect.succeed(notJpeg)
        const previous = Option.flatMap(Option.fromNullishOr(payload.previous), jpegOf)
        return captures.check(frame.value, previous, payload.layout ?? 'held')
      })
  }),
)

const PictureTarget = Schema.Struct({
  detectionId: DetectionId,
  which: Schema.Literals(['cutout', 'original', 'back']),
})
const TurnTarget = Schema.Struct({ pieceId: PieceId, which: Schema.Literals(['video', 'front', 'sheet']) })

/** One stored file for its owner only, through the website's session cookie: 401 signed out, 404 for another
 * account's file, like a missing one. Each file's address names it for good, so it is cached privately. */
const ownerFile = <A, E, R, Account>(
  account: Effect.Effect<Option.Option<string>, Unavailable, Account>,
  params: Effect.Effect<A, E, R>,
  read: (
    target: A,
  ) => Effect.Effect<
    Option.Option<{ readonly bytes: Uint8Array; readonly contentType: string }>,
    unknown,
    CurrentAccount
  >,
) =>
  Effect.gen(function* () {
    const accountId = yield* account
    if (Option.isNone(accountId)) return HttpServerResponse.empty({ status: 401 })
    const target = yield* params.pipe(Effect.option)
    if (Option.isNone(target)) return HttpServerResponse.empty({ status: 404 })
    const file = yield* read(target.value).pipe(
      Effect.provideService(CurrentAccount, { accountId: accountId.value, via: 'session' }),
      Effect.orElseSucceed(() => Option.none()),
    )
    return Option.match(file, {
      onNone: () => HttpServerResponse.empty({ status: 404 }),
      onSome: ({ bytes, contentType }) =>
        HttpServerResponse.uint8Array(bytes, {
          contentType,
          headers: { 'cache-control': 'private, max-age=3600', vary: 'Cookie' },
        }),
    })
  }).pipe(Effect.catchTag('Unavailable', () => Effect.succeed(HttpServerResponse.empty({ status: 503 }))))

/** `GET /cdn/detections/:detectionId/:which`: a waiting piece's picture, cut-outs with their transparency; and
 * `GET /cdn/turns/:pieceId/:which`: a turn's video, front frame or frame sheet. Both for their owner only. */
export const captureRoutes = (auth: AuthHttp) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const captures = yield* Captures
      const account = yield* sessionCookieAccount(auth)
      return Layer.mergeAll(
        HttpRouter.add(
          'GET',
          '/cdn/detections/:detectionId/:which',
          ownerFile(account, HttpRouter.schemaPathParams(PictureTarget), ({ detectionId, which }) =>
            captures.detectionPicture(detectionId, which),
          ),
        ),
        HttpRouter.add(
          'GET',
          '/cdn/turns/:pieceId/:which',
          ownerFile(account, HttpRouter.schemaPathParams(TurnTarget), ({ pieceId, which }) =>
            captures.turnFile(pieceId, which),
          ),
        ),
      )
    }),
  )
