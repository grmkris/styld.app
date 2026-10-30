import { DetectionId, PieceId, StyldApi } from '@styld/protocol'
import { Effect, Layer, Option, Result, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import * as Encoding from 'effect/encoding/Base64'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import type { makeAuthHttp } from '../AuthHttp.ts'
import { CurrentAccount } from '../CurrentAccount.ts'
import { type Admit, asSessionAccount, cookieAccount } from '../wardrobe/Http.ts'
import { Captures } from './Service.ts'

/** A frame the camera sent, if it is a JPEG: the camera sends nothing else. */
const jpegOf = (text: string) =>
  Option.filter(
    Result.getSuccess(Encoding.decode(text)),
    (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  )

/** The answer for a frame Styld does not check: not a JPEG, or past the account's pace. */
const notChecked = { held: false, side: 'unclear', samePrevious: false, holding: false } as const

/** The website's capture endpoints, each the matching `Captures` operation for the session's account. */
export const captureHandlers = (
  admit: Admit,
  allowCheck: (accountId: string) => Effect.Effect<boolean, never, RuntimeContext>,
) =>
  HttpApiBuilder.group(StyldApi, 'capture', (handlers) =>
    Effect.gen(function* () {
      const captures = yield* Captures
      return handlers
        .handle('createCapture', ({ payload }) => admit(asSessionAccount(captures.createCapture(payload))))
        .handle('createVideoCapture', ({ payload }) => admit(asSessionAccount(captures.createVideoCapture(payload))))
        .handle('tray', () => asSessionAccount(captures.tray()))
        .handle('review', ({ payload }) => admit(asSessionAccount(captures.review(payload))))
        .handle('retry', ({ params }) => admit(asSessionAccount(captures.retry(params.captureId))))
        .handle('remove', ({ params }) => admit(asSessionAccount(captures.remove(params.captureId))))
        .handle('redrawPicture', ({ params, payload }) =>
          admit(asSessionAccount(captures.redrawPicture(params.pieceId, payload))),
        )
        .handle('undrawnPictures', () => asSessionAccount(captures.undrawnPictures()))
        .handle('makeTurn', ({ params, payload }) =>
          admit(asSessionAccount(captures.makeTurn(params.pieceId, payload.operationId))),
        )
        .handle('drawPictures', () => admit(asSessionAccount(captures.drawPictures())))
        .handle('check', ({ payload }) =>
          admit(
            asSessionAccount(
              Effect.gen(function* () {
                const { accountId } = yield* CurrentAccount
                const frame = jpegOf(payload.frame)
                // Each check calls Clef, so a frame past the account's pace is answered without one.
                if (Option.isNone(frame) || !(yield* allowCheck(accountId))) return notChecked
                const previous = Option.flatMap(Option.fromNullishOr(payload.previous), jpegOf)
                return yield* captures.check(frame.value, previous, payload.layout ?? 'held')
              }),
            ),
          ),
        )
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
  account: Effect.Effect<Option.Option<string>, never, Account>,
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
  })

/** `GET /cdn/detections/:detectionId/:which`: a waiting piece's picture, cut-outs with their transparency; and
 * `GET /cdn/turns/:pieceId/:which`: a turn's video, front frame or frame sheet. Both for their owner only. */
export const captureRoutes = (auth: ReturnType<typeof makeAuthHttp>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const captures = yield* Captures
      const account = yield* cookieAccount(auth)
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
