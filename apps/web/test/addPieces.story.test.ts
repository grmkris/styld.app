import { FileDrop } from '@foldkit/ui'
import { CaptureId, type CaptureSource, CreateVideoCapture, OperationId } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { InspectVideo, SendLink, SendPhoto, SendVideo, SendVideoPart } from '../src/page/AddPieces/Commands.ts'
import { Message, type VideoPlan } from '../src/page/AddPieces/Message.ts'
import { init, type Model, Sending } from '../src/page/AddPieces/Model.ts'
import { subscriptions } from '../src/page/AddPieces/Subscription.ts'
import { classify, update } from '../src/page/AddPieces/Update.ts'
import { Buzz, Message as CameraMessage, type Message as HeldCameraMessage } from '../src/page/HeldCamera.ts'

const file = (name: string, type: string, bytes = 8) => new globalThis.File([new Uint8Array(bytes)], name, { type })
const tee = file('tee.jpg', 'image/jpeg')
const jeans = file('jeans.png', 'image/png')
const coat = file('coat.webp', 'image/webp')
const rail = file('rail.mov', 'video/quicktime')
const closet = file('closet.mp4', 'video/mp4')

const first = { index: 0, startMs: 0, endMs: 30_000 }
const second = { index: 1, startMs: 30_000, endMs: 60_000 }
const third = { index: 2, startMs: 60_000, endMs: 75_000 }
const parts = [first, second, third]
const cutInParts: VideoPlan = { route: 'parts', durationMs: 75_000, parts }

/** A part's capture request, as `SendVideoPart` prepares it. */
const request = Schema.decodeUnknownSync(CreateVideoCapture)({
  operationId: 'op-part-1',
  videoUploadId: `up_${'v'.repeat(22)}`,
  durationMs: 30_000,
  width: 406,
  height: 720,
  stills: [{ uploadId: `up_${'s'.repeat(22)}`, atMs: 0, sharpness: Array.from({ length: 64 }, () => 0.5) }],
})

/** The capture the rail's first part became: every later part names it as its import. */
const railCapture = CaptureId.make(`cp_${'r'.repeat(22)}`)

const partOf = (part: typeof first, prepared = Option.none<typeof request>()) =>
  SendVideoPart({
    index: 0,
    video: rail,
    part,
    prepared,
    importOf: part.index === 0 ? Option.none() : Option.some(railCapture),
  })

/** The rail's part `part` became a capture. */
const sentPart = (part: number) =>
  Message.SucceededSendVideoPart({ index: 0, part, captureId: part === 0 ? railCapture : captureOf(10 + part) })

const failedOn = (problem: 'network' | 'dailyLimit', prepared = Option.none<typeof request>()) =>
  Message.FailedSend({ index: 0, problem, operationId: Option.none(), uploadId: Option.none(), prepared })

/** The rail is read as three parts and the first goes up. */
const readThenSendFirstPart = [
  Command.resolve(
    InspectVideo({ index: 0, video: rail }),
    Message.SucceededInspectVideo({ index: 0, plan: cutInParts }),
  ),
  Command.resolve(partOf(first), sentPart(0)),
]

const chosen = (one: File, ...rest: ReadonlyArray<File>) =>
  Message.GotDropMessage({ message: FileDrop.Message.DroppedFiles({ files: [one, ...rest] }) })

/** Whether the add page asks for the screen to stay on. */
const screenOn = (current: Model) => subscriptions.screenAwake.modelToDependencies(current).awake

/** A message from the held-up camera, as the page receives it. */
const camera = (sent: HeldCameraMessage) => Message.GotHeldCameraMessage({ message: sent })

/** Where a photo came from; a camera shot overrides it. */
const picker: CaptureSource = 'picker'

const photoArgs = (index: number, photo: File) => ({
  index,
  photo,
  source: picker,
  side: Option.none(),
  pairsWith: Option.none<CaptureId>(),
  importOf: Option.none<CaptureId>(),
  operationId: Option.none(),
  uploadId: Option.none(),
})

