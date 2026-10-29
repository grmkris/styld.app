import { Side } from '@styld/protocol'
import { Effect, Option, Schema, Stream } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { Command, File, Mount, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// MODEL

const Facing = Schema.Literals(['user', 'environment'])
type Facing = typeof Facing.Type

/** What the camera panel tells the person while it watches. */
export const Hint = Schema.Literals(['holdOne', 'checking', 'taken', 'tapToTake'])
export type Hint = typeof Hint.Type

export const Camera = defineTaggedUnion({
  Closed: {},
  Starting: {},
  Watching: { hint: Hint },
  Failed: { reason: Schema.Literals(['denied', 'unavailable']) },
})
export type Camera = typeof Camera.Type

/** The held-up camera: the phone faces the person, who holds up one garment at a time; when the
 * picture settles the garment check confirms it and the photo is taken. A tap takes one by hand. */
export const Model = Schema.Struct({
  camera: Camera,
  facing: Facing,
  /** A garment check is on its way; scenes that settle meanwhile are let go. */
  checking: Schema.Boolean,
  shots: Schema.Number,
  /** The small copy of the last photo taken, so the check can tell the back of the same garment. */
  lastCheck: Schema.Option(File.File),
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  camera: Camera.Closed(),
  facing: 'user',
  checking: false,
  shots: 0,
  lastCheck: Option.none(),
})

export const isOpen = (model: Model) => !Camera.guards.Closed(model.camera)

// MESSAGE

export const Message = defineMessageUnion({
  ClickedOpen: {},
  ClickedDone: {},
  ClickedFlip: {},
  StartedCamera: {},
  FailedCamera: { reason: Schema.Literals(['denied', 'unavailable']) },
  SettledScene: { check: File.File, still: File.File },
  TappedPicture: { check: File.File, still: File.File },
  CheckedHeld: { check: File.File, still: File.File, held: Schema.Boolean, side: Side },
  FailedCheck: {},
  Buzzed: {},
})
export type Message = typeof Message.Type

/** A photo taken, with the side of the garment the check saw; and the camera closed. */
export const OutMessage = defineMessageUnion({
  TookPhoto: { photo: File.File, side: Schema.Option(Side) },
  ClosedCamera: {},
})
export type OutMessage = typeof OutMessage.Type

// MOUNT

/** Run the camera in the element it is mounted on, loading the camera code only then.
 * @internal Exported for its tests. */
export const WatchCamera = Mount.defineStream('WatchCamera', {
  args: { facing: Facing },
  messages: [Message.StartedCamera, Message.FailedCamera, Message.SettledScene, Message.TappedPicture],
  execute: ({ element, facing }) =>
    Stream.unwrap(
      Effect.map(
        Effect.promise(() => import('../capture/Camera.ts')),
        ({ watchCamera }) => watchCamera(element, facing),
      ),
    ).pipe(
      Stream.map((event) => {
        if (event.kind === 'started') return Message.StartedCamera()
        if (event.kind === 'failed') return Message.FailedCamera({ reason: event.reason })
        return event.kind === 'settled'
          ? Message.SettledScene({ check: event.check, still: event.still })
          : Message.TappedPicture({ check: event.check, still: event.still })
      }),
    ),
})

// COMMAND

const base64Of = (file: File.File) =>
  Effect.map(
    Effect.promise(() => file.arrayBuffer()),
    (bytes) => Base64.encode(new Uint8Array(bytes)),
  )

/** Ask whether one garment is held up in the settled picture, and which side shows.
 * @internal Exported for its tests. */
export const CheckHeld = Command.define('CheckHeld', {
  args: { check: File.File, still: File.File, previous: Schema.Option(File.File) },
  messages: [Message.CheckedHeld, Message.FailedCheck],
  execute: ({ check, still, previous }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const frame = yield* base64Of(check)
      const earlier = Option.isSome(previous) ? { previous: yield* base64Of(previous.value) } : {}
      const answer = yield* api.capture.check({ payload: { frame, ...earlier } })
      return Message.CheckedHeld({ check, still, held: answer.held, side: answer.side })
    }).pipe(Effect.orElseSucceed(() => Message.FailedCheck())),
})

/** A short buzz on phones that have one, when a photo is taken.
 * @internal Exported for its tests. */
export const Buzz = Command.define('Buzz', {
  messages: [Message.Buzzed],
  execute: Effect.sync(() => {
    if ('vibrate' in navigator) navigator.vibrate(40)
    return Message.Buzzed()
  }),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient>

const watching = (hint: Hint) => Camera.Watching({ hint })

const took = (model: Model, photo: File.File, check: File.File, side: Option.Option<Side>): UpdateReturn => ({
  model: modifyFields(model, {
    camera: () => watching('taken'),
    checking: () => false,
    shots: (shots) => shots + 1,
    lastCheck: () => Option.some(check),
  }),
  commands: [Buzz()],
  outMessage: OutMessage.TookPhoto({ photo, side }),
})

/** Open the camera; the page calls this when the person chooses to hold pieces up. */
export const open = (model: Model): UpdateReturn => update(model, Message.ClickedOpen())

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedOpen: () => ({ model: modifyFields(model, { camera: () => Camera.Starting() }) }),
    ClickedDone: () => ({
      model: modifyFields(model, { camera: () => Camera.Closed(), checking: () => false }),
      outMessage: OutMessage.ClosedCamera(),
    }),
    // A new facing mounts a new camera; the old one stops as its element goes.
    ClickedFlip: () => ({
      model: modifyFields(model, {
        facing: (facing) => (facing === 'user' ? 'environment' : 'user'),
        camera: () => Camera.Starting(),
        checking: () => false,
      }),
    }),
    StartedCamera: () => ({ model: modifyFields(model, { camera: () => watching('holdOne') }) }),
    FailedCamera: ({ reason }) => ({ model: modifyFields(model, { camera: () => Camera.Failed({ reason }) }) }),
    SettledScene: ({ check, still }) =>
      model.checking || !Camera.guards.Watching(model.camera)
        ? { model }
        : {
            model: modifyFields(model, { checking: () => true, camera: () => watching('checking') }),
            commands: [CheckHeld({ check, still, previous: model.lastCheck })],
          },
    TappedPicture: ({ check, still }) => took(model, still, check, Option.none()),
    CheckedHeld: ({ check, still, held, side }) =>
      held && Camera.guards.Watching(model.camera)
        ? took(model, still, check, side === 'unclear' ? Option.none() : Option.some(side))
        : { model: modifyFields(model, { checking: () => false, camera: () => watching('holdOne') }) },
    // Without the check, the camera still takes a photo by hand.
    FailedCheck: () => ({ model: modifyFields(model, { checking: () => false, camera: () => watching('tapToTake') }) }),
    Buzzed: () => ({ model }),
  })
