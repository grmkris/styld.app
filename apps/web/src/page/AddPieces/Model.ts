import { FileDrop } from '@foldkit/ui'
import { CaptureSource, CreateVideoCapture, Side } from '@styld/protocol'
import { Schema } from 'effect'
import { File } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'
import * as HeldCamera from '../HeldCamera.ts'
import { SendProblem, VideoPlan } from './Message.ts'

// MODEL

/** Why a chosen file is not sent at all. */
export const FileProblem = Schema.Literals(['notSupported', 'tooLarge'])
export type FileProblem = typeof FileProblem.Type

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
  /** A video, or a part of one, sampled and uploaded whose capture request got no answer: trying again
   * sends the same request, so the server makes one capture. */
  prepared: Schema.Option(CreateVideoCapture),
  /** How a video goes, once read; and how many of its parts went. Trying again resumes at the next. */
  plan: Schema.Option(VideoPlan),
  partsSent: Schema.Number,
  sending: Sending,
})
export type Item = typeof Item.Type

export const Model = Schema.Struct({
  /** The picker: photos and videos from the library. */
  drop: FileDrop.Model,
  /** The camera on this page that takes a photo of each garment held up to it. */
  held: HeldCamera.Model,
  /** Every file chosen on this page, in order; a file keeps its place, so its index names it. */
  items: Schema.Array(Item),
  rejected: Schema.Array(Schema.Struct({ name: Schema.String, problem: FileProblem })),
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  drop: FileDrop.init({ id: 'add-pieces' }),
  held: HeldCamera.init(),
  items: [],
  rejected: [],
})
