import { Option } from 'effect'
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { Buzz, Camera, CheckHeld, init, Message, open, update } from '../src/page/HeldCamera.ts'

const shot = (name: string) => new globalThis.File(['jpeg'], name, { type: 'image/jpeg' })
const check = shot('check-1.jpg')
const still = shot('camera-1.jpg')

const watching = () => update(open(init()).model, Message.StartedCamera()).model
const firstCheck = CheckHeld({ token: 0, check, still, previous: Option.none() })

describe('the held-up camera', () => {
  test('a settled picture is checked, and a garment held up is taken with the side it shows', () => {
    story(
      update,
      given(watching()),
      message(Message.SettledScene({ check, still })),
      Command.expectExact(firstCheck),
      model(({ pendingCheck }) => expect(pendingCheck).toEqual(Option.some(0))),
      Command.resolve(firstCheck, Message.SucceededCheckHeld({ token: 0, check, still, held: true, side: 'front' })),
      expectOutMessage({ _tag: 'TookPhoto', photo: still, side: Option.some('front') }),
      Command.resolve(Buzz, Message.CompletedBuzz()),
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
      given({ ...watching(), pendingCheck: Option.some(3) }),
      message(Message.SettledScene({ check, still })),
      Command.expectNone(),
      model(({ shots }) => expect(shots).toBe(0)),
    )
  })

  test('an answer that arrives after Done, or after a tap, takes nothing and reopens nothing', () => {
    const checking = update(watching(), Message.SettledScene({ check, still })).model
    story(
      update,
      given(checking),
      message(Message.ClickedDone()),
      expectOutMessage({ _tag: 'ClosedCamera' }),
      message(Message.SucceededCheckHeld({ token: 0, check, still, held: false, side: 'unclear' })),
      model(({ camera }) => expect(Camera.guards.Closed(camera)).toBe(true)),
    )
    story(
      update,
      given(checking),
      message(Message.TappedPicture({ check, still })),
      expectOutMessage({ _tag: 'TookPhoto', photo: still, side: Option.none() }),
      Command.resolve(Buzz, Message.CompletedBuzz()),
      message(Message.SucceededCheckHeld({ token: 0, check, still, held: true, side: 'front' })),
      expectNoOutMessage(),
      model(({ shots }) => expect(shots).toBe(1)),
    )
  })

  test('held still after a no, the camera looks again; held still after a photo, it takes nothing more', () => {
    const second = CheckHeld({ token: 1, check, still, previous: Option.none() })
    story(
      update,
      given(watching()),
      message(Message.SettledScene({ check, still })),
      Command.resolve(firstCheck, Message.SucceededCheckHeld({ token: 0, check, still, held: false, side: 'unclear' })),
      model(({ camera }) => expect(camera).toEqual(Camera.Watching({ hint: 'notSeen' }))),
      message(Message.StayedStill({ check, still })),
      Command.resolve(second, Message.SucceededCheckHeld({ token: 1, check, still, held: true, side: 'front' })),
      expectOutMessage({ _tag: 'TookPhoto', photo: still, side: Option.some('front') }),
      Command.resolve(Buzz, Message.CompletedBuzz()),
      message(Message.StayedStill({ check, still })),
      Command.expectNone(),
      model(({ shots, pendingCheck }) => {
        expect(shots).toBe(1)
        expect(pendingCheck).toEqual(Option.none())
      }),
    )
  })

  test('nothing held up asks for one piece; without the check a tap still takes the photo', () => {
    const second = CheckHeld({ token: 1, check, still, previous: Option.none() })
    story(
      update,
      given(watching()),
      message(Message.SettledScene({ check, still })),
      Command.resolve(firstCheck, Message.SucceededCheckHeld({ token: 0, check, still, held: false, side: 'unclear' })),
      model(({ camera, shots }) => {
        expect(camera).toEqual(Camera.Watching({ hint: 'notSeen' }))
        expect(shots).toBe(0)
      }),
      message(Message.SettledScene({ check, still })),
      Command.resolve(second, Message.FailedCheckHeld({ token: 1 })),
      model(({ camera }) => expect(camera).toEqual(Camera.Watching({ hint: 'tapToTake' }))),
      message(Message.TappedPicture({ check, still })),
      expectOutMessage({ _tag: 'TookPhoto', photo: still, side: Option.none() }),
      Command.resolve(Buzz, Message.CompletedBuzz()),
    )
  })

  test('a refused camera says so, and closing hands the page back', () => {
    story(
      update,
      given(open(init()).model),
      message(Message.FailedCamera({ reason: 'denied' })),
      model(({ camera }) => expect(camera).toEqual(Camera.Failed({ reason: 'denied' }))),
      message(Message.ClickedDone()),
      expectOutMessage({ _tag: 'ClosedCamera' }),
      model(({ camera }) => expect(Camera.guards.Closed(camera)).toBe(true)),
    )
  })
})
