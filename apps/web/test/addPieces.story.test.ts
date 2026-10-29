import { FileDrop } from '@foldkit/ui'
import type { CaptureSource } from '@styld/protocol'
import { Option } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { classify, Message, SendPhoto, SendVideo, Sending, init, update } from '../src/page/AddPieces.ts'
import { Buzz, Message as CameraMessage, type Message as HeldCameraMessage } from '../src/page/HeldCamera.ts'

const file = (name: string, type: string, bytes = 8) => new globalThis.File([new Uint8Array(bytes)], name, { type })
const tee = file('tee.jpg', 'image/jpeg')
const jeans = file('jeans.png', 'image/png')
const coat = file('coat.webp', 'image/webp')
const rail = file('rail.mov', 'video/quicktime')

const chosen = (first: File, ...rest: ReadonlyArray<File>) =>
  Message.GotDropMessage({ message: FileDrop.Message.DroppedFiles({ files: [first, ...rest] }) })

/** A message from the held-up camera, as the page receives it. */
const camera = (sent: HeldCameraMessage) => Message.GotHeldCameraMessage({ message: sent })

/** Where a photo came from; a camera shot overrides it. */
const picker: CaptureSource = 'picker'

const photoArgs = (index: number, photo: File, contentType: 'image/jpeg' | 'image/png' | 'image/webp') => ({
  index,
  photo,
  contentType,
  source: picker,
  side: Option.none(),
  operationId: Option.none(),
  uploadId: Option.none(),
})

describe('choosing files to add', () => {
  test('photos and videos are taken by type and size; anything else is named and left out', () => {
    expect(classify(tee)).toEqual({ kind: 'photo' })
    expect(classify(rail)).toEqual({ kind: 'video' })
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

  test('two files go up at once and the next starts as one finishes; the tray opens when all are sent', () => {
    story(
      update,
      given(init()),
      message(chosen(tee, jeans, coat)),
      Command.expectExact(SendPhoto(photoArgs(0, tee, 'image/jpeg')), SendPhoto(photoArgs(1, jeans, 'image/png'))),
      model(({ items }) =>
        expect(items.map(({ sending }) => Sending.guards.Sending(sending))).toEqual([true, true, false]),
      ),
      Command.resolve(SendPhoto(photoArgs(0, tee, 'image/jpeg')), Message.SucceededSend({ index: 0 })),
      Command.expectHas(SendPhoto(photoArgs(2, coat, 'image/webp'))),
      Command.resolve(SendPhoto(photoArgs(1, jeans, 'image/png')), Message.SucceededSend({ index: 1 })),
      Command.resolve(SendPhoto(photoArgs(2, coat, 'image/webp')), Message.SucceededSend({ index: 2 })),
      expectOutMessage({ _tag: 'FinishedSending' }),
    )
  })

  test('a video is sampled and sent as one capture, and the camera marks its photos as camera shots', () => {
    story(
      update,
      given(init()),
      message(chosen(rail)),
      Command.expectExact(
        SendVideo({ index: 0, video: rail, contentType: 'video/quicktime', prepared: Option.none() }),
      ),
      Command.resolve(
        SendVideo({ index: 0, video: rail, contentType: 'video/quicktime', prepared: Option.none() }),
        Message.FailedSend({
          index: 0,
          problem: 'videoTooLong',
          operationId: Option.none(),
          uploadId: Option.none(),
          prepared: Option.none(),
        }),
      ),
      model(({ items }) => expect(items[0]?.sending).toEqual(Sending.Failed({ problem: 'videoTooLong' }))),
      message(Message.GotCameraMessage({ message: FileDrop.Message.DroppedFiles({ files: [tee] }) })),
      Command.expectExact(SendPhoto({ ...photoArgs(1, tee, 'image/jpeg'), source: 'camera' })),
      Command.resolve(
        SendPhoto({ ...photoArgs(1, tee, 'image/jpeg'), source: 'camera' }),
        Message.SucceededSend({ index: 1 }),
      ),
      // One file failed, so the page stays and offers the tray for what did go up.
      Command.expectNone(),
    )
  })

  test('trying again repeats the same operation and upload, so the server makes one capture', () => {
    const retried = {
      ...photoArgs(0, tee, 'image/jpeg'),
      operationId: Option.some('op-1'),
      uploadId: Option.some('up_1'),
    }
    story(
      update,
      given(init()),
      message(chosen(tee)),
      Command.resolve(
        SendPhoto(photoArgs(0, tee, 'image/jpeg')),
        Message.FailedSend({
          index: 0,
          problem: 'network',
          operationId: Option.some('op-1'),
          uploadId: Option.some('up_1'),
          prepared: Option.none(),
        }),
      ),
      message(Message.ClickedRetry({ index: 0 })),
      Command.expectExact(SendPhoto(retried)),
      Command.resolve(SendPhoto(retried), Message.SucceededSend({ index: 0 })),
      expectOutMessage({ _tag: 'FinishedSending' }),
      model(({ items }) => expect(items.map(({ uploadId }) => uploadId)).toEqual([Option.some('up_1')])),
    )
  })

  test('photos from the held-up camera go up as camera shots, and the tray waits for the camera to close', () => {
    const shot = file('camera-1.jpg', 'image/jpeg')
    const sent = SendPhoto({ ...photoArgs(0, shot, 'image/jpeg'), source: 'camera' })
    story(
      update,
      given(init()),
      message(Message.ClickedHoldUp()),
      message(camera(CameraMessage.StartedCamera())),
      message(camera(CameraMessage.TappedPicture({ check: shot, still: shot }))),
      Command.expectHas(sent, Buzz),
      Command.resolve(Buzz, CameraMessage.CompletedBuzz()),
      Command.resolve(sent, Message.SucceededSend({ index: 0 })),
      // Sent while the camera is open: the page stays until the person is done.
      model(({ items }) =>
        expect(items.map(({ source, sending }) => [source, Sending.guards.Sent(sending)])).toEqual([['camera', true]]),
      ),
      message(camera(CameraMessage.ClickedDone())),
      expectOutMessage({ _tag: 'FinishedSending' }),
    )
  })
})
