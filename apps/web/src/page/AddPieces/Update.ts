import { FileDrop } from '@foldkit/ui'
import { type CaptureId, type CaptureSource, maximumImageBytes, type Side, VideoType } from '@styld/protocol'
import { Option, Schema } from 'effect'
import type * as SecureRandom from 'effect/crypto/SecureRandom'
import { File, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import type { StyldClient } from '../../StyldClient.ts'
import { isPicture, type PictureEncoder } from '../../Upload.ts'
import { InspectVideo, SendLink, SendPhoto, SendVideo, SendVideoPart } from './Commands.ts'
import * as HeldCamera from '../HeldCamera.ts'
import { Message, OutMessage, type VideoPlan } from './Message.ts'
import {
  type FileProblem,
  type Item,
  isReadingVideo,
  type LinkItem,
  LinkSending,
  type Model,
  Sending,
} from './Model.ts'

// UPDATE

type Services = StyldClient | SecureRandom.SecureRandom | PictureEncoder
type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, Services>

/** Two files go up at once, at most one of them a video; the rest wait their turn. */
const concurrentSends = 2

const videoTypes: ReadonlyArray<string> = VideoType.literals

/** What a chosen file becomes, by its own type and size; the server checks the bytes again. A video's
 * size does not matter here: this device reads it and sends small parts.
 */
export const classify = (file: File.File): { kind: 'photo' | 'video' } | { problem: FileProblem } => {
  const type = File.mimeType(file)
  if (isPicture(file)) return File.size(file) > maximumImageBytes ? { problem: 'tooLarge' } : { kind: 'photo' }
  if (videoTypes.includes(type)) return { kind: 'video' }
  return { problem: 'notSupported' }
}

/** A video's next step: read it, send it whole, or send its next part. */
const videoCommand = (item: Item, index: number, plan: Option.Option<VideoPlan>) => {
  if (Option.isNone(plan)) return InspectVideo({ index, video: item.file })
  const part = plan.value.parts[item.partsSent]
  return plan.value.route === 'whole' || part === undefined
    ? SendVideo({
        index,
        video: item.file,
        contentType: Schema.decodeUnknownSync(VideoType)(File.mimeType(item.file)),
        prepared: item.prepared,
      })
    : SendVideoPart({ index, video: item.file, part, prepared: item.prepared, importOf: item.captureId })
}

/** The capture the file at `at` became; none if it went nowhere. */
const captureAt = (model: Model, at: Option.Option<number>) =>
  Option.flatMap(at, (index) => Option.flatMap(Option.fromNullishOr(model.items[index]), (item) => item.captureId))

/** Whether the file at `at` is still on its way. */
const onItsWay = (model: Model, at: Option.Option<number>) =>
  Option.exists(at, (index) => {
    const other = model.items[index]
    return other !== undefined && (Sending.guards.Waiting(other.sending) || Sending.guards.Sending(other.sending))
  })

/** A back shot whose front is still on its way waits for it, so it can pair; a photo picked with others waits for
 * the first of them, to join its import. One whose front or first failed goes on its own. */
const awaitsOther = (model: Model, item: Item) => onItsWay(model, item.front) || onItsWay(model, item.joins)

const commandFor = (model: Model, item: Item, index: number) =>
  item.kind === 'video'
    ? videoCommand(item, index, item.plan)
    : SendPhoto({
        index,
        photo: item.file,
        source: item.source,
        side: item.side,
        pairsWith: captureAt(model, item.front),
        importOf: captureAt(model, item.joins),
        operationId: item.operationId,
        uploadId: item.uploadId,
      })

/** Which waiting files start now: up to two on their way at once, a video only when no other is being
 * read, since a phone cuts one video at a time, and a back shot only after its front. */
const startable = (model: Model) => {
  const free = concurrentSends - model.items.filter(({ sending }) => Sending.guards.Sending(sending)).length
  return model.items.reduce<{
    readonly starting: ReadonlyArray<{ readonly item: Item; readonly index: number }>
    readonly videoBusy: boolean
  }>(
    (state, item, index) =>
      state.starting.length >= free ||
      !Sending.guards.Waiting(item.sending) ||
      (item.kind === 'video' && state.videoBusy) ||
      awaitsOther(model, item)
        ? state
        : { starting: [...state.starting, { item, index }], videoBusy: state.videoBusy || item.kind === 'video' },
    { starting: [], videoBusy: model.items.some(isReadingVideo) },
  ).starting
}

/** Start the files that can go now. */
const pump = (model: Model) => {
  const starting = startable(model)
  const items = model.items.map((item, index) =>
    starting.some((start) => start.index === index) ? { ...item, sending: Sending.Sending() } : item,
  )
  return {
    model: modifyFields(model, { items: () => items }),
    commands: starting.map(({ item, index }) => commandFor(model, item, index)),
  }
}

/** Every file and product page has gone up: the review tray takes over. One that failed, or an open camera, keeps
 * the person here. */
const settled = (model: Model): UpdateReturn => {
  const next = pump(model)
  const done =
    next.model.items.every(({ sending }) => Sending.guards.Sent(sending)) &&
    next.model.links.every(({ sending }) => LinkSending.guards.Sent(sending))
  return done && next.model.items.length + next.model.links.length > 0 && !HeldCamera.isOpen(next.model.held)
    ? { ...next, outMessage: OutMessage.FinishedSending() }
    : next
}

/** Whether anything chosen here is still waiting or on its way. */
const anyPending = (model: Model) =>
  model.items.some(({ sending }) => Sending.guards.Waiting(sending) || Sending.guards.Sending(sending)) ||
  model.links.some(({ sending }) => LinkSending.guards.Sending(sending))

const sendLink = (link: LinkItem, index: number) =>
  SendLink({ index, url: link.url, operationId: link.operationId, uploadId: link.uploadId })

/** A product page joins the list and goes at once: it costs this device nothing to send. */
const addedLink = (model: Model): UpdateReturn => {
  const url = model.link.trim()
  if (url.length === 0) return { model }
  const link: LinkItem = {
    key: `link:${model.links.length}:${url}`,
    url,
    name: Option.none(),
    operationId: Option.none(),
    uploadId: Option.none(),
    sending: LinkSending.Sending(),
  }
  return {
    model: modifyFields(model, { link: () => '', links: (links) => [...links, link] }),
    commands: [sendLink(link, model.links.length)],
  }
}

const withLink = (model: Model, index: number, change: (link: LinkItem) => LinkItem) =>
  modifyFields(model, { links: (links) => links.map((link, at) => (at === index ? change(link) : link)) })

type FailedSendLink = typeof Message.FailedSendLink.Type

const failedLink = (model: Model, { index, problem, operationId, uploadId }: FailedSendLink) =>
  withLink(model, index, (link) => ({ ...link, operationId, uploadId, sending: LinkSending.Failed({ problem }) }))

/** Trying a product page again resumes where it stopped: the same upload and operation, if it got that far. */
const retriedLink = (model: Model, index: number): UpdateReturn => {
  const link = model.links[index]
  if (link === undefined || !LinkSending.guards.Failed(link.sending)) return { model }
  return {
    model: withLink(model, index, (current) => ({ ...current, sending: LinkSending.Sending() })),
    commands: [sendLink(link, index)],
  }
}

const newItem = (
  key: string,
  file: File.File,
  kind: Item['kind'],
  source: CaptureSource,
  side: Option.Option<Side> = Option.none(),
  front: Option.Option<number> = Option.none(),
  joins: Option.Option<number> = Option.none(),
): Item => ({
  key,
  file,
  kind,
  source,
  side,
  front,
  joins,
  captureId: Option.none(),
  operationId: Option.none(),
  uploadId: Option.none(),
  prepared: Option.none(),
  plan: Option.none(),
  partsSent: 0,
  sending: Sending.Waiting(),
})

/** Files chosen together join the list; photos among them are one import, joined to the first of them. */
const chose = (model: Model, files: ReadonlyArray<File.File>): UpdateReturn => {
  const sorted = files.map((file) => ({ file, sort: classify(file) }))
  const kinds = sorted.flatMap(({ file, sort }) => ('kind' in sort ? [{ file, kind: sort.kind }] : []))
  const photos = kinds.filter(({ kind }) => kind === 'photo').length
  const firstPhoto = kinds.findIndex(({ kind }) => kind === 'photo')
  const accepted = kinds.map(({ file, kind }, at) =>
    newItem(
      `${model.items.length + at}:${File.name(file)}`,
      file,
      kind,
      kind === 'video' ? 'video' : 'picker',
      Option.none(),
      Option.none(),
      kind === 'photo' && photos > 1 && at !== firstPhoto
        ? Option.some(model.items.length + firstPhoto)
        : Option.none(),
    ),
  )
  const rejected = sorted.flatMap(({ file, sort }) =>
    'problem' in sort ? [{ name: File.name(file), problem: sort.problem }] : [],
  )
  return pump(modifyFields(model, { items: (items) => [...items, ...accepted], rejected: () => rejected }))
}

const foldDrop = Update.foldChild({
  update: FileDrop.update,
  read: (model: Model) => Option.some(model.drop),
  write: (model: Model, drop: FileDrop.Model) => modifyFields(model, { drop: () => drop }),
  toParentMessage: (message: FileDrop.Message) => Message.GotDropMessage({ message }),
  foldOutMessage: FileDrop.OutMessage.match<Update.StepWithOutMessage<Model, Message, OutMessage, Services>>({
    ReceivedFiles:
      ({ files }) =>
      (model) =>
        chose(model, files),
    RejectedNonFiles: () => (model) => ({ model }),
  }),
})

/** A photo from the held-up camera joins the queue like any other, with the side it shows; a back with
 * the front taken before it. */
const tookPhoto = (model: Model, photo: File.File, side: HeldCamera.Step): UpdateReturn => {
  const front = model.items.findLastIndex((item) => item.source === 'camera' && Option.contains(item.side, 'front'))
  const pairs = side === 'back' && front >= 0 ? Option.some(front) : Option.none()
  return pump(
    modifyFields(model, {
      items: (items) => [
        ...items,
        newItem(`${items.length}:${File.name(photo)}`, photo, 'photo', 'camera', Option.some(side), pairs),
      ],
    }),
  )
}

/** A photo the camera took joins the queue; closing the camera may hand over to the tray. */
const heldCameraOut = HeldCamera.OutMessage.match<Update.StepWithOutMessage<Model, Message, OutMessage, Services>>({
  TookPhoto:
    ({ photo, side }) =>
    (model) =>
      tookPhoto(model, photo, side),
  ClosedCamera: () => settled,
})

/** Where the camera lives in the page's model, and how its messages and out-messages come back. */
const heldCameraSlot = {
  read: (model: Model) => Option.some(model.held),
  write: (model: Model, held: HeldCamera.Model) => modifyFields(model, { held: () => held }),
  toParentMessage: (message: HeldCamera.Message) => Message.GotHeldCameraMessage({ message }),
  foldOutMessage: heldCameraOut,
}

const foldHeldCamera = Update.foldChild({ update: HeldCamera.update, ...heldCameraSlot })

/** Open the camera to hold pieces up, or above pieces laid out. */
const foldHeldCameraOpen = Update.foldChildStep({ update: HeldCamera.open, ...heldCameraSlot })
const foldHeldCameraLayOut = Update.foldChildStep({ update: HeldCamera.layOut, ...heldCameraSlot })

const withItem = (model: Model, index: number, change: (item: Item) => Item) =>
  modifyFields(model, { items: (items) => items.map((item, at) => (at === index ? change(item) : item)) })

/** Carry on with a video that is still being sent: its next part, or the whole of it. */
const continueVideo = (model: Model, index: number): UpdateReturn => {
  const item = model.items[index]
  return item === undefined ? { model } : { model, commands: [commandFor(model, item, index)] }
}

/** A part went: send the next one, in the first part's import, or the video is done. A late answer for another
 * part changes nothing. */
const sentPart = (model: Model, index: number, part: number, captureId: CaptureId): UpdateReturn => {
  const item = model.items[index]
  if (item === undefined || Option.isNone(item.plan) || item.partsSent !== part) return { model }
  const sent = part + 1
  const advanced = withItem(model, index, (current) => ({
    ...current,
    partsSent: sent,
    prepared: Option.none(),
    captureId: Option.orElse(current.captureId, () => Option.some(captureId)),
  }))
  return sent < item.plan.value.parts.length
    ? continueVideo(advanced, index)
    : settled(withItem(advanced, index, (current) => ({ ...current, sending: Sending.Sent() })))
}

type FailedSend = typeof Message.FailedSend.Type

const failedSend = (model: Model, { index, problem, operationId, uploadId, prepared }: FailedSend): UpdateReturn => {
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
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    GotDropMessage: ({ message: dropMessage }) => foldDrop(model, dropMessage),
    GotHeldCameraMessage: ({ message: heldMessage }) => foldHeldCamera(model, heldMessage),
    ClickedHoldUp: () => foldHeldCameraOpen(model),
    ClickedLayOut: () => foldHeldCameraLayOut(model),
    SucceededSend: ({ index, captureId }) =>
      settled(
        withItem(model, index, (item) => ({ ...item, captureId: Option.some(captureId), sending: Sending.Sent() })),
      ),
    SucceededInspectVideo: ({ index, plan }) =>
      continueVideo(
        withItem(model, index, (item) => ({ ...item, plan: Option.some(plan) })),
        index,
      ),
    SucceededSendVideoPart: ({ index, part, captureId }) => sentPart(model, index, part, captureId),
    FailedSend: (failure) => failedSend(model, failure),
    // Trying again resumes where it stopped: the same photo upload, the next part of a video.
    ClickedRetry: ({ index }) =>
      pump(
        withItem(model, index, (item) =>
          Sending.guards.Failed(item.sending) ? { ...item, sending: Sending.Waiting() } : item,
        ),
      ),
    ChangedLink: ({ url }) => ({ model: modifyFields(model, { link: () => url }) }),
    SubmittedLink: () => addedLink(model),
    SucceededSendLink: ({ index, name }) =>
      settled(
        withLink(model, index, (link) => ({
          ...link,
          name: Option.orElse(name, () => link.name),
          uploadId: Option.none(),
          sending: LinkSending.Sent(),
        })),
      ),
    FailedSendLink: (failure) => settled(failedLink(model, failure)),
    ClickedRetryLink: ({ index }) => retriedLink(model, index),
    // The page offers this only once nothing is waiting or on its way, so no upload is cut short.
    ClickedReview: () => (anyPending(model) ? { model } : { model, outMessage: OutMessage.FinishedSending() }),
    SucceededReadAllowance: ({ allowance }) => ({
      model: modifyFields(model, { maybeAllowance: () => Option.some(allowance) }),
    }),
    // The cost line keeps to the prices.
    FailedReadAllowance: () => ({ model }),
  })
