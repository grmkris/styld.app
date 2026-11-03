import * as SecureRandom from 'effect/crypto/SecureRandom'
import { drawOperationId } from '../OperationIds.ts'
import { CameraLayout, Side } from '@styld/protocol'
import { Duration, Effect, Option, Schema, Stream } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { Command, File, Mount, type Update } from 'foldkit'
import { DEVTOOLS_HOST_ID } from 'foldkit/devtools-host'
import * as Dom from 'foldkit/dom'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'
import type { CameraEvent } from '../capture/Camera.ts'

// MODEL

const Facing = Schema.Literals(['user', 'environment'])
type Facing = typeof Facing.Type

/** Which side of the garment in view the camera takes next: its front, then its back, so each piece
 * comes with both. */
export const Step = Schema.Literals(['front', 'back'])
export type Step = typeof Step.Type

/** What the camera panel tells the person while it watches. */
export const Hint = Schema.Literals([
  'holdOne',
  'checking',
  'counting',
  'blocked',
  'taken',
  'showBack',
  'notSeen',
  'tapToTake',
])
export type Hint = typeof Hint.Type

export const Camera = defineTaggedUnion({
  Closed: {},
  Starting: {},
  Watching: { hint: Hint },
  Failed: { reason: Schema.Literals(['denied', 'unavailable']) },
})
export type Camera = typeof Camera.Type

/** The camera that takes each garment, front and then back: held up, with the phone facing the person who holds up
 * one garment at a time; or laid out, with the phone above a garment laid flat, taken once the hands are out of
 * view. When the picture settles the garment check confirms it and the photo is taken. A tap takes one by hand, and
 * the back may be skipped. */
export const Model = Schema.Struct({
  camera: Camera,
  layout: CameraLayout,
  facing: Facing,
  step: Step,
  /** The garment check on its way, by number. Only its own answer counts: a tap, a flip or closing the
   * camera lets it go, and scenes that settle meanwhile are let go too. */
  pendingCheck: Schema.Option(Schema.Number),
  checksSent: Schema.Number,
  /** Pieces taken: each front starts one. */
  pieces: Schema.Number,
  /** Photos taken, fronts and backs: each flashes and flies to the stack. */
  shots: Schema.Number,
  /** How close the picture is to settling, in quarters, for the ring round the shutter. */
  settle: Schema.Number,
  /** The small copy of the last photo taken, so the check can tell the back of the same garment. */
  lastCheck: Schema.Option(File.File),
  /** The large central countdown after a checked, automatically settled frame. */
  countdown: Schema.Option(Schema.Int),
  countdownToken: Schema.Option(Schema.Int),
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  camera: Camera.Closed(),
  layout: 'held',
  facing: 'user',
  step: 'front',
  pendingCheck: Option.none(),
  checksSent: 0,
  pieces: 0,
  shots: 0,
  settle: 0,
  lastCheck: Option.none(),
  countdown: Option.none(),
  countdownToken: Option.none(),
})

export const isOpen = (model: Model) => !Camera.guards.Closed(model.camera)

/** Whether the camera screen is up: starting or watching, not closed or refused. */
export const isLive = (model: Model) => Camera.guards.Starting(model.camera) || Camera.guards.Watching(model.camera)

// MESSAGE

export const Message = defineMessageUnion({
  ClickedDone: {},
  ClickedFlip: {},
  ClickedSkipBack: {},
  StartedCamera: {},
  FailedCamera: { reason: Schema.Literals(['denied', 'unavailable']) },
  SettlingScene: { level: Schema.Number },
  SettledScene: { check: File.File, still: File.File },
  StayedStill: { check: File.File, still: File.File },
  TappedPicture: { check: File.File, still: File.File },
  SucceededCheckHeld: {
    token: Schema.Number,
    check: File.File,
    still: File.File,
    held: Schema.Boolean,
    side: Side,
    samePrevious: Schema.Boolean,
    holding: Schema.Boolean,
  },
  FailedCheckHeld: { token: Schema.Number },
  ElapsedCountdown: { token: Schema.Int, count: Schema.Int },
  ChangedScene: { blocked: Schema.Boolean },
  TookCountdownPhoto: { token: Schema.Int, check: File.File, still: File.File },
  RequestedCountdownPhoto: {},
  CompletedBuzz: {},
  HeldScreen: {},
  ShowedPhoto: {},
})
export type Message = typeof Message.Type

