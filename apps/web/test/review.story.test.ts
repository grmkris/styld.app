import { CaptureId, DetectionId, type Tray as TrayContract } from '@styld/protocol'
import { Option } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import {
  DrawOperationId,
  keptOf,
  LoadTray,
  Message,
  RefreshTray,
  RemoveCapture,
  RetryCapture,
  SplitSightings,
  Saving,
  SendReview,
  init,
  update,
} from '../src/page/Review.ts'

const id = (prefix: 'cp' | 'dt', n: number) => `${prefix}_${String(n).padStart(22, '0')}`
const detection = (n: number, type: 'tops' | 'jeans' | null, preselected = true, sightings = 1) => ({
  id: DetectionId.make(id('dt', n)),
  preselected,
  hasCutout: true,
  hasBack: false,
  partial: false,
  sightings,
  suggestion: {
    type,
    colours: type === null ? [] : (['navy'] as const),
    season: null,
    occasions: [],
    pattern: null,
  },
})

const tray = (
  captures: ReadonlyArray<{ status: 'processing' | 'review'; detections: ReadonlyArray<ReturnType<typeof detection>> }>,
): TrayContract => ({
  captures: captures.map((capture, n) => ({
    id: CaptureId.make(id('cp', n)),
    source: 'picker',
    status: capture.status,
    detections: capture.detections,
    createdAt: '2026-10-29T12:00:00.000Z',
  })),
  allowance: { remaining: 97, daily: 100 },
})

const found = tray([
  { status: 'review', detections: [detection(1, 'tops'), detection(2, 'jeans'), detection(3, null)] },
])

describe('the review tray', () => {
  test('asks again while a capture is still being cut out', () => {
    story(
      update,
      given(init()),
      message(Message.SucceededLoadTray({ tray: tray([{ status: 'processing', detections: [] }]) })),
      Command.expectExact(RefreshTray),
      Command.resolve(RefreshTray, Message.SucceededRefreshTray({ tray: found })),
      Command.expectNone(),
      model((current) => expect(keptOf(current)).toHaveLength(2)),
    )
  })

  test('offers suggested pieces ticked, and a piece without a type opens to say what it is', () => {
    story(
      update,
      given(init()),
      message(Message.SucceededLoadTray({ tray: found })),
      model((current) => expect(keptOf(current).map(({ id: kept }) => kept)).toEqual([id('dt', 1), id('dt', 2)])),
      message(Message.ToggledKeep({ detectionId: id('dt', 3) })),
      model(({ editing }) => expect(editing).toEqual(Option.some(id('dt', 3)))),
      message(Message.ChoseType({ type: 'flats' })),
      message(Message.UpdatedName({ value: ' Loafers ' })),
      message(Message.ClickedDoneEditing()),
      model((current) => {
        expect(current.editing).toEqual(Option.none())
        expect(keptOf(current)).toHaveLength(3)
      }),
    )
  })

  test('adds the ticked pieces and drops the rest in one request, repeated as is after a lost answer', () => {
    const sent = SendReview({
      operationId: 'op-1',
      keep: [
        {
          detectionId: id('dt', 1),
          type: 'tops',
          details: {
            type: Option.some('tops'),
            colours: ['navy'],
            season: Option.none(),
            occasions: [],
            pattern: Option.none(),
          },
          name: Option.none(),
          useOriginal: false,
        },
      ],
      discard: [id('dt', 2), id('dt', 3)],
    })
    story(
      update,
      given(init()),
      message(Message.SucceededLoadTray({ tray: found })),
      message(Message.ToggledKeep({ detectionId: id('dt', 2) })),
      message(Message.ClickedAdd()),
      Command.resolve(DrawOperationId, Message.CompletedDrawOperationId({ operationId: 'op-1' })),
      Command.expectExact(sent),
      Command.resolve(sent, Message.FailedReview({ retry: 'same' })),
      message(Message.ClickedAdd()),
      Command.expectExact(sent),
      Command.resolve(sent, Message.SucceededReview({ count: 1 })),
      expectOutMessage({ _tag: 'AddedPieces', count: 1 }),
      model(({ saving }) => expect(Saving.guards.Idle(saving)).toBe(true)),
    )
  })

  test('polls one refresh at a time, and keeps polling after a refresh fails', () => {
    const processing = tray([{ status: 'processing', detections: [] }])
    // A read of the tray while a refresh is already out does not start another.
    story(
      update,
      given({ ...init(), refreshing: true }),
      message(Message.SucceededLoadTray({ tray: processing })),
      Command.expectNone(),
      model(({ refreshing }) => expect(refreshing).toBe(true)),
    )
    story(
      update,
      given(init()),
      message(Message.SucceededLoadTray({ tray: processing })),
      Command.resolve(RefreshTray, Message.FailedRefreshTray()),
      model(({ stale }) => expect(stale).toBe(true)),
      Command.expectExact(RefreshTray),
      Command.resolve(RefreshTray, Message.SucceededRefreshTray({ tray: found })),
      model(({ stale, refreshing }) => {
        expect(stale).toBe(false)
        expect(refreshing).toBe(false)
      }),
    )
  })

  test('a failed try or removal says so on its capture, and the tray is read again after a success', () => {
    const failed = { ...tray([{ status: 'review', detections: [] }]) }
    const captureId = id('cp', 0)
    story(
      update,
      given(init()),
      message(Message.SucceededLoadTray({ tray: failed })),
      message(Message.ClickedRetryCapture({ captureId })),
      model(({ acting }) => expect(acting).toEqual([captureId])),
      Command.resolve(RetryCapture({ captureId }), Message.FailedCaptureAction({ captureId })),
      model(({ acting, actionFailed }) => {
        expect(acting).toEqual([])
        expect(actionFailed).toEqual([captureId])
      }),
      message(Message.ClickedRemoveCapture({ captureId })),
      Command.resolve(RemoveCapture({ captureId }), Message.SucceededCaptureAction({ captureId })),
      Command.resolve(LoadTray, Message.SucceededLoadTray({ tray: tray([]) })),
      model(({ acting, actionFailed }) => {
        expect(acting).toEqual([])
        expect(actionFailed).toEqual([])
      }),
    )
  })

  test('a piece seen in several files splits back into its sightings, which the tray reads again', () => {
    const seenTwice = tray([{ status: 'review', detections: [detection(1, 'tops', true, 2)] }])
    const apart = tray([{ status: 'review', detections: [detection(1, 'tops'), detection(2, 'tops')] }])
    const detectionId = id('dt', 1)
    story(
      update,
      given(init()),
      message(Message.SucceededLoadTray({ tray: seenTwice })),
      message(Message.ClickedEdit({ detectionId })),
      message(Message.ClickedSplit({ detectionId })),
      model(({ editing, acting }) => {
        expect(editing).toEqual(Option.none())
        expect(acting).toEqual([detectionId])
      }),
      Command.resolve(SplitSightings({ detectionId }), Message.SucceededCaptureAction({ captureId: detectionId })),
      Command.resolve(LoadTray, Message.SucceededLoadTray({ tray: apart })),
      model((current) => expect(keptOf(current).map(({ id: kept }) => kept)).toEqual([detectionId, id('dt', 2)])),
    )
  })
})
