import { DetectionId, StyldApi } from '@styld/protocol'
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

/** `GET /cdn/detections/:detectionId/:which`: a waiting piece's picture, for its owner only. Cut-outs
 * keep their transparency. Another account's detection answers 404, like a missing one. */
export const captureRoutes = (auth: ReturnType<typeof makeAuthHttp>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const captures = yield* Captures
      const account = yield* cookieAccount(auth)
      return HttpRouter.add(
        'GET',
        '/cdn/detections/:detectionId/:which',
        Effect.gen(function* () {
          const accountId = yield* account
          if (Option.isNone(accountId)) return HttpServerResponse.empty({ status: 401 })
          const target = yield* HttpRouter.schemaPathParams(PictureTarget).pipe(Effect.option)
          if (Option.isNone(target)) return HttpServerResponse.empty({ status: 404 })
          const picture = yield* captures.detectionPicture(target.value.detectionId, target.value.which).pipe(
            Effect.provideService(CurrentAccount, { accountId: accountId.value, via: 'session' }),
            Effect.orElseSucceed(() => Option.none()),
          )
          return Option.match(picture, {
            onNone: () => HttpServerResponse.empty({ status: 404 }),
            onSome: ({ bytes, contentType }) =>
              HttpServerResponse.uint8Array(bytes, {
                contentType,
                // A detection's pictures never change; only its owner may read them.
                headers: { 'cache-control': 'private, max-age=3600', vary: 'Cookie' },
              }),
          })
        }),
      )
    }),
  )
