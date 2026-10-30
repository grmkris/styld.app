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
export const Hint = Schema.Literals(['holdOne', 'checking', 'taken', 'notSeen', 'tapToTake'])
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
  /** The garment check on its way, by number. Only its own answer counts: a tap, a flip or closing the
   * camera lets it go, and scenes that settle meanwhile are let go too. */
  pendingCheck: Schema.Option(Schema.Number),
  checksSent: Schema.Number,
  shots: Schema.Number,
  /** The small copy of the last photo taken, so the check can tell the back of the same garment. */
  lastCheck: Schema.Option(File.File),
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  camera: Camera.Closed(),
  facing: 'user',
  pendingCheck: Option.none(),
  checksSent: 0,
  shots: 0,
  lastCheck: Option.none(),
})

export const isOpen = (model: Model) => !Camera.guards.Closed(model.camera)

// MESSAGE

export const Message = defineMessageUnion({
  ClickedDone: {},
  ClickedFlip: {},
  StartedCamera: {},
  FailedCamera: { reason: Schema.Literals(['denied', 'unavailable']) },
  SettledScene: { check: File.File, still: File.File },
  StayedStill: { check: File.File, still: File.File },
  TappedPicture: { check: File.File, still: File.File },
  SucceededCheckHeld: { token: Schema.Number, check: File.File, still: File.File, held: Schema.Boolean, side: Side },
  FailedCheckHeld: { token: Schema.Number },
  CompletedBuzz: {},
})
export type Message = typeof Message.Type

/** A photo taken, with the side of the garment the check saw; and the camera closed. */
export const OutMessage = defineMessageUnion({
  TookPhoto: { photo: File.File, side: Schema.Option(Side) },
  ClosedCamera: {},
})
export type OutMessage = typeof OutMessage.Type

// MOUNT

/** Run the camera in the element it is mounted on, loading the camera code only then. Code that fails
 * to load (offline, or a newer release) reports the camera as unavailable.
 * @internal Exported for its tests. */
export const WatchCamera = Mount.defineStream('WatchCamera', {
  args: { facing: Facing },
  messages: [
    Message.StartedCamera,
    Message.FailedCamera,
    Message.SettledScene,
    Message.StayedStill,
    Message.TappedPicture,
  ],
  execute: ({ element, facing }) =>
    Stream.unwrap(
      Effect.tryPromise(() => import('../capture/Camera.ts')).pipe(
        Effect.map(({ watchCamera }) =>
          watchCamera(element, facing).pipe(
            Stream.map((event) => {
              if (event.kind === 'started') return Message.StartedCamera()
              if (event.kind === 'failed') return Message.FailedCamera({ reason: event.reason })
              const pictures = { check: event.check, still: event.still }
              if (event.kind === 'settled') return Message.SettledScene(pictures)
              return event.kind === 'again' ? Message.StayedStill(pictures) : Message.TappedPicture(pictures)
            }),
          ),
        ),
        Effect.orElseSucceed(() => Stream.make(Message.FailedCamera({ reason: 'unavailable' }))),
      ),
    ),
})

// COMMAND

const base64Of = (file: File.File) =>
  Effect.tryPromise(() => file.arrayBuffer()).pipe(Effect.map((bytes) => Base64.encode(new Uint8Array(bytes))))

/** Ask whether one garment is shown in the settled picture, and which side.
 * @internal Exported for its tests. */
export const CheckHeld = Command.define('CheckHeld', {
  args: { token: Schema.Number, check: File.File, still: File.File, previous: Schema.Option(File.File) },
  messages: [Message.SucceededCheckHeld, Message.FailedCheckHeld],
  execute: ({ token, check, still, previous }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const frame = yield* base64Of(check)
      const earlier = Option.isSome(previous) ? { previous: yield* base64Of(previous.value) } : {}
      const answer = yield* api.capture.check({ payload: { frame, ...earlier } })
      return Message.SucceededCheckHeld({ token, check, still, held: answer.held, side: answer.side })
    }).pipe(Effect.orElseSucceed(() => Message.FailedCheckHeld({ token }))),
})

