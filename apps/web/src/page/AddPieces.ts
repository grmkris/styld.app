import { FileDrop } from '@foldkit/ui'
import {
  CaptureSource,
  CreateVideoCapture,
  ImageType,
  maximumImageBytes,
  maximumVideoBytes,
  OperationId,
  Side,
  UploadId,
  VideoType,
} from '@styld/protocol'
import { Effect, Option, Predicate, Result, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { Command, File, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { FileNotSent, StyldClient } from '../StyldClient.ts'
import * as HeldCamera from './HeldCamera.ts'

// MODEL

/** Why a chosen file is not sent at all. */
export const FileProblem = Schema.Literals(['notSupported', 'tooLarge'])
export type FileProblem = typeof FileProblem.Type

/** Why sending a file stopped: today's free allowance is spent, the video is too long or cannot be
 * played here, the server refused the bytes, or the network failed (worth trying again). */
export const SendProblem = Schema.Literals(['dailyLimit', 'videoTooLong', 'videoUnreadable', 'refused', 'network'])
export type SendProblem = typeof SendProblem.Type

export const Sending = defineTaggedUnion({
  Waiting: {},
  Sending: {},
  Sent: {},
  Failed: { problem: SendProblem },
})
export type Sending = typeof Sending.Type

/** One chosen file on its way to the review tray. Its operation id and, for a photo, its upload are
 * kept once known, so trying again asks the server for the same capture. */
export const Item = Schema.Struct({
  /** Names the file's row; it never changes, unlike the row's place in a list. */
  key: Schema.String,
  file: File.File,
  kind: Schema.Literals(['photo', 'video']),
  source: CaptureSource,
  /** The side of the garment a held-up camera shot shows. */
  side: Schema.Option(Side),
  operationId: Schema.Option(Schema.String),
  uploadId: Schema.Option(Schema.String),
  /** A video sampled and uploaded whose capture request got no answer: trying again sends the same
   * request, so the server makes one capture. */
  prepared: Schema.Option(CreateVideoCapture),
  sending: Sending,
})
export type Item = typeof Item.Type

export const Model = Schema.Struct({
  /** The picker: photos and videos from the library. */
  drop: FileDrop.Model,
  /** The phone's own camera app, one photo at a time. */
  camera: FileDrop.Model,
  /** The camera on this page that takes a photo of each garment held up to it. */
  held: HeldCamera.Model,
  /** Every file chosen on this page, in order; a file keeps its place, so its index names it. */
  items: Schema.Array(Item),
  rejected: Schema.Array(Schema.Struct({ name: Schema.String, problem: FileProblem })),
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  drop: FileDrop.init({ id: 'add-pieces' }),
  camera: FileDrop.init({ id: 'add-pieces-camera' }),
  held: HeldCamera.init(),
  items: [],
  rejected: [],
})

// MESSAGE

export const Message = defineMessageUnion({
  GotDropMessage: { message: FileDrop.Message },
  GotCameraMessage: { message: FileDrop.Message },
  GotHeldCameraMessage: { message: HeldCamera.Message },
  ClickedHoldUp: {},
  SucceededSend: { index: Schema.Number },
  FailedSend: {
    index: Schema.Number,
    problem: SendProblem,
    operationId: Schema.Option(Schema.String),
    uploadId: Schema.Option(Schema.String),
    prepared: Schema.Option(CreateVideoCapture),
  },
  ClickedRetry: { index: Schema.Number },
  ClickedReview: {},
})
export type Message = typeof Message.Type

/** Every chosen file is sent, or the person chose to see what the sent ones found. */
export const OutMessage = defineMessageUnion({ FinishedSending: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** Two files go up at once; the rest wait their turn. */
const concurrentSends = 2

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
 * the operation id and the upload, so the next try asks for the same capture; a refusal starts over.
 * @internal Exported for its tests. */
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
            },
          })
        }),
      )
      if (Result.isFailure(created)) return failed(Option.some(upload.success), created.failure)
      return Message.SucceededSend({ index: args.index })
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
const sendStill = (still: { readonly jpeg: Blob; readonly atMs: number; readonly sharpness: ReadonlyArray<number> }) =>
  Effect.gen(function* () {
    const { api: loadApi, sendFile } = yield* StyldClient
    const api = yield* loadApi
    const created = yield* api.wardrobe.createUpload({ payload: { contentType: 'image/jpeg', bytes: still.jpeg.size } })
    yield* sendFile(created.path, still.jpeg)
    return { uploadId: created.uploadId, atMs: still.atMs, sharpness: still.sharpness }
  })

/** Sample a video's stills in the browser and upload the clip and its stills: the capture request, ready
 * to send. Code that fails to load is a network failure, worth trying again. */