/** A photo taken, of a piece's front or of its back; and the camera closed. A back belongs to the front
 * taken before it. */
export const OutMessage = defineMessageUnion({
  TookPhoto: { photo: File.File, side: Step },
  ClosedCamera: {},
})
export type OutMessage = typeof OutMessage.Type

// MOUNT

/** The camera screen's element. */
export const screenId = 'camera-screen'

/** Hold the camera screen, the dialog it is mounted on, as modal while it is in the page: the page behind
 * goes inert and stops scrolling, focus starts on the shutter and stays on the screen, and Escape asks to
 * close it. */
export const HoldScreen = Mount.define('HoldScreen', {
  messages: [Message.HeldScreen],
  execute: ({ element }) =>
    Effect.acquireRelease(
      Dom.showDialog(`#${element.id}`, {
        isModal: true,
        focusSelector: 'button[data-shutter]',
        allowedOutsideSelectors: [`#${DEVTOOLS_HOST_ID}`],
      }).pipe(
        Effect.tap((acquired) => (acquired ? Dom.lockScroll : Effect.void)),
        Effect.orElseSucceed(() => false),
      ),
      (acquired) => (acquired ? Dom.releaseDialogResources(element.id) : Effect.void),
    ).pipe(Effect.as(Message.HeldScreen())),
})

/** Show a photo taken here in the image it is mounted on, for as long as the image is in the page. */
export const ShowPhoto = Mount.define('ShowPhoto', {
  args: { photo: File.File },
  messages: [Message.ShowedPhoto],
  execute: ({ element, photo }) =>
    Effect.acquireRelease(
      Effect.sync(() => URL.createObjectURL(photo)),
      (url) => Effect.sync(() => URL.revokeObjectURL(url)),
    ).pipe(
      Effect.map((url) => {
        if (element instanceof HTMLImageElement) element.src = url
        return Message.ShowedPhoto()
      }),
    ),
})

/** Run the camera in the element it is mounted on, loading the camera code only then. Code that fails
 * to load (offline, or a newer release) reports the camera as unavailable.
 */
const cameraMessage = (event: CameraEvent) => {
  if (event.kind === 'started') return Message.StartedCamera()
  if (event.kind === 'failed') return Message.FailedCamera({ reason: event.reason })
  if (event.kind === 'settling') return Message.SettlingScene({ level: event.level })
  if (event.kind === 'changed') return Message.ChangedScene({ blocked: event.blocked })
  if (event.kind === 'counted')
    return Message.TookCountdownPhoto({ token: event.token, check: event.check, still: event.still })
  const pictures = { check: event.check, still: event.still }
  if (event.kind === 'settled') return Message.SettledScene(pictures)
  return event.kind === 'again' ? Message.StayedStill(pictures) : Message.TappedPicture(pictures)
}

export const WatchCamera = Mount.defineStream('WatchCamera', {
  args: { facing: Facing },
  messages: [
    Message.StartedCamera,
    Message.FailedCamera,
    Message.SettlingScene,
    Message.ChangedScene,
    Message.TookCountdownPhoto,
    Message.SettledScene,
    Message.StayedStill,
    Message.TappedPicture,
  ],
  execute: ({ element, facing }) =>
    Stream.unwrap(
      Effect.tryPromise(() => import('../capture/Camera.ts')).pipe(
        Effect.map(({ watchCamera }) => watchCamera(element, facing).pipe(Stream.map(cameraMessage))),
        Effect.orElseSucceed(() => Stream.make(Message.FailedCamera({ reason: 'unavailable' }))),
      ),
    ),
})

// COMMAND

const base64Of = (file: File.File) =>
  Effect.tryPromise(() => file.arrayBuffer()).pipe(Effect.map((bytes) => Base64.encode(new Uint8Array(bytes))))

/** Ask whether one garment is shown in the settled picture, which side, and whether a person holds it.
 */
export const CheckHeld = Command.define('CheckHeld', {
  args: {
    token: Schema.Number,
    check: File.File,
    still: File.File,
    previous: Schema.Option(File.File),
    layout: CameraLayout,
  },
  messages: [Message.SucceededCheckHeld, Message.FailedCheckHeld],
  execute: ({ token, check, still, previous, layout }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const frame = yield* base64Of(check)
      const earlier = Option.isSome(previous) ? { previous: yield* base64Of(previous.value) } : {}
      const answer = yield* api.capture.check({
        payload: { operationId: yield* drawOperationId(), frame, layout, ...earlier },
      })
      return Message.SucceededCheckHeld({ token, check, still, ...answer })
    }).pipe(Effect.orElseSucceed(() => Message.FailedCheckHeld({ token }))),
})

