import { catalogVersion } from '@styld/i18n'
import { CaptureId, DetectionId, PieceId, type TrayCapture } from '@styld/protocol'
import { Option } from 'effect'
import { expect, given, role, scene, text } from 'foldkit/scene'
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

const appModel = () =>
  init({
    locale: 'en',
    catalogVersion,
    timeZone: 'UTC',
    referenceTime: 0,
    pathname: '/wardrobe/review',
    origin: 'https://styld.test',
    telemetryConsent: 'denied',
  }).model

/** The tray page signed in, showing `captures`, with `editing` open. */
const reviewPage = (captures: ReadonlyArray<TrayCapture>, editing = Option.none<string>()) =>
  modifyFields(appModel(), {
    session: () => Session.SignedIn({ claims }),
    review: (review) =>
      modifyFields(review, {
        tray: () => Tray.Loaded({ tray: { captures, allowance: { remaining: 90, daily: 100 } } }),
        editing: () => editing,
        decisions: () =>
          Object.fromEntries(
            captures.flatMap(({ detections }) =>
              detections.map((detection) => [
                detection.id,
                {
                  keep: detection.preselected,
                  category: Option.fromNullishOr(detection.suggestion.category),
                  subcategory: Option.none(),
                  colours: detection.suggestion.colours,
                  name: '',
                  useOriginal: false,
                },
              ]),
            ),
          ),
      }),
  })

/** A shirt the wardrobe already has, found again in a photo. */
const foundAgain = {
  ...emptyCapture(3, 'picker'),
  detections: [
    {
      id: DetectionId.make(`dt_${'1'.padStart(22, '0')}`),
      preselected: false,
      hasCutout: true,
      hasBack: false,
      sightings: 1,
      alreadyHave: PieceId.make(`pc_${'s'.repeat(22)}`),
      suggestion: { category: 'top' as const, subcategory: null, colours: ['navy' as const] },
    },
  ],
}

describe('the review tray', () => {
  test('a video part with nothing whole in it says how to film; an empty photo says nothing was found', () => {
    scene(
      { update: (model) => ({ model }), view },
      given(reviewPage([emptyCapture(1, 'video'), emptyCapture(2, 'picker')])),
      expect(
        text(
          'No whole garment in this part of the video. Film from about a metre away and move slowly, so each piece fits in the frame.',
        ),
      ).toExist(),
      expect(text('No clothes found here.')).toExist(),
    )
  })

  test('a garment the wardrobe already has asks so, unticked, and opens beside the piece it was taken for', () => {
    scene(
      { update: (model) => ({ model }), view },
      given(reviewPage([foundAgain])),
      expect(text('Already in your wardrobe?')).toExist(),
      expect(role('button', { name: 'Keep Tops' })).toHaveAttr('aria-pressed', 'false'),
    )
    scene(
      { update: (model) => ({ model }), view },
      given(reviewPage([foundAgain], Option.some(`dt_${'1'.padStart(22, '0')}`))),
      expect(text('It looks like this piece you have. Tick it to keep both.')).toExist(),
      expect(role('img', { name: 'The piece you have' })).toExist(),
    )
  })
})
