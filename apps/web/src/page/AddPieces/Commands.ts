import { drawOperationId } from '../../OperationIds.ts'
import {
  CaptureId,
  CaptureSource,
  CreateVideoCapture,
  LinkRefused,
  Side,
  UploadId,
  VideoType,
  OperationId,
} from '@styld/protocol'
import { Effect, Option, Predicate, Result, Schema } from 'effect'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import { Command, File } from 'foldkit'
import { FileNotSent, StyldClient } from '../../StyldClient.ts'
import { uploadPictureOnce } from '../../Upload.ts'
import type { SampledStill } from '../../capture/Frames.ts'
import { type LinkProblem, Message, type SendProblem, VideoPart } from './Message.ts'

/** What a failed send means for the person, from the error the API or the sampler answered. */
const problemOf = (error: unknown): SendProblem => {
  if (Predicate.isTagged(error, 'LimitReached')) return 'dailyLimit'
  if (Predicate.isTagged(error, 'VideoNotSampled'))
    return Predicate.hasProperty(error, 'reason') && error.reason === 'tooLong' ? 'videoTooLong' : 'videoUnreadable'
  if (
    Predicate.isTagged(error, 'UploadRefused') ||
    Predicate.isTagged(error, 'OperationConflict') ||
    Predicate.isTagged(error, 'RequestRefused')
  )
    return 'refused'
  if (error instanceof FileNotSent && error.refused) return 'refused'
  if (Predicate.isTagged(error, 'NotAPicture')) return 'refused'
  return 'network'
}

const SendPhotoArgs = Schema.Struct({
  index: Schema.Number,
  photo: File.File,
  source: CaptureSource,
  side: Schema.Option(Side),
  /** The front capture a back shot pairs with. */
  pairsWith: Schema.Option(CaptureId),
  /** The first capture of the photos picked with this one. */
  importOf: Schema.Option(CaptureId),
  operationId: Schema.Option(OperationId),
  uploadId: Schema.Option(Schema.String),
})

/** Upload a photo (re-encoded, so without its metadata) unless it already went up, then make it a capture. A failure
 * worth retrying keeps the operation id and the upload, so the next try asks for the same capture; a refusal starts
 * over. */