const captureOf = (index: number) => CaptureId.make(`cp_${String(index).padStart(22, '0')}`)

/** The file at `index` became a capture. */
const succeeded = (index: number) => Message.SucceededSend({ index, captureId: captureOf(index) })

describe('choosing files to add', () => {
  test('photos and videos are taken by type and size; anything else is named and left out', () => {
    expect(classify(tee)).toEqual({ kind: 'photo' })
    expect(classify(rail)).toEqual({ kind: 'video' })
    // A video of any size: this device reads it and sends small parts.
    expect(classify(file('long.mp4', 'video/mp4', 200 * 1024 * 1024))).toEqual({ kind: 'video' })
    expect(classify(file('notes.pdf', 'application/pdf'))).toEqual({ problem: 'notSupported' })
    expect(classify(file('huge.jpg', 'image/jpeg', 15 * 1024 * 1024 + 1))).toEqual({ problem: 'tooLarge' })
    story(
      update,
      given(init()),
      message(chosen(file('notes.pdf', 'application/pdf'))),
      Command.expectNone(),
      model(({ items, rejected }) => {
        expect(items).toEqual([])
        expect(rejected).toEqual([{ name: 'notes.pdf', problem: 'notSupported' }])
      }),
    )
  })

  test('photos picked together go up as one import, after the first; the tray opens when all are sent', () => {
    const joined = (index: number, photo: File) =>
      SendPhoto({ ...photoArgs(index, photo), importOf: Option.some(captureOf(0)) })
    story(
      update,
      given(init()),
      message(chosen(tee, jeans, coat)),
      // Two could go at once, but the others wait for the first's capture, to name it as their import.
      Command.expectExact(SendPhoto(photoArgs(0, tee))),
      model(({ items }) =>
        expect(items.map(({ sending }) => Sending.guards.Sending(sending))).toEqual([true, false, false]),
      ),
      Command.resolve(SendPhoto(photoArgs(0, tee)), succeeded(0)),
      Command.expectExact(joined(1, jeans), joined(2, coat)),
      Command.resolve(joined(1, jeans), succeeded(1)),
      Command.resolve(joined(2, coat), succeeded(2)),
      expectOutMessage({ _tag: 'FinishedSending' }),
    )
  })

  test('a photo picked on its own, or beside videos only, joins no import', () => {
    story(
      update,
      given(init()),
      message(chosen(rail, tee)),
      Command.expectHas(SendPhoto(photoArgs(1, tee))),
      model(({ items }) => expect(items.map(({ joins }) => joins)).toEqual([Option.none(), Option.none()])),
      Command.resolve(SendPhoto(photoArgs(1, tee)), succeeded(1)),
      Command.resolve(InspectVideo({ index: 0, video: rail }), failedOn('dailyLimit')),
    )
  })

  test('a long video is read, then sent part by part; trying again resends a lost request and resumes', () => {
    story(
      update,
      given(init()),
      message(chosen(rail)),
      Command.expectExact(InspectVideo({ index: 0, video: rail })),
      ...readThenSendFirstPart,
      // The answer to part 2's request was lost: the request is kept.
      Command.resolve(partOf(second), failedOn('network', Option.some(request))),
      model(({ items }) => {
        expect(items[0]?.partsSent).toBe(1)
        expect(items[0]?.sending).toEqual(Sending.Failed({ problem: 'network' }))
      }),
      message(Message.ClickedRetry({ index: 0 })),
      Command.expectExact(partOf(second, Option.some(request))),
      Command.resolve(partOf(second, Option.some(request)), sentPart(1)),
      Command.resolve(partOf(third), sentPart(2)),
      expectOutMessage({ _tag: 'FinishedSending' }),
      model(({ items }) => expect(items[0]?.sending).toEqual(Sending.Sent())),
    )
  })

  test('the screen stays on while a video is read, from its first part to its last, and not after', () => {
    // A photo going up does not hold the screen on.
    story(
      update,
      given(init()),
      message(chosen(tee)),
      model((current) => expect(screenOn(current)).toBe(false)),
      Command.resolve(SendPhoto(photoArgs(0, tee)), succeeded(0)),
    )
    story(
      update,
      given(init()),
      message(chosen(rail, tee)),
      model((current) => expect(screenOn(current)).toBe(true)),
      Command.resolve(SendPhoto(photoArgs(1, tee)), succeeded(1)),
      ...readThenSendFirstPart,
      // The same dependency between parts: the lock is held, not asked for again.
      model((current) => expect(screenOn(current)).toBe(true)),
      Command.resolve(partOf(second), failedOn('dailyLimit')),
      model((current) => expect(screenOn(current)).toBe(false)),
    )
  })

  test("the day's allowance stops a video partway, and a late answer for another part changes nothing", () => {
    story(
      update,
      given(init()),
      message(chosen(rail)),
      ...readThenSendFirstPart,
      Command.resolve(partOf(second), failedOn('dailyLimit')),
      message(sentPart(0)),
      Command.expectNone(),
      model(({ items }) => {
        expect(items[0]?.partsSent).toBe(1)
        expect(items[0]?.sending).toEqual(Sending.Failed({ problem: 'dailyLimit' }))
      }),
    )
  })

  test('one video is read at a time while photos still go, and a video this browser cannot cut goes whole', () => {
    story(
      update,
      given(init()),
      message(chosen(rail, closet, tee)),
      Command.expectExact(InspectVideo({ index: 0, video: rail }), SendPhoto(photoArgs(2, tee))),
      model(({ items }) =>
        expect(items.map(({ sending }) => Sending.guards.Sending(sending))).toEqual([true, false, true]),
      ),
      Command.resolve(SendPhoto(photoArgs(2, tee)), succeeded(2)),
      Command.resolve(
        InspectVideo({ index: 0, video: rail }),
        Message.SucceededInspectVideo({ index: 0, plan: { route: 'whole', durationMs: 20_000, parts: [] } }),
      ),
      Command.resolve(
        SendVideo({ index: 0, video: rail, contentType: 'video/quicktime', prepared: Option.none() }),
        succeeded(0),
      ),
      // The second video starts only now.
      Command.expectExact(InspectVideo({ index: 1, video: closet })),
      Command.resolve(
        InspectVideo({ index: 1, video: closet }),
        Message.FailedSend({
          index: 1,
          problem: 'videoTooLong',
          operationId: Option.none(),
          uploadId: Option.none(),
          prepared: Option.none(),
        }),
      ),
      model(({ items }) => expect(items[1]?.sending).toEqual(Sending.Failed({ problem: 'videoTooLong' }))),
    )
  })

  test('trying again repeats the same operation and upload, so the server makes one capture', () => {
    const retried = {
      ...photoArgs(0, tee),
      operationId: Option.some(OperationId.make('op-review-1')),
      uploadId: Option.some('up_1'),
    }
    story(
      update,
      given(init()),
      message(chosen(tee)),
      Command.resolve(
        SendPhoto(photoArgs(0, tee)),
        Message.FailedSend({
          index: 0,
          problem: 'network',
          operationId: Option.some(OperationId.make('op-review-1')),
          uploadId: Option.some('up_1'),
          prepared: Option.none(),
        }),
      ),
      message(Message.ClickedRetry({ index: 0 })),
      Command.expectExact(SendPhoto(retried)),
      Command.resolve(SendPhoto(retried), succeeded(0)),
      expectOutMessage({ _tag: 'FinishedSending' }),
      model(({ items }) => expect(items.map(({ uploadId }) => uploadId)).toEqual([Option.some('up_1')])),
    )
  })

  test('photos from the held-up camera go up as camera shots, and the tray waits for the camera to close', () => {
    const shot = file('camera-1.jpg', 'image/jpeg')
    const sent = SendPhoto({ ...photoArgs(0, shot), source: 'camera', side: Option.some('front') })
    story(
      update,
      given(init()),
      message(Message.ClickedHoldUp()),
      message(camera(CameraMessage.StartedCamera())),
      message(camera(CameraMessage.TappedPicture({ check: shot, still: shot }))),
      Command.expectHas(sent, Buzz),
      Command.resolve(Buzz, CameraMessage.CompletedBuzz()),
      Command.resolve(sent, succeeded(0)),
      // Sent while the camera is open: the page stays until the person is done.
      model(({ items }) =>
        expect(items.map(({ source, sending }) => [source, Sending.guards.Sent(sending)])).toEqual([['camera', true]]),
      ),
      message(camera(CameraMessage.ClickedDone())),
      expectOutMessage({ _tag: 'FinishedSending' }),
    )
  })

  test("a garment's back waits for its front to be sent, then goes with the capture it pairs with", () => {
    const front = file('camera-1.jpg', 'image/jpeg')
    const back = file('camera-2.jpg', 'image/jpeg')
    const shot = { ...photoArgs(0, front), source: 'camera' as const }
    const sendFront = SendPhoto({ ...shot, side: Option.some('front') })
    const sendBack = SendPhoto({
      ...shot,
      index: 1,
      photo: back,
      side: Option.some('back'),
      pairsWith: Option.some(captureOf(0)),
    })
    // The front is on its way when the back is taken.
    const opened = [Message.ClickedHoldUp(), camera(CameraMessage.StartedCamera())].reduce(
      (current, next) => update(current, next).model,
      init(),
    )
    const frontTaken = update(opened, camera(CameraMessage.TappedPicture({ check: front, still: front })))
    expect(frontTaken.commands?.find(({ name }) => name === 'SendPhoto')?.args).toEqual(sendFront.args)
    story(
      update,
      given(frontTaken.model),
      message(camera(CameraMessage.TappedPicture({ check: back, still: back }))),
      Command.expectExact(Buzz),
      Command.resolve(Buzz, CameraMessage.CompletedBuzz()),
      // Two could go at once, but the back waits for its front's capture.
      model(({ items }) =>
        expect(items.map(({ sending }) => [Sending.guards.Sending(sending), Sending.guards.Waiting(sending)])).toEqual([
          [true, false],
          [false, true],
        ]),
      ),
      message(succeeded(0)),
      Command.resolve(sendBack, succeeded(1)),
      model(({ items }) =>
        expect(items.map(({ captureId }) => captureId)).toEqual([0, 1].map((at) => Option.some(captureOf(at)))),
      ),
    )
  })
})

