import { Option } from 'effect'
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { Buzz, Camera, CheckHeld, init, Message, type Model, open, update } from '../src/page/HeldCamera.ts'

const shot = (name: string) => new globalThis.File(['jpeg'], name, { type: 'image/jpeg' })
const check = shot('check-1.jpg')
const still = shot('camera-1.jpg')

const watching = () => update(open(init()).model, Message.StartedCamera()).model
const firstCheck = CheckHeld({ token: 0, check, still, previous: Option.none() })

/** The garment check's answer to check `token`. */
const answered = (token: number, held: boolean, side: 'front' | 'back' | 'unclear', samePrevious = false) =>
  Message.SucceededCheckHeld({ token, check, still, held, side, samePrevious })

/** A front just taken: the camera waits for the garment's back. */
const frontTaken = (): Model => {
  const checking = update(watching(), Message.SettledScene({ check, still })).model
  return update(checking, answered(0, true, 'front')).model
}

/** The next settled picture, its check against the front, and the check's answer. */
const turned = (token: number, side: 'front' | 'back' | 'unclear', samePrevious: boolean) => {
  const sent = CheckHeld({ token, check, still, previous: Option.some(check) })
  return [
    message(Message.SettledScene({ check, still })),
    Command.resolve(sent, answered(token, true, side, samePrevious)),
  ] as const
}

describe('the held-up camera', () => {
  test('a settled picture is checked, and a garment held up is taken as a front that asks for its back', () => {
    story(
      update,
      given(watching()),
      message(Message.SettledScene({ check, still })),
      Command.expectExact(firstCheck),
      model(({ pendingCheck }) => expect(pendingCheck).toEqual(Option.some(0))),
      Command.resolve(firstCheck, answered(0, true, 'front')),
      expectOutMessage({ _tag: 'TookPhoto', photo: still, side: 'front' }),
      Command.resolve(Buzz, Message.CompletedBuzz()),
      model(({ pieces, lastCheck, camera }) => {
        expect(pieces).toBe(1)
        expect(lastCheck).toEqual(Option.some(check))
        expect(camera).toEqual(Camera.Watching({ hint: 'showBack' }))
      }),
    )
  })

  test('a picture that settles while a check is out is let go', () => {
    story(
      update,
      given({ ...watching(), pendingCheck: Option.some(3) }),
      message(Message.SettledScene({ check, still })),
      Command.expectNone(),
      model(({ pieces }) => expect(pieces).toBe(0)),
    )
  })

  test('an answer that arrives after Done, or after a tap, takes nothing and reopens nothing', () => {
    const checking = update(watching(), Message.SettledScene({ check, still })).model
    story(
      update,
      given(checking),
      message(Message.ClickedDone()),
      expectOutMessage({ _tag: 'ClosedCamera' }),
      message(answered(0, false, 'unclear')),
      model(({ camera }) => expect(Camera.guards.Closed(camera)).toBe(true)),
    )
    story(
      update,
      given(checking),
      message(Message.TappedPicture({ check, still })),
      expectOutMessage({ _tag: 'TookPhoto', photo: still, side: 'front' }),
      Command.resolve(Buzz, Message.CompletedBuzz()),
      message(answered(0, true, 'front')),
      expectNoOutMessage(),
      model(({ pieces }) => expect(pieces).toBe(1)),
    )
  })

  test('held still after a no, the camera looks again; held still after a photo, it takes nothing more', () => {
    const second = CheckHeld({ token: 1, check, still, previous: Option.none() })
    story(
      update,
      given(watching()),
      message(Message.SettledScene({ check, still })),
      Command.resolve(firstCheck, answered(0, false, 'unclear')),
      model(({ camera }) => expect(camera).toEqual(Camera.Watching({ hint: 'notSeen' }))),
      message(Message.StayedStill({ check, still })),
      Command.resolve(second, answered(1, true, 'front')),
      expectOutMessage({ _tag: 'TookPhoto', photo: still, side: 'front' }),
      Command.resolve(Buzz, Message.CompletedBuzz()),
      message(Message.StayedStill({ check, still })),
      Command.expectNone(),
      model(({ pieces, pendingCheck }) => {
        expect(pieces).toBe(1)
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
      Command.resolve(firstCheck, answered(0, false, 'unclear')),
      model(({ camera, pieces }) => {
        expect(camera).toEqual(Camera.Watching({ hint: 'notSeen' }))
        expect(pieces).toBe(0)
      }),
      message(Message.SettledScene({ check, still })),
      Command.resolve(second, Message.FailedCheckHeld({ token: 1 })),
      model(({ camera }) => expect(camera).toEqual(Camera.Watching({ hint: 'tapToTake' }))),
      message(Message.TappedPicture({ check, still })),
      expectOutMessage({ _tag: 'TookPhoto', photo: still, side: 'front' }),
      Command.resolve(Buzz, Message.CompletedBuzz()),
    )
  })

  test('turned around, the garment is taken as its back; the front still held up is not taken twice', () => {
    story(
      update,
      given(frontTaken()),
      ...turned(1, 'front', true),
      expectNoOutMessage(),
      model(({ camera, step, pendingCheck }) => {
        expect(camera).toEqual(Camera.Watching({ hint: 'showBack' }))
        expect(step).toBe('back')
        expect(pendingCheck).toEqual(Option.none())
      }),
      // Held still, the front is not looked at again: only turning it moves the picture.
      message(Message.StayedStill({ check, still })),
      Command.expectNone(),
      ...turned(2, 'unclear', true),
      expectOutMessage({ _tag: 'TookPhoto', photo: still, side: 'back' }),
      Command.resolve(Buzz, Message.CompletedBuzz()),
      model(({ camera, step, pieces }) => {
        expect(camera).toEqual(Camera.Watching({ hint: 'taken' }))
        expect(step).toBe('front')
        expect(pieces).toBe(1)
      }),
    )
  })

  test("another garment's front starts a new piece; the back can be skipped, by hand or with a tap", () => {
    story(
      update,
      given(frontTaken()),
      ...turned(1, 'front', false),
      expectOutMessage({ _tag: 'TookPhoto', photo: still, side: 'front' }),
      Command.resolve(Buzz, Message.CompletedBuzz()),
      model(({ step, pieces }) => {
        expect(step).toBe('back')
        expect(pieces).toBe(2)
      }),
      message(Message.ClickedSkipBack()),
      model(({ camera, step }) => {
        expect(camera).toEqual(Camera.Watching({ hint: 'taken' }))
        expect(step).toBe('front')
      }),
      message(Message.TappedPicture({ check, still })),
      expectOutMessage({ _tag: 'TookPhoto', photo: still, side: 'front' }),
      Command.resolve(Buzz, Message.CompletedBuzz()),
      message(Message.TappedPicture({ check, still })),
      expectOutMessage({ _tag: 'TookPhoto', photo: still, side: 'back' }),
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
