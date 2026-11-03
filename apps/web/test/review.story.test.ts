import { CaptureId, DetectionId, type Tray as TrayContract, OperationId } from '@styld/protocol'
import { Array, Option } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import {
  keptOf,
  LoadTray,
  Message,
  type Model,
  RemoveCapture,
  RetryCapture,
  SplitSightings,
  Saving,
  SendReview,
  init,
  subscriptions,
  TrayData,
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
    seasons: [],
    rainproof: false,
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
const processing = tray([{ status: 'processing', detections: [] }])

/** The captures the tray's poll waits on. */
const pending = (current: Model) => subscriptions.trayWhileProcessing.modelToDependencies(current).pendingIds

describe('the review tray', () => {
  test('asks again while a capture is still being cut out, and stops once none is', () => {
    story(
      update,
      given(init()),
      message(Message.SucceededLoadTray({ tray: processing })),
      Command.expectNone(),
      model((current) => expect(pending(current)).toEqual([id('cp', 0)])),
      message(Message.TickedTrayRefresh()),
      Command.expectExact(LoadTray),
      Command.resolve(LoadTray, Message.SucceededLoadTray({ tray: found })),
      model((current) => {
        expect(keptOf(current)).toHaveLength(2)
        expect(pending(current)).toEqual([])
      }),
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
    const lost = OperationId.make('op-review-1')
    const sent = (maybeOperationId: Option.Option<OperationId>) =>
      SendReview({
        maybeOperationId,
        keep: [
          {
            detectionId: id('dt', 1),
            type: 'tops',
            details: {
              type: Option.some('tops'),
              colours: ['navy'],
              seasons: [],
              rainproof: false,
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
      Command.expectExact(sent(Option.none())),
      Command.resolve(SendReview, Message.FailedReview({ maybeOperationId: Option.some(lost) })),
      model(({ saving }) => expect(saving).toEqual(Saving.Failed({ maybeOperationId: Option.some(lost) }))),
      message(Message.ClickedAdd()),
      Command.expectExact(sent(Option.some(lost))),
      Command.resolve(SendReview, Message.SucceededReview({ count: 1 })),
      expectOutMessage({ _tag: 'AddedPieces', count: 1 }),
      model(({ saving }) => expect(Saving.guards.Idle(saving)).toBe(true)),
    )
  })

  test('a refused add reads the tray again, and the next add is a new operation', () => {
    const shown = update(init(), Message.SucceededLoadTray({ tray: found })).model
    const adding = update(shown, Message.ClickedAdd())
    expect(adding.commands?.map(({ name }) => name)).toEqual([SendReview.name])
    const refused = update(adding.model, Message.FailedReview({ maybeOperationId: Option.none() }))
    expect(refused.model.saving).toEqual(Saving.Failed({ maybeOperationId: Option.none() }))
    expect(refused.commands?.map(({ name }) => name)).toEqual([LoadTray.name])
  })

  test('polls one read at a time: a tick while a read is on its way asks for nothing more', () => {
    const shown = update(init(), Message.SucceededLoadTray({ tray: processing })).model
    const asking = update(shown, Message.TickedTrayRefresh())
    expect(asking.commands?.map(({ name }) => name)).toEqual(['LoadTray'])
    expect(update(asking.model, Message.TickedTrayRefresh()).commands ?? []).toEqual([])
  })

  test('a poll leaves the person’s decisions, the piece open and adding as they were', () => {
    const withWaiting = tray([
      { status: 'review', detections: [detection(1, 'tops'), detection(2, 'jeans')] },
      { status: 'processing', detections: [] },
    ])
    const shown = update(init(), Message.SucceededLoadTray({ tray: withWaiting })).model
    const untickedAndOpen = update(
      update(shown, Message.ToggledKeep({ detectionId: id('dt', 2) })).model,
      Message.ClickedEdit({ detectionId: id('dt', 1) }),
    ).model
    const adding = update(untickedAndOpen, Message.ClickedAdd()).model
    const polled = update(
      update(adding, Message.TickedTrayRefresh()).model,
      Message.SucceededLoadTray({ tray: withWaiting }),
    ).model
    expect(polled.saving).toEqual(Saving.Saving())
    expect(polled.editing).toEqual(Option.some(id('dt', 1)))
    expect(keptOf(polled).map(({ id: kept }) => kept)).toEqual([id('dt', 1)])
  })

  test('a failed poll keeps the tray shown; after five in a row it stops, and Try again starts it over', () => {
    const shown = update(init(), Message.SucceededLoadTray({ tray: processing })).model
    const missedOnce = update(update(shown, Message.TickedTrayRefresh()).model, Message.FailedLoadTray()).model
    expect(missedOnce.tray).toEqual(TrayData.Stale({ error: 'Unavailable', data: processing }))
    expect(pending(missedOnce)).toEqual([id('cp', 0)])
    const missed = Array.reduce(
      Array.range(2, 5),
      missedOnce,
      (current) => update(update(current, Message.TickedTrayRefresh()).model, Message.FailedLoadTray()).model,
    )
    expect(pending(missed)).toEqual([])
    const retried = update(missed, Message.ClickedRetryLoad())
    expect(retried.commands?.map(({ name }) => name)).toEqual(['LoadTray'])
    expect(pending(retried.model)).toEqual([id('cp', 0)])
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
