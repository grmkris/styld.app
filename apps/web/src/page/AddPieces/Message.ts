import { FileDrop } from '@foldkit/ui'
import { CaptureId, CreateVideoCapture } from '@styld/protocol'
import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import * as HeldCamera from '../HeldCamera.ts'

/** Why sending a file stopped: today's free allowance is spent, the video is too long or cannot be
 * read here, the server refused the bytes, or the network failed (worth trying again). */
export const SendProblem = Schema.Literals(['dailyLimit', 'videoTooLong', 'videoUnreadable', 'refused', 'network'])
export type SendProblem = typeof SendProblem.Type

/** One 30-second part of a video, in milliseconds from its start. */
export const VideoPart = Schema.Struct({ index: Schema.Number, startMs: Schema.Number, endMs: Schema.Number })

/** How a video goes to Styld: cut into parts on this device, or sent whole where it cannot be cut. */
export const VideoPlan = Schema.Struct({
  route: Schema.Literals(['parts', 'whole']),
  durationMs: Schema.Number,
  parts: Schema.Array(VideoPart),
})
export type VideoPlan = typeof VideoPlan.Type

// MESSAGE

export const Message = defineMessageUnion({
  GotDropMessage: { message: FileDrop.Message },
  GotHeldCameraMessage: { message: HeldCamera.Message },
  ClickedHoldUp: {},
  ClickedLayOut: {},
  SucceededSend: { index: Schema.Number, captureId: CaptureId },
  SucceededInspectVideo: { index: Schema.Number, plan: VideoPlan },
  SucceededSendVideoPart: { index: Schema.Number, part: Schema.Number, captureId: CaptureId },
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