const prepareVideo = (video: File.File, contentType: VideoType) =>
  Effect.gen(function* () {
    const { sampleVideo } = yield* Effect.tryPromise(() => import('../capture/Sampler.ts'))
    const sampled = yield* sampleVideo(video)
    const { api: loadApi, sendFile } = yield* StyldClient
    const api = yield* loadApi
    const operationId = yield* operationIdOf(Option.none())
    const clip = yield* api.wardrobe.createVideoUpload({ payload: { contentType, bytes: video.size } })
    yield* sendFile(clip.path, video)
    const stills = yield* Effect.forEach(sampled.stills, sendStill, { concurrency: 3 })
    return yield* Schema.decodeUnknownEffect(CreateVideoCapture)({
      operationId,
      videoUploadId: clip.uploadId,
      durationMs: sampled.durationMs,
      width: sampled.width,
      height: sampled.height,
      stills,
    })
  })

const SendVideoArgs = Schema.Struct({
  index: Schema.Number,
  video: File.File,
  contentType: VideoType,
  prepared: Schema.Option(CreateVideoCapture),
})

/** Sample and upload a video, then make it a capture. A capture request that got no answer is kept and
 * sent again as it was; any other failure starts over.
 * @internal Exported for its tests. */
export const SendVideo = Command.define('SendVideo', {
  args: SendVideoArgs.fields,
  messages: [Message.SucceededSend, Message.FailedSend],
  execute: (args) =>
    Effect.gen(function* () {
      const failed = (error: unknown, prepared: Option.Option<CreateVideoCapture>) => {
        const problem = problemOf(error)
        return Message.FailedSend({
          index: args.index,
          problem,
          operationId: Option.none(),
          uploadId: Option.none(),
          prepared: problem === 'network' ? prepared : Option.none(),
        })
      }
      const ready = Option.isSome(args.prepared)
        ? Result.succeed(args.prepared.value)
        : yield* Effect.result(prepareVideo(args.video, args.contentType))
      if (Result.isFailure(ready)) return failed(ready.failure, Option.none())
      const created = yield* Effect.result(
        Effect.gen(function* () {
          const api = yield* (yield* StyldClient).api
          return yield* api.capture.createVideoCapture({ payload: ready.success })
        }),
      )
      if (Result.isFailure(created)) return failed(created.failure, Option.some(ready.success))
      return Message.SucceededSend({ index: args.index })
    }),
})

// UPDATE

type Services = StyldClient | Crypto.Crypto
type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, Services>

const imageTypes: ReadonlyArray<string> = ImageType.literals
const videoTypes: ReadonlyArray<string> = VideoType.literals

/** What a chosen file becomes, by its own type and size; the server checks the bytes again.
 * @internal Exported for its tests. */
export const classify = (file: File.File): { kind: 'photo' | 'video' } | { problem: FileProblem } => {
  const type = File.mimeType(file)
  if (imageTypes.includes(type))
    return File.size(file) > maximumImageBytes ? { problem: 'tooLarge' } : { kind: 'photo' }
  if (videoTypes.includes(type))
    return File.size(file) > maximumVideoBytes ? { problem: 'tooLarge' } : { kind: 'video' }
  return { problem: 'notSupported' }
}

const commandFor = (item: Item, index: number) =>
  item.kind === 'video'
    ? SendVideo({
        index,
        video: item.file,
        contentType: Schema.decodeUnknownSync(VideoType)(File.mimeType(item.file)),
        prepared: item.prepared,
      })
    : SendPhoto({
        index,
        photo: item.file,
        contentType: Schema.decodeUnknownSync(ImageType)(File.mimeType(item.file)),
        source: item.source,
        side: item.side,
        operationId: item.operationId,
        uploadId: item.uploadId,
      })

/** Start waiting files while fewer than two are on their way. */
const pump = (model: Model) => {
  const free = concurrentSends - model.items.filter(({ sending }) => Sending.guards.Sending(sending)).length
  const starting = model.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => Sending.guards.Waiting(item.sending))
    .slice(0, Math.max(0, free))
  const items = model.items.map((item, index) =>
    starting.some((start) => start.index === index) ? { ...item, sending: Sending.Sending() } : item,
  )
  return {
    model: modifyFields(model, { items: () => items }),
    commands: starting.map(({ item, index }) => commandFor(item, index)),
  }
}

/** Every file has gone up: the review tray takes over. One that failed, or an open camera, keeps the
 * person here. */
const settled = (model: Model): UpdateReturn => {
  const next = pump(model)
  const done = next.model.items.every(({ sending }) => Sending.guards.Sent(sending))
  return done && next.model.items.length > 0 && !HeldCamera.isOpen(next.model.held)
    ? { ...next, outMessage: OutMessage.FinishedSending() }
    : next
}

const chose = (model: Model, files: ReadonlyArray<File.File>, source: CaptureSource): UpdateReturn => {
  const sorted = files.map((file) => ({ file, sort: classify(file) }))
  const accepted = sorted.flatMap(({ file, sort }, at): ReadonlyArray<Item> =>
    'kind' in sort
      ? [
          {
            key: `${model.items.length + at}:${File.name(file)}`,
            file,
            kind: sort.kind,
            source: sort.kind === 'video' ? 'video' : source,
            side: Option.none(),
            operationId: Option.none(),
            uploadId: Option.none(),
            prepared: Option.none(),
            sending: Sending.Waiting(),
          },
        ]
      : [],
  )
  const rejected = sorted.flatMap(({ file, sort }) =>
    'problem' in sort ? [{ name: File.name(file), problem: sort.problem }] : [],
  )
  return pump(modifyFields(model, { items: (items) => [...items, ...accepted], rejected: () => rejected }))
}

