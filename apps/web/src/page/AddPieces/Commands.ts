import {
  CaptureId,
  CaptureSource,
  CreateVideoCapture,
  ImageType,
  OperationId,
  Side,
  UploadId,
  VideoType,
} from '@styld/protocol'
import { Effect, Option, Predicate, Result, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { Command, File } from 'foldkit'
import { FileNotSent, StyldClient } from '../../StyldClient.ts'
import type { SampledStill } from '../../capture/Frames.ts'
import { Message, type SendProblem, VideoPart } from './Message.ts'

/** The operation id an earlier try drew, or a new one. */
const operationIdOf = (known: Option.Option<string>) =>
  Effect.gen(function* () {
    const id = Option.isSome(known) ? known.value : yield* (yield* Crypto.Crypto).randomUUIDv4()
    return yield* Schema.decodeUnknownEffect(OperationId)(id)
  })

/** What a failed send means for the person, from the error the API or the sampler answered. */
const problemOf = (error: unknown): SendProblem => {
  if (Predicate.isTagged(error, 'DailyLimitReached')) return 'dailyLimit'
  if (Predicate.isTagged(error, 'VideoNotSampled'))
    return Predicate.hasProperty(error, 'reason') && error.reason === 'tooLong' ? 'videoTooLong' : 'videoUnreadable'
  if (
    Predicate.isTagged(error, 'UploadRefused') ||
    Predicate.isTagged(error, 'OperationConflict') ||
    Predicate.isTagged(error, 'RequestRefused')
  )
    return 'refused'
  if (error instanceof FileNotSent && error.refused) return 'refused'
  return 'network'
}

const SendPhotoArgs = Schema.Struct({
  index: Schema.Number,
  photo: File.File,
  contentType: ImageType,
  source: CaptureSource,
  side: Schema.Option(Side),
  /** The front capture a back shot pairs with. */
  pairsWith: Schema.Option(CaptureId),
  operationId: Schema.Option(Schema.String),
  uploadId: Schema.Option(Schema.String),
})

/** A photo's upload: the one it already has, or a new one with the bytes sent. */
const uploadOnce = (photo: File.File, contentType: ImageType, known: Option.Option<string>) =>
  Option.match(known, {
    onSome: (id) => Schema.decodeUnknownEffect(UploadId)(id),
    onNone: () =>
      Effect.gen(function* () {
        const { api: loadApi, sendFile } = yield* StyldClient
        const created = yield* (yield* loadApi).wardrobe.createUpload({ payload: { contentType, bytes: photo.size } })
        yield* sendFile(created.path, photo)
        return created.uploadId
      }),
  })

/** Upload a photo unless it already went up, then make it a capture. A failure worth retrying keeps
 * the operation id and the upload, so the next try asks for the same capture; a refusal starts over. */
export const SendPhoto = Command.define('SendPhoto', {
  args: SendPhotoArgs.fields,
  messages: [Message.SucceededSend, Message.FailedSend],
  execute: (args) =>
    Effect.gen(function* () {
      const operationId = yield* operationIdOf(args.operationId)
      const failed = (uploadId: Option.Option<string>, error: unknown) => {
        const problem = problemOf(error)
        const keep = problem === 'network'
        return Message.FailedSend({
          index: args.index,
          problem,
          operationId: keep ? Option.some(operationId) : Option.none(),
          uploadId: keep ? uploadId : Option.none(),
          prepared: Option.none(),
        })
      }
      const upload = yield* Effect.result(uploadOnce(args.photo, args.contentType, args.uploadId))
      if (Result.isFailure(upload)) return failed(Option.none(), upload.failure)
      const created = yield* Effect.result(
        Effect.gen(function* () {
          const api = yield* (yield* StyldClient).api
          return yield* api.capture.createCapture({
            payload: {
              operationId,
              uploadId: upload.success,
              source: args.source,
              ...Option.match(args.side, { onNone: () => ({}), onSome: (side) => ({ side }) }),
              ...Option.match(args.pairsWith, { onNone: () => ({}), onSome: (pairsWith) => ({ pairsWith }) }),
            },
          })
        }),
      )
      if (Result.isFailure(created)) return failed(Option.some(upload.success), created.failure)
      return Message.SucceededSend({ index: args.index, captureId: created.success.captureId })
    }).pipe(
      Effect.orElseSucceed(() =>
        Message.FailedSend({
          index: args.index,
          problem: 'network',
          operationId: Option.none(),
          uploadId: Option.none(),
          prepared: Option.none(),
        }),
      ),
    ),
})

/** Upload one sampled still and return its upload, with its time and sharpness. */
const sendStill = (still: SampledStill) =>
  Effect.gen(function* () {
    const { api: loadApi, sendFile } = yield* StyldClient
    const api = yield* loadApi
    const created = yield* api.wardrobe.createUpload({ payload: { contentType: 'image/jpeg', bytes: still.jpeg.size } })
    yield* sendFile(created.path, still.jpeg)
    return { uploadId: created.uploadId, atMs: still.atMs, sharpness: still.sharpness }
  })

/** Upload a clip and its stills: the video capture request, ready to send under a new operation id. */
const uploadVideoCapture = (video: {
  readonly clip: Blob
  readonly contentType: VideoType
  readonly durationMs: number
  readonly width: number
  readonly height: number
  readonly stills: ReadonlyArray<SampledStill>
}) =>
  Effect.gen(function* () {
    const { api: loadApi, sendFile } = yield* StyldClient
    const api = yield* loadApi
    const operationId = yield* operationIdOf(Option.none())
    const clip = yield* api.wardrobe.createVideoUpload({
      payload: { contentType: video.contentType, bytes: video.clip.size },
    })
    yield* sendFile(clip.path, video.clip)
    const stills = yield* Effect.forEach(video.stills, sendStill, { concurrency: 3 })
    return yield* Schema.decodeUnknownEffect(CreateVideoCapture)({
      operationId,
      videoUploadId: clip.uploadId,
      durationMs: video.durationMs,
      width: video.width,
      height: video.height,
      stills,
    })
  })

/** A video, or a part of one, that did not go. A capture request that got no answer is kept, to be sent
 * again as it was; any other failure starts it over. */
const failedVideo = (index: number, error: unknown, kept: Option.Option<CreateVideoCapture> = Option.none()) => {
  const problem = problemOf(error)
  return Message.FailedSend({
    index,
    problem,
    operationId: Option.none(),
    uploadId: Option.none(),
    prepared: problem === 'network' ? kept : Option.none(),
  })
}

/** Send a video capture request, preparing it unless an earlier try already did. A request that got no
 * answer is kept and sent again as it was; any other failure starts that request over. */
const sendVideoCapture = <Succeeded extends Message, E>(
  index: number,
  prepared: Option.Option<CreateVideoCapture>,
  prepare: Effect.Effect<CreateVideoCapture, E, StyldClient | Crypto.Crypto>,
  succeeded: (captureId: CaptureId) => Succeeded,
) =>
  Effect.gen(function* () {
    const ready = Option.isSome(prepared) ? Result.succeed(prepared.value) : yield* Effect.result(prepare)
    if (Result.isFailure(ready)) return failedVideo(index, ready.failure)
    const created = yield* Effect.result(
      Effect.gen(function* () {
        const api = yield* (yield* StyldClient).api
        return yield* api.capture.createVideoCapture({ payload: ready.success })
      }),
    )
    if (Result.isFailure(created)) return failedVideo(index, created.failure, Option.some(ready.success))
    return succeeded(created.success.captureId)
  })

const SendVideoArgs = Schema.Struct({
  index: Schema.Number,
  video: File.File,
  contentType: VideoType,
  prepared: Schema.Option(CreateVideoCapture),
})

/** Send a short video whole, where this browser cannot cut it: sample its stills by playing it, upload
 * the original and its stills, then make it a capture. Code that fails to load is a network failure. */
export const SendVideo = Command.define('SendVideo', {
  args: SendVideoArgs.fields,
  messages: [Message.SucceededSend, Message.FailedSend],
  execute: (args) =>
    sendVideoCapture(
      args.index,
      args.prepared,
      Effect.gen(function* () {
        const { sampleVideo } = yield* Effect.tryPromise(() => import('../../capture/Sampler.ts'))
        const sampled = yield* sampleVideo(args.video)
        return yield* uploadVideoCapture({ ...sampled, clip: args.video, contentType: args.contentType })
      }),
      (captureId) => Message.SucceededSend({ index: args.index, captureId }),
    ),
})

/** Read how long a video is and whether this browser can cut it into parts. */
export const InspectVideo = Command.define('InspectVideo', {
  args: { index: Schema.Number, video: File.File },
  messages: [Message.SucceededInspectVideo, Message.FailedSend],
  execute: ({ index, video }) =>
    Effect.gen(function* () {
      const { inspectVideo } = yield* Effect.tryPromise(() => import('../../capture/VideoParts.ts'))
      const plan = yield* inspectVideo(video)
      return Message.SucceededInspectVideo({ index, plan })
    }).pipe(Effect.catch((error) => Effect.succeed(failedVideo(index, error)))),
})

/** Cut one part of a video on this device, upload its analysis clip and stills, and make it a capture. */
export const SendVideoPart = Command.define('SendVideoPart', {
  args: { index: Schema.Number, video: File.File, part: VideoPart, prepared: Schema.Option(CreateVideoCapture) },
  messages: [Message.SucceededSendVideoPart, Message.FailedSend],
  execute: ({ index, video, part, prepared }) =>
    sendVideoCapture(
      index,
      prepared,
      Effect.gen(function* () {
        const { cutPart } = yield* Effect.tryPromise(() => import('../../capture/VideoParts.ts'))
        const cut = yield* cutPart(video, part)
        return yield* uploadVideoCapture({ ...cut, contentType: 'video/mp4' })
      }),
      () => Message.SucceededSendVideoPart({ index, part: part.index }),
    ),
})
