import { catalogVersion } from '@styld/i18n'
import { Option } from 'effect'
import { Command, changeFiles, expect, given, scene, selector, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Session, init, update } from '../src/App.ts'
import { InspectVideo, SendVideoPart } from '../src/page/AddPieces/Commands.ts'
import { Message, type VideoPlan } from '../src/page/AddPieces/Message.ts'
import { view } from '../src/View.ts'

const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }

const addPage = modifyFields(
  init({
    locale: 'en',
    catalogVersion,
    timeZone: 'UTC',
    referenceTime: 0,
    pathname: '/wardrobe/add',
    origin: 'https://styld.test',
    telemetryConsent: 'denied',
  }).model,
  { session: () => Session.SignedIn({ claims }) },
)

const rail = new globalThis.File([new Uint8Array(8)], 'rail.mov', { type: 'video/quicktime' })

const twoParts: VideoPlan = {
  route: 'parts',
  durationMs: 60_000,
  parts: [
    { index: 0, startMs: 0, endMs: 30_000 },
    { index: 1, startMs: 30_000, endMs: 60_000 },
  ],
}

describe('reading a video on the add page', () => {
  test("says which part is on its way, and how many went once the day's allowance stops it", () => {
    scene(
      { update, view },
      given(addPage),
      changeFiles(selector('input[type="file"]'), [rail]),
      Command.resolve(InspectVideo, Message.SucceededInspectVideo({ index: 0, plan: twoParts })),
      expect(text('Reading the video, part 1 of 2')).toExist(),
      Command.resolve(SendVideoPart, Message.SucceededSendVideoPart({ index: 0, part: 0 })),
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
      expect(text("Today's free allowance covered 1 of 2 parts. Send the rest tomorrow.")).toExist(),
    )
  })
})