/** A short buzz on phones that have one, when a photo is taken.
 */
export const Buzz = Command.define('Buzz', {
  messages: [Message.CompletedBuzz],
  execute: Effect.sync(() => {
    if ('vibrate' in navigator) navigator.vibrate(40)
    return Message.CompletedBuzz()
  }),
})

/** Give someone standing across the room a visible moment to hold or turn the garment before the shutter. */
export const WaitForCountdown = Command.define('WaitForCountdown', {
  args: { token: Schema.Int, count: Schema.Int },
  messages: [Message.ElapsedCountdown],
  execute: ({ token, count }) =>
    Effect.sleep(Duration.seconds(1)).pipe(Effect.as(Message.ElapsedCountdown({ token, count }))),
})

/** Ask the live camera for a fresh frame after the count; the model accepts only its current token. */
export const TakeCountdownPhoto = Command.define('TakeCountdownPhoto', {
  args: { token: Schema.Int },
  messages: [Message.RequestedCountdownPhoto],
  execute: ({ token }) =>
    Effect.sync(() => {
      document
        .querySelector(`#${screenId} video`)
        ?.dispatchEvent(new CustomEvent('styld-countdown-photo', { detail: token, bubbles: true }))
      return Message.RequestedCountdownPhoto()
    }),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | SecureRandom.SecureRandom>

const watching = (hint: Hint) => Camera.Watching({ hint })

/** Whether an answer is for the check still pending, with the camera still watching. */
const awaited = (model: Model, token: number) =>
  Camera.guards.Watching(model.camera) && Option.contains(model.pendingCheck, token)

/** A front starts a piece and asks for its back; a back completes it. */
const took = (model: Model, photo: File.File, check: File.File, side: Step): UpdateReturn => ({
  model: modifyFields(model, {
    camera: () => watching(side === 'front' ? 'showBack' : 'taken'),
    step: () => (side === 'front' ? 'back' : 'front'),
    pendingCheck: () => Option.none(),
    pieces: (pieces) => (side === 'front' ? pieces + 1 : pieces),
    shots: (shots) => shots + 1,
    settle: () => 0,
    lastCheck: () => Option.some(check),
    countdown: () => Option.none(),
    countdownToken: () => Option.none(),
  }),
  commands: [Buzz()],
  outMessage: OutMessage.TookPhoto({ photo, side }),
})

/** A settled picture goes to the garment check, unless one is already out. */
const settled = (model: Model, check: File.File, still: File.File): UpdateReturn => {
  if (Option.isSome(model.pendingCheck) || Option.isSome(model.countdown) || !Camera.guards.Watching(model.camera))
    return { model }
  const token = model.checksSent
  return {
    model: modifyFields(model, {
      pendingCheck: () => Option.some(token),
      checksSent: (sent) => sent + 1,
      camera: () => watching('checking'),
    }),
    commands: [CheckHeld({ token, check, still, previous: model.lastCheck, layout: model.layout })],
  }
}

/** Open the camera laid out as `layout`: looking down at pieces laid out, it starts with the camera on the back. */
const openAs = (model: Model, layout: CameraLayout): UpdateReturn =>
  isOpen(model)
    ? { model }
    : {
        model: modifyFields(model, {
          camera: () => Camera.Starting(),
          layout: () => layout,
          facing: (facing) => (layout === 'flat' ? 'environment' : facing),
        }),
      }

/** Open the camera; the page calls this when the person chooses to hold pieces up. */
export const open = (model: Model): UpdateReturn => openAs(model, 'held')

/** Open the camera above pieces laid out; the page calls this when the person chooses to lay them out. */
export const layOut = (model: Model): UpdateReturn => openAs(model, 'flat')

/** Whether the check's answer is a garment to take: one held up by a person, or one laid out with nobody's hands on
 * it (a garment being laid down or turned over is not taken yet). */
const shows = (model: Model, held: boolean, holding: boolean) => held && (model.layout === 'flat' ? !holding : holding)

const checked = (model: Model, token: number, held: boolean, holding: boolean): UpdateReturn => {
  if (!awaited(model, token)) return { model }
  if (!shows(model, held, holding))
    return { model: modifyFields(model, { pendingCheck: () => Option.none(), camera: () => watching('notSeen') }) }
  return {
    model: modifyFields(model, {
      pendingCheck: () => Option.none(),
      countdown: () => Option.some(3),
      countdownToken: () => Option.some(token),
      camera: () => watching('counting'),
    }),
    commands: [WaitForCountdown({ token, count: 3 })],
  }
}

const elapsed = (model: Model, token: number, count: number): UpdateReturn => {
  if (
    !Camera.guards.Watching(model.camera) ||
    !Option.contains(model.countdownToken, token) ||
    !Option.contains(model.countdown, count)
  )
    return { model }
  if (count > 1)
    return {
      model: modifyFields(model, { countdown: () => Option.some(count - 1) }),
      commands: [WaitForCountdown({ token, count: count - 1 })],
    }
  return {
    model: modifyFields(model, { countdown: () => Option.some(0) }),
    commands: [TakeCountdownPhoto({ token })],
  }
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedDone: () => ({
      model: modifyFields(model, {
        camera: () => Camera.Closed(),
        step: () => 'front',
        pendingCheck: () => Option.none(),
        countdown: () => Option.none(),
        countdownToken: () => Option.none(),
      }),
      outMessage: OutMessage.ClosedCamera(),
    }),
    // The piece goes without its back; a check on its way would have taken one.
    ClickedSkipBack: () =>
      model.step === 'back'
        ? {
            model: modifyFields(model, {
              step: () => 'front',
              pendingCheck: () => Option.none(),
              countdown: () => Option.none(),
              countdownToken: () => Option.none(),
              camera: (camera) => (Camera.guards.Watching(camera) ? watching('taken') : camera),
            }),
          }
        : { model },
    // A new facing mounts a new camera; the old one stops as its element goes.
    ClickedFlip: () => ({
      model: modifyFields(model, {
        facing: (facing) => (facing === 'user' ? 'environment' : 'user'),
        camera: () => Camera.Starting(),
        pendingCheck: () => Option.none(),
        countdown: () => Option.none(),
        countdownToken: () => Option.none(),
      }),
    }),
    StartedCamera: () =>
      Camera.guards.Starting(model.camera)
        ? { model: modifyFields(model, { camera: () => watching('holdOne') }) }
        : { model },
    FailedCamera: ({ reason }) =>
      isOpen(model) ? { model: modifyFields(model, { camera: () => Camera.Failed({ reason }) }) } : { model },
    SettlingScene: ({ level }) => ({ model: modifyFields(model, { settle: () => level }) }),
    SettledScene: ({ check, still }) => settled(model, check, still),
    // Held still a while longer: look again, unless the garment was just taken and is still being held,
    // front or back. Only turning it, or the next piece, moves the picture enough to look again.
    StayedStill: ({ check, still }) =>
      Camera.guards.Watching(model.camera) && (model.camera.hint === 'taken' || model.camera.hint === 'showBack')
        ? { model }
        : settled(model, check, still),
    TappedPicture: ({ check, still }) =>
      Camera.guards.Watching(model.camera) ? took(model, still, check, model.step) : { model },
    // A garment shown but not held, such as clothes on the bed while the person fetches the next piece, is
    // not taken when held up.
    SucceededCheckHeld: ({ token, held, holding }) => checked(model, token, held, holding),
    // Without the check, the camera still takes a photo by hand.
    FailedCheckHeld: ({ token }) =>
      awaited(model, token)
        ? { model: modifyFields(model, { pendingCheck: () => Option.none(), camera: () => watching('tapToTake') }) }
        : { model },
    ElapsedCountdown: ({ token, count }) => elapsed(model, token, count),
    ChangedScene: ({ blocked }) =>
      Camera.guards.Watching(model.camera)
        ? {
            model: modifyFields(model, {
              pendingCheck: () => Option.none(),
              countdown: () => Option.none(),
              countdownToken: () => Option.none(),
              settle: () => 0,
              camera: () => watching(blocked ? 'blocked' : model.step === 'back' ? 'showBack' : 'holdOne'),
            }),
          }
        : { model },
    TookCountdownPhoto: ({ token, check, still }) =>
      Camera.guards.Watching(model.camera) &&
      Option.contains(model.countdownToken, token) &&
      Option.contains(model.countdown, 0)
        ? took(model, still, check, model.step)
        : { model },
    RequestedCountdownPhoto: () => ({ model }),
    CompletedBuzz: () => ({ model }),
    HeldScreen: () => ({ model }),
    ShowedPhoto: () => ({ model }),
  })