const foldFiles = (source: CaptureSource) =>
  FileDrop.OutMessage.match<Update.StepWithOutMessage<Model, Message, OutMessage, Services>>({
    ReceivedFiles:
      ({ files }) =>
      (model) =>
        chose(model, files, source),
    RejectedNonFiles: () => (model) => ({ model }),
  })

const foldDrop = Update.foldChild({
  update: FileDrop.update,
  read: (model: Model) => Option.some(model.drop),
  write: (model: Model, drop: FileDrop.Model) => modifyFields(model, { drop: () => drop }),
  toParentMessage: (message: FileDrop.Message) => Message.GotDropMessage({ message }),
  foldOutMessage: foldFiles('picker'),
})

const foldCamera = Update.foldChild({
  update: FileDrop.update,
  read: (model: Model) => Option.some(model.camera),
  write: (model: Model, camera: FileDrop.Model) => modifyFields(model, { camera: () => camera }),
  toParentMessage: (message: FileDrop.Message) => Message.GotCameraMessage({ message }),
  foldOutMessage: foldFiles('camera'),
})

/** A photo from the held-up camera joins the queue like any other, with the side it shows. */
const tookPhoto = (model: Model, photo: File.File, side: Option.Option<Side>): UpdateReturn =>
  pump(
    modifyFields(model, {
      items: (items) => [
        ...items,
        {
          key: `${items.length}:${File.name(photo)}`,
          file: photo,
          kind: 'photo' as const,
          source: 'camera' as const,
          side,
          operationId: Option.none(),
          uploadId: Option.none(),
          prepared: Option.none(),
          sending: Sending.Waiting(),
        },
      ],
    }),
  )

/** A photo the camera took joins the queue; closing the camera may hand over to the tray. */
const heldCameraOut = HeldCamera.OutMessage.match<Update.StepWithOutMessage<Model, Message, OutMessage, Services>>({
  TookPhoto:
    ({ photo, side }) =>
    (model) =>
      tookPhoto(model, photo, side),
  ClosedCamera: () => settled,
})

const foldHeldCamera = Update.foldChild({
  update: HeldCamera.update,
  read: (model: Model) => Option.some(model.held),
  write: (model: Model, held: HeldCamera.Model) => modifyFields(model, { held: () => held }),
  toParentMessage: (message: HeldCamera.Message) => Message.GotHeldCameraMessage({ message }),
  foldOutMessage: heldCameraOut,
})

const foldHeldCameraOpen = Update.foldChildStep({
  update: HeldCamera.open,
  read: (model: Model) => Option.some(model.held),
  write: (model: Model, held: HeldCamera.Model) => modifyFields(model, { held: () => held }),
  toParentMessage: (message: HeldCamera.Message) => Message.GotHeldCameraMessage({ message }),
  foldOutMessage: heldCameraOut,
})

const withItem = (model: Model, index: number, change: (item: Item) => Item) =>
  modifyFields(model, { items: (items) => items.map((item, at) => (at === index ? change(item) : item)) })

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    GotDropMessage: ({ message: dropMessage }) => foldDrop(model, dropMessage),
    GotCameraMessage: ({ message: cameraMessage }) => foldCamera(model, cameraMessage),
    GotHeldCameraMessage: ({ message: heldMessage }) => foldHeldCamera(model, heldMessage),
    ClickedHoldUp: () => foldHeldCameraOpen(model),
    SucceededSend: ({ index }) => settled(withItem(model, index, (item) => ({ ...item, sending: Sending.Sent() }))),
    FailedSend: ({ index, problem, operationId, uploadId, prepared }) => {
      const failed = withItem(model, index, (item) => ({
        ...item,
        operationId,
        uploadId,
        prepared,
        sending: Sending.Failed({ problem }),
      }))
      // Today's allowance is spent: the files still waiting would be refused the same way.
      return settled(
        problem === 'dailyLimit'
          ? modifyFields(failed, {
              items: (items) =>
                items.map((item) =>
                  Sending.guards.Waiting(item.sending) ? { ...item, sending: Sending.Failed({ problem }) } : item,
                ),
            })
          : failed,
      )
    },
    ClickedRetry: ({ index }) =>
      pump(
        withItem(model, index, (item) =>
          Sending.guards.Failed(item.sending) ? { ...item, sending: Sending.Waiting() } : item,
        ),
      ),
    // The page offers this only once nothing is waiting or on its way, so no upload is cut short.
    ClickedReview: () =>
      model.items.some(({ sending }) => Sending.guards.Waiting(sending) || Sending.guards.Sending(sending))
        ? { model }
        : { model, outMessage: OutMessage.FinishedSending() },
  })
