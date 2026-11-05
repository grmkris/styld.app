import { Command, expect, given, Mount, scene, Subscription, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Message as AppMessage, update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import { Message as AddMessage } from '../src/page/AddPieces/Message.ts'
import * as Camera from '../src/page/HeldCamera.ts'
import { view } from '../src/View.ts'
import { at, withPage } from './AppFixtures.ts'

const check = new globalThis.File(['check'], 'check.jpg', { type: 'image/jpeg' })
const still = new globalThis.File(['before count'], 'before.jpg', { type: 'image/jpeg' })
const camera = (message: Camera.Message) =>
  Subscription.emit(AppMessage.GotAddPiecesMessage({ message: AddMessage.GotHeldCameraMessage({ message }) }))
const watching = () =>
  withPage(at('/wardrobe/add', { signedIn: true }), lenses.addPieces, (page) =>
    modifyFields(page, {
      held: () => Camera.update(Camera.open(Camera.init()).model, Camera.Message.StartedCamera()).model,
    }),
  )
const settled = Camera.Message.SettledScene({ check, still })
const answer = Camera.Message.SucceededCheckHeld({
  token: 0,
  check,
  still,
  held: true,
  side: 'front',
  samePrevious: false,
  holding: true,
})

/** The screen's dialog is resolved here because a real camera screen holds the page as modal. */
const mounts = Mount.resolveAll([Camera.HoldScreen, Camera.Message.HeldScreen()])

describe('the visible camera countdown', () => {
  test('shows 3, 2, 1 after garment checking, then requests a live frame', () => {
    scene(
      { update, view },
      given(watching()),
      mounts,
      camera(settled),
      Command.resolve(Camera.CheckHeld, answer),
      expect(text('3')).toExist(),
      Command.resolve(Camera.WaitForCountdown, Camera.Message.ElapsedCountdown({ token: 0, count: 3 })),
      expect(text('2')).toExist(),
      expect(text('3')).not.toExist(),
      Command.resolve(Camera.WaitForCountdown, Camera.Message.ElapsedCountdown({ token: 0, count: 2 })),
      expect(text('1')).toExist(),
      Command.resolve(Camera.WaitForCountdown, Camera.Message.ElapsedCountdown({ token: 0, count: 1 })),
      Command.resolve(Camera.TakeCountdownPhoto, Camera.Message.MissedPhoto()),
      expect(text('1')).not.toExist(),
    )
  })
})