describe('a shop’s product page', () => {
  const url = 'https://shop.test/p/knit'
  const upload = `up_${'k'.repeat(22)}`
  const sent = (operationId: Option.Option<OperationId>, uploadId: Option.Option<string>) =>
    SendLink({ index: 0, url, operationId, uploadId })

  test('an empty address sends nothing', () => {
    story(
      update,
      given(init()),
      message(Message.ChangedLink({ url: '   ' })),
      message(Message.SubmittedLink()),
      model(({ links }) => expect(links).toEqual([])),
    )
  })

  test('tried again, it asks for the same capture from the picture already read, then hands over to the tray', () => {
    story(
      update,
      given(init()),
      message(Message.ChangedLink({ url: ` ${url} ` })),
      message(Message.SubmittedLink()),
      Command.resolve(
        sent(Option.none(), Option.none()),
        Message.FailedSendLink({
          index: 0,
          problem: 'network',
          operationId: Option.some(OperationId.make('op-link-0001')),
          uploadId: Option.some(upload),
        }),
      ),
      message(Message.ClickedRetryLink({ index: 0 })),
      Command.resolve(
        sent(Option.some(OperationId.make('op-link-0001')), Option.some(upload)),
        Message.SucceededSendLink({ index: 0, captureId: captureOf(1), name: Option.some('Navy cable knit') }),
      ),
      model(({ links }) => expect(links[0]?.name).toEqual(Option.some('Navy cable knit'))),
      expectOutMessage({ _tag: 'FinishedSending' }),
    )
  })
})
