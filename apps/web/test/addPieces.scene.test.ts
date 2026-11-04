import { CaptureId, OperationId } from '@styld/protocol'
import { Option } from 'effect'
import { Command, changeFiles, click, expect, given, role, scene, selector, submit, text, type } from 'foldkit/scene'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { at, withPage } from './AppFixtures.ts'
import { lenses } from '../src/Page.ts'
import { modifyFields } from 'foldkit/struct'
import { Message as AppMessage } from '../src/Message.ts'
import { Navigate } from '../src/Navigation.ts'
import { InspectVideo, SendLink, SendPhoto, SendVideoPart } from '../src/page/AddPieces/Commands.ts'
import { Message, type VideoPlan } from '../src/page/AddPieces/Message.ts'
import { view } from '../src/View.ts'

const addPage = at('/wardrobe/add', { signedIn: true })

const rail = new globalThis.File([new Uint8Array(8)], 'rail.mov', { type: 'video/quicktime' })

const twoParts: VideoPlan = {
  route: 'parts',
  durationMs: 60_000,
  parts: [
    { index: 0, startMs: 0, endMs: 30_000 },
    { index: 1, startMs: 30_000, endMs: 60_000 },
  ],
}

describe('what adding costs', () => {
  test('the ways in say what a photo and a video cost, and how many credits are left once read', () => {
    scene({ update, view }, given(addPage), expect(text('1 credit a photo · 5 for 30 s of video')).toExist())
    scene(
      { update, view },
      given(
        withPage(addPage, lenses.addPieces, (page) =>
          modifyFields(page, { maybeAllowance: () => Option.some({ remaining: 42, daily: 100 }) }),
        ),
      ),
      expect(text('1 credit a photo · 5 for 30 s of video · 42 left today')).toExist(),
    )
  })
})

describe('reading a video on the add page', () => {
  test("says which part is on its way, and how many went once the day's allowance stops it", () => {
    scene(
      { update, view },
      given(addPage),
      changeFiles(selector('input[type="file"]'), [rail]),
      Command.resolve(InspectVideo, Message.SucceededInspectVideo({ index: 0, plan: twoParts })),
      expect(text('Reading the video, part 1 of 2')).toExist(),
      Command.resolve(
        SendVideoPart,
        Message.SucceededSendVideoPart({ index: 0, part: 0, captureId: CaptureId.make(`cp_${'r'.repeat(22)}`) }),
      ),
      expect(text('Reading the video, part 2 of 2')).toExist(),
      Command.resolve(
        SendVideoPart,
        Message.FailedSend({
          index: 0,
          problem: 'dailyLimit',
          operationId: Option.none(),
          uploadId: Option.none(),
          prepared: Option.none(),
        }),
      ),
      expect(text("Today's credits covered 1 of 2 parts. Send the rest tomorrow.")).toExist(),
    )
  })
})

describe('adding from a shop’s page', () => {
  const address = 'https://shop.test/products/navy-knit?colour=navy'
  const field = role('textbox', { name: 'From a shop’s page' })
  const added = [type(field, address), submit(selector('#link'))] as const

  test('reads the page and names the row by its address, then says when the shop keeps Styld out', () => {
    scene(
      { update, view },
      given(addPage),
      ...added,
      expect(field).toHaveValue(''),
      expect(text('shop.test/products/navy-knit')).toExist(),
      expect(text('Reading the page…')).toExist(),
      Command.resolve(
        SendLink,
        Message.FailedSendLink({ index: 0, problem: 'blocked', operationId: Option.none(), uploadId: Option.none() }),
      ),
      expect(text('This shop doesn’t let Styld read its pages. Send a photo or a screenshot instead.')).toExist(),
      expect(role('button', { name: 'Try shop.test/products/navy-knit again' })).toBeAbsent(),
    )
  })

  test('a page out of reach can be tried again, and the row takes the name the page gives', () => {
    scene(
      { update, view },
      given(addPage),
      ...added,
      Command.resolve(
        SendLink,
        Message.FailedSendLink({
          index: 0,
          problem: 'network',
          operationId: Option.some(OperationId.make('op-link-0001')),
          uploadId: Option.none(),
        }),
      ),
      click(role('button', { name: 'Try shop.test/products/navy-knit again' })),
      expect(text('Reading the page…')).toExist(),
      Command.resolve(
        SendLink,
        Message.SucceededSendLink({
          index: 0,
          captureId: CaptureId.make(`cp_${'k'.repeat(22)}`),
          name: Option.some('Navy cable knit'),
        }),
      ),
      // Everything chosen went: the review tray takes over.
      Command.expectExact(Navigate({ href: '/wardrobe/review' })),
      Command.resolve(Navigate({ href: '/wardrobe/review' }), AppMessage.CompletedNavigate()),
    )
  })
})

describe('a refused upload on the add page', () => {
  test('says uploads are waiting, in words of their own, not that credits are spent', () => {
    const tee = new globalThis.File([new Uint8Array(8)], 'tee.jpg', { type: 'image/jpeg' })
    scene(
      { update, view },
      given(addPage),
      changeFiles(selector('input[type="file"]'), [tee]),
      Command.resolve(
        SendPhoto,
        Message.FailedSend({
          index: 0,
          problem: 'uploadsWaiting',
          operationId: Option.none(),
          uploadId: Option.none(),
          prepared: Option.none(),
        }),
      ),
      expect(
        text('Too many of your uploads are still waiting. Add them to your wardrobe first, or try again tomorrow.'),
      ).toExist(),
    )
  })
})
