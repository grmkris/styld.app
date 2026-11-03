import { SheetRefused, StyldApi } from '@styld/protocol'
import { Effect, Option, Result } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as Encoding from 'effect/encoding/Base64'
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