export const SendPhoto = Command.define('SendPhoto', {
  args: SendPhotoArgs.fields,
  messages: [Message.SucceededSend, Message.FailedSend],
  execute: (args) =>
    Effect.gen(function* () {
      const operationId = yield* drawOperationId(args.operationId)
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
      const upload = yield* Effect.result(uploadPictureOnce(args.photo, args.uploadId))
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
              ...Option.match(args.importOf, { onNone: () => ({}), onSome: (importOf) => ({ importOf }) }),
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

/** What a product page that went nowhere means for the person: the page's own refusal, or what stops any send. */
const linkProblemOf = (error: unknown): LinkProblem => {
  if (Predicate.isTagged(error, 'LinkRefused') && Predicate.hasProperty(error, 'reason')) {
    const reason = Schema.decodeUnknownOption(LinkRefused.fields.reason)(error.reason)
    if (Option.isSome(reason)) return reason.value
  }
  if (Predicate.isTagged(error, 'SlowDown')) return 'slowDown'
  const problem = problemOf(error)
  return problem === 'dailyLimit' || problem === 'refused' ? problem : 'network'
}

const SendLinkArgs = Schema.Struct({
  index: Schema.Number,
  url: Schema.String,
  operationId: Schema.Option(OperationId),
  uploadId: Schema.Option(Schema.String),
})

/** Have Styld read a product page's picture into an upload, unless an earlier try did, then make it a capture from a
 * link. A failure worth retrying keeps the operation id and the upload, like a photo's. */
export const SendLink = Command.define('SendLink', {
  args: SendLinkArgs.fields,
  messages: [Message.SucceededSendLink, Message.FailedSendLink],
  execute: (args) =>
    Effect.gen(function* () {
      const operationId = yield* drawOperationId(args.operationId)
      const api = yield* (yield* StyldClient).api
      const failed = (uploadId: Option.Option<string>, error: unknown) => {
        const problem = linkProblemOf(error)
        const keep = problem === 'network' || problem === 'slowDown'
        return Message.FailedSendLink({
          index: args.index,
          problem,
          operationId: keep ? Option.some(operationId) : Option.none(),
          uploadId: keep ? uploadId : Option.none(),
        })
      }
      const picture = yield* Effect.result(
        Option.match(args.uploadId, {
          onSome: (id) =>
            Effect.map(Schema.decodeUnknownEffect(UploadId)(id), (uploadId) => ({ uploadId, name: null })),
          onNone: () =>
            Effect.flatMap(drawOperationId(), (readOnce) =>
              api.link.readLink({ payload: { operationId: readOnce, url: args.url } }),
            ),
        }),
      )
      if (Result.isFailure(picture)) return failed(Option.none(), picture.failure)
      const { uploadId, name } = picture.success
      const created = yield* Effect.result(
        api.capture.createCapture({ payload: { operationId, uploadId, source: 'link' } }),
      )
      if (Result.isFailure(created)) return failed(Option.some(uploadId), created.failure)
      return Message.SucceededSendLink({
        index: args.index,
        captureId: created.success.captureId,
        name: Option.fromNullishOr(name),
      })
    }).pipe(
      Effect.orElseSucceed(() =>
        Message.FailedSendLink({
          index: args.index,
          problem: 'network',
          operationId: Option.none(),
          uploadId: Option.none(),
        }),
      ),
    ),
})

/** Upload one sampled still and return its upload, with its time and sharpness. */
const sendStill = (still: SampledStill) =>
  Effect.gen(function* () {
    const { api: loadApi, sendFile } = yield* StyldClient
    const api = yield* loadApi
    const created = yield* api.wardrobe.createUpload({
      payload: { operationId: yield* drawOperationId(), contentType: 'image/jpeg', bytes: still.jpeg.size },
    })
    yield* sendFile(created.path, still.jpeg)
    return { uploadId: created.uploadId, atMs: still.atMs, sharpness: still.sharpness }
  })

/** Upload a clip and its stills: the video capture request, ready to send under a new operation id. A later part
 * names the first part's capture as its import. */
const uploadVideoCapture = (
  video: {
    readonly clip: Blob
    readonly contentType: VideoType
    readonly durationMs: number
    readonly width: number
    readonly height: number
    readonly stills: ReadonlyArray<SampledStill>
  },
  importOf: Option.Option<CaptureId> = Option.none(),
) =>
  Effect.gen(function* () {
    const { api: loadApi, sendFile } = yield* StyldClient
    const api = yield* loadApi
    const operationId = yield* drawOperationId()
    const clip = yield* api.wardrobe.createVideoUpload({
      payload: { operationId: yield* drawOperationId(), contentType: video.contentType, bytes: video.clip.size },
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
      ...Option.match(importOf, { onNone: () => ({}), onSome: (first) => ({ importOf: first }) }),
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
  prepare: Effect.Effect<CreateVideoCapture, E, StyldClient | SecureRandom.SecureRandom>,
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
  args: {
    index: Schema.Number,
    video: File.File,
    part: VideoPart,
    prepared: Schema.Option(CreateVideoCapture),
    /** The first part's capture, for every later part. */
    importOf: Schema.Option(CaptureId),
  },
  messages: [Message.SucceededSendVideoPart, Message.FailedSend],
  execute: ({ index, video, part, prepared, importOf }) =>
    sendVideoCapture(
      index,
      prepared,
      Effect.gen(function* () {
        const { cutPart } = yield* Effect.tryPromise(() => import('../../capture/VideoParts.ts'))
        const cut = yield* cutPart(video, part)
        return yield* uploadVideoCapture({ ...cut, contentType: 'video/mp4' }, importOf)
      }),
      (captureId) => Message.SucceededSendVideoPart({ index, part: part.index, captureId }),
    ),
})
