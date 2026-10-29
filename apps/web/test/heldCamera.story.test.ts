import { Option } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { Buzz, Camera, CheckHeld, init, Message, update } from '../src/page/HeldCamera.ts'

const shot = (name: string) => new globalThis.File(['jpeg'], name, { type: 'image/jpeg' })
const check = shot('check-1.jpg')
const still = shot('camera-1.jpg')

const watching = () =>
  [update(init(), Message.ClickedOpen()).model].map((opened) => update(opened, Message.StartedCamera()).model)[0] ??
  init()

describe('the held-up camera', () => {
  test('a settled picture is checked, and a garment held up is taken with the side it shows', () => {
    story(
      update,
      given(watching()),
      message(Message.SettledScene({ check, still })),
      Command.expectExact(CheckHeld({ check, still, previous: Option.none() })),
      model(({ checking }) => expect(checking).toBe(true)),
      Command.resolve(
        CheckHeld({ check, still, previous: Option.none() }),
        Message.CheckedHeld({ check, still, held: true, side: 'front' }),
      ),
      expectOutMessage({ _tag: 'TookPhoto', photo: still, side: Option.some('front') }),
      Command.resolve(Buzz, Message.Buzzed()),
      model(({ shots, lastCheck, camera }) => {
        expect(shots).toBe(1)
        expect(lastCheck).toEqual(Option.some(check))
        expect(camera).toEqual(Camera.Watching({ hint: 'taken' }))
      }),
    )
  })

  test('a picture that settles while a check is out is let go', () => {
    story(
      update,
      given({ ...watching(), checking: true }),
      message(Message.SettledScene({ check, still })),
      Command.expectNone(),
      model(({ shots }) => expect(shots).toBe(0)),
    )
  })

  test('nothing held up asks for one piece; without the check a tap still takes the photo', () => {
    story(
      update,
      given(watching()),
      message(Message.SettledScene({ check, still })),
      Command.resolve(
        CheckHeld({ check, still, previous: Option.none() }),
        Message.CheckedHeld({ check, still, held: false, side: 'unclear' }),
      ),
      model(({ camera, shots }) => {
        expect(camera).toEqual(Camera.Watching({ hint: 'holdOne' }))
        expect(shots).toBe(0)
      }),
      message(Message.SettledScene({ check, still })),
      Command.resolve(CheckHeld({ check, still, previous: Option.none() }), Message.FailedCheck()),
      model(({ camera }) => expect(camera).toEqual(Camera.Watching({ hint: 'tapToTake' }))),
      message(Message.TappedPicture({ check, still })),
      expectOutMessage({ _tag: 'TookPhoto', photo: still, side: Option.none() }),
      Command.resolve(Buzz, Message.Buzzed()),
    )
  })

  test('a refused camera says so, and closing hands the page back', () => {
    story(
      update,
      given(update(init(), Message.ClickedOpen()).model),
      message(Message.FailedCamera({ reason: 'denied' })),
      model(({ camera }) => expect(camera).toEqual(Camera.Failed({ reason: 'denied' }))),
      message(Message.ClickedDone()),
      expectOutMessage({ _tag: 'ClosedCamera' }),
      model(({ camera }) => expect(Camera.guards.Closed(camera)).toBe(true)),
    )
  })
})
