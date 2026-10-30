import { catalogVersion } from '@styld/i18n'
import { CaptureId } from '@styld/protocol'
import { expect, given, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Session, init } from '../src/App.ts'
import { Tray } from '../src/page/Review.ts'
import { view } from '../src/View.ts'

const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }

const emptyCapture = (n: number, source: 'picker' | 'video') => ({
  id: CaptureId.make(`cp_${String(n).padStart(22, '0')}`),
  source,
  status: 'review' as const,
  detections: [],
  createdAt: '2026-10-30T12:00:00.000Z',
})

const reviewPage = modifyFields(
  init({
    locale: 'en',
    catalogVersion,
    timeZone: 'UTC',
    referenceTime: 0,
    pathname: '/wardrobe/review',
    origin: 'https://styld.test',
    telemetryConsent: 'denied',
  }).model,
  {
    session: () => Session.SignedIn({ claims }),
    review: (review) =>
      modifyFields(review, {
        tray: () =>
          Tray.Loaded({
            tray: {
              captures: [emptyCapture(1, 'video'), emptyCapture(2, 'picker')],
              allowance: { remaining: 90, daily: 100 },
            },
          }),
      }),
  },
)

describe('the review tray', () => {
  test('a video part with nothing whole in it says how to film; an empty photo says nothing was found', () => {
    scene(
      { update: (model) => ({ model }), view },
      given(reviewPage),
      expect(
        text(
          'No whole garment in this part of the video. Film from about a metre away and move slowly, so each piece fits in the frame.',
        ),
      ).toExist(),
      expect(text('No clothes found here.')).toExist(),
    )
  })
})