/** A short buzz on phones that have one, when a photo is taken.
 * @internal Exported for its tests. */
export const Buzz = Command.define('Buzz', {
  messages: [Message.CompletedBuzz],
  execute: Effect.sync(() => {
    if ('vibrate' in navigator) navigator.vibrate(40)
    return Message.CompletedBuzz()
  }),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient>

const watching = (hint: Hint) => Camera.Watching({ hint })

/** Whether an answer is for the check still pending, with the camera still watching. */
const awaited = (model: Model, token: number) =>
  Camera.guards.Watching(model.camera) && Option.contains(model.pendingCheck, token)

const took = (model: Model, photo: File.File, check: File.File, side: Option.Option<Side>): UpdateReturn => ({
  model: modifyFields(model, {
    camera: () => watching('taken'),
    pendingCheck: () => Option.none(),
    shots: (shots) => shots + 1,
    lastCheck: () => Option.some(check),
  }),
  commands: [Buzz()],
  outMessage: OutMessage.TookPhoto({ photo, side }),
})

/** A settled picture goes to the garment check, unless one is already out. */
const settled = (model: Model, check: File.File, still: File.File): UpdateReturn => {
  if (Option.isSome(model.pendingCheck) || !Camera.guards.Watching(model.camera)) return { model }
  const token = model.checksSent
  return {
    model: modifyFields(model, {
      pendingCheck: () => Option.some(token),
      checksSent: (sent) => sent + 1,
      camera: () => watching('checking'),
    }),
    commands: [CheckHeld({ token, check, still, previous: model.lastCheck })],
  }
}

/** Open the camera; the page calls this when the person chooses to hold pieces up. */
export const open = (model: Model): UpdateReturn =>
  isOpen(model) ? { model } : { model: modifyFields(model, { camera: () => Camera.Starting() }) }

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedDone: () => ({
      model: modifyFields(model, { camera: () => Camera.Closed(), pendingCheck: () => Option.none() }),
      outMessage: OutMessage.ClosedCamera(),
    }),
    // A new facing mounts a new camera; the old one stops as its element goes.
    ClickedFlip: () => ({
      model: modifyFields(model, {
        facing: (facing) => (facing === 'user' ? 'environment' : 'user'),
        camera: () => Camera.Starting(),
        pendingCheck: () => Option.none(),
      }),
    }),
    StartedCamera: () =>
      Camera.guards.Starting(model.camera)
        ? { model: modifyFields(model, { camera: () => watching('holdOne') }) }
        : { model },
    FailedCamera: ({ reason }) =>
      isOpen(model) ? { model: modifyFields(model, { camera: () => Camera.Failed({ reason }) }) } : { model },
    SettledScene: ({ check, still }) => settled(model, check, still),
    // Held still a while longer: look again, unless the garment was just taken and is still being held.
    StayedStill: ({ check, still }) =>
      Camera.guards.Watching(model.camera) && model.camera.hint === 'taken' ? { model } : settled(model, check, still),
    TappedPicture: ({ check, still }) =>
      Camera.guards.Watching(model.camera) ? took(model, still, check, Option.none()) : { model },
    SucceededCheckHeld: ({ token, check, still, held, side }) => {
      if (!awaited(model, token)) return { model }
      return held
        ? took(model, still, check, side === 'unclear' ? Option.none() : Option.some(side))
        : { model: modifyFields(model, { pendingCheck: () => Option.none(), camera: () => watching('notSeen') }) }
    },
    // Without the check, the camera still takes a photo by hand.
    FailedCheckHeld: ({ token }) =>
      awaited(model, token)
        ? { model: modifyFields(model, { pendingCheck: () => Option.none(), camera: () => watching('tapToTake') }) }
        : { model },
    CompletedBuzz: () => ({ model }),
  })
