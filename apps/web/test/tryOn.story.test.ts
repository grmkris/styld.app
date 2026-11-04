import { Look, OperationId } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { Deletion } from '../src/Confirm.ts'
import * as TryOn from '../src/page/TryOn.ts'
import { done, drawing, jeans, loaded, lostOperation, otherPhoto, photo, tee, tryOnOf } from './TryOnFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

// Try on (owner, 4 November 2026): a Gallery photo of the person and their pieces, for two credits, sent only once
// the person says the photo shows them, and followed until it is drawn on its own page.

/** What the page's poll waits on. */
const pending = (current: TryOn.Model) => TryOn.subscriptions.tryOnsWhileMaking.modelToDependencies(current).pendingIds

const screenOf = (current: TryOn.Model) => current.screen
const opened = TryOn.initOpen(done.id)

const chosen = [
  message(TryOn.Message.ClickedNew()),
  message(TryOn.Message.SelectedPhoto({ photoId: photo.id })),
  message(TryOn.Message.ToggledPiece({ pieceId: tee.id })),
  message(TryOn.Message.ToggledThisIsMe({ isChecked: true })),
] as const

describe('Try on', () => {
  test('is sent only with a photo, a piece and This is me, then opens its own page', () => {
    story(
      TryOn.update,
      given(loaded([])),
      message(TryOn.Message.ClickedNew()),
      message(TryOn.Message.ClickedTryOn()),
      Command.expectNone(),
      message(TryOn.Message.SelectedPhoto({ photoId: photo.id })),
      message(TryOn.Message.ToggledPiece({ pieceId: tee.id })),
      message(TryOn.Message.ToggledPiece({ pieceId: jeans.id })),
      // Without the person's word that the photo shows them, nothing is sent.
      message(TryOn.Message.ClickedTryOn()),
      Command.expectNone(),
      message(TryOn.Message.ToggledThisIsMe({ isChecked: true })),
      message(TryOn.Message.ClickedTryOn()),
      Command.expectExact(
        TryOn.StartTryOn({ photoId: photo.id, pieceIds: [tee.id, jeans.id], maybeOperationId: Option.none() }),
      ),
      Command.resolve(TryOn.StartTryOn, TryOn.Message.SucceededStartTryOn({ tryOn: drawing })),
      expectOutMessage(TryOn.OutMessage.StartedTryOn({ tryOnId: drawing.id })),
      model((current) => expect(pending(current)).toEqual([drawing.id])),
    )
  })

  test('its page follows it until it is drawn', () => {
    story(
      TryOn.update,
      given(loaded([drawing], TryOn.initOpen(drawing.id))),
      model((current) => expect(pending(current)).toEqual([drawing.id])),
      message(TryOn.Message.TickedTryOnsRefresh()),
      Command.expectExact(TryOn.ListTryOns()),
      Command.resolve(TryOn.ListTryOns, TryOn.Message.SucceededListTryOns({ tryOns: [done] })),
      model((current) => expect(AsyncData.getData(current.tryOns)).toEqual(Option.some([done]))),
      model((current) => expect(pending(current)).toEqual([])),
    )
  })

  test('today’s credits spent says so; a lost answer is asked again under the same operation id', () => {
    story(
      TryOn.update,
      given(loaded([])),
      ...chosen,
      message(TryOn.Message.ClickedTryOn()),
      Command.resolve(TryOn.StartTryOn, TryOn.Message.FailedStartTryOn({ problem: TryOn.Problem.Spent() })),
      model((current) =>
        expect(screenOf(current)).toMatchObject({ sending: TryOn.Sending.Failed({ problem: TryOn.Problem.Spent() }) }),
      ),
      message(TryOn.Message.ClickedTryOn()),
      Command.expectExact(TryOn.StartTryOn({ photoId: photo.id, pieceIds: [tee.id], maybeOperationId: Option.none() })),
      Command.resolve(
        TryOn.StartTryOn,
        TryOn.Message.FailedStartTryOn({ problem: TryOn.Problem.Lost({ operationId: lostOperation }) }),
      ),
      message(TryOn.Message.ClickedTryOn()),
      Command.expectExact(
        TryOn.StartTryOn({ photoId: photo.id, pieceIds: [tee.id], maybeOperationId: Option.some(lostOperation) }),
      ),
      Command.resolve(TryOn.StartTryOn, TryOn.Message.SucceededStartTryOn({ tryOn: drawing })),
      expectOutMessage(TryOn.OutMessage.StartedTryOn({ tryOnId: drawing.id })),
    )
  })

  test('only a refusal Styld gave for good drops the operation id: anything else may have reached it', () => {
    const operationId = Schema.decodeUnknownSync(OperationId)('start-0001')
    const lost = TryOn.Problem.Lost({ operationId })
    expect(TryOn.problemOf({ _tag: 'LimitReached', limit: 'dailyCredits' }, operationId)).toEqual(TryOn.Problem.Spent())
    expect(TryOn.problemOf({ _tag: 'SlowDown' }, operationId)).toEqual(TryOn.Problem.Refused())
    expect(TryOn.problemOf({ _tag: 'NotFound' }, operationId)).toEqual(TryOn.Problem.Refused())
    expect(TryOn.problemOf({ _tag: 'OperationConflict' }, operationId)).toEqual(TryOn.Problem.Refused())
    expect(TryOn.problemOf({ _tag: 'Unavailable' }, operationId)).toEqual(lost)
    expect(TryOn.problemOf(new TypeError('Failed to fetch'), operationId)).toEqual(lost)
    expect(TryOn.problemOf({ _tag: 'ClientNotLoaded' }, operationId)).toEqual(lost)
  })

  test('a changed choice is a new try-on: the lost answer’s id is dropped', () => {
    story(
      TryOn.update,
      given(loaded([])),
      message(TryOn.Message.ClickedTryAgain({ photoId: photo.id, pieceIds: [tee.id] })),
      message(TryOn.Message.ToggledThisIsMe({ isChecked: true })),
      message(TryOn.Message.ClickedTryOn()),
      Command.resolve(
        TryOn.StartTryOn,
        TryOn.Message.FailedStartTryOn({ problem: TryOn.Problem.Lost({ operationId: lostOperation }) }),
      ),
      message(TryOn.Message.ToggledPiece({ pieceId: jeans.id })),
      model((current) => expect(screenOf(current)).toMatchObject({ sending: TryOn.Sending.Idle() })),
      message(TryOn.Message.ClickedTryOn()),
      Command.expectExact(
        TryOn.StartTryOn({ photoId: photo.id, pieceIds: [tee.id, jeans.id], maybeOperationId: Option.none() }),
      ),
      Command.resolve(TryOn.StartTryOn, TryOn.Message.SucceededStartTryOn({ tryOn: drawing })),
      expectOutMessage(TryOn.OutMessage.StartedTryOn({ tryOnId: drawing.id })),
    )
  })

  test('This is me belongs to one photo: choosing another asks again, unless that one was tried on before', () => {
    story(
      TryOn.update,
      given(loaded([tryOnOf({ photoId: otherPhoto.id, status: 'done' })])),
      ...chosen,
      model((current) => expect(screenOf(current)).toMatchObject({ thisIsMe: true })),
      message(TryOn.Message.SelectedPhoto({ photoId: photo.id })),
      model((current) => expect(screenOf(current)).toMatchObject({ thisIsMe: false })),
      message(TryOn.Message.SelectedPhoto({ photoId: otherPhoto.id })),
      model((current) => expect(screenOf(current)).toMatchObject({ thisIsMe: true, pieceIds: [tee.id] })),
    )
  })

  test('going back while it is sent stays back: the try-on joins the list without opening', () => {
    const steps = [
      TryOn.Message.ClickedNew(),
      TryOn.Message.SelectedPhoto({ photoId: photo.id }),
      TryOn.Message.ToggledPiece({ pieceId: tee.id }),
      TryOn.Message.ToggledThisIsMe({ isChecked: true }),
      TryOn.Message.ClickedTryOn(),
      TryOn.Message.ClickedBack(),
    ]
    const back = steps.reduce((current, next) => TryOn.update(current, next).model, loaded([]))
    const answered = TryOn.update(back, TryOn.Message.SucceededStartTryOn({ tryOn: drawing }))
    expect(answered.outMessage).toBeUndefined()
    expect(screenOf(answered.model)).toEqual(TryOn.Screen.List())
    expect(AsyncData.getData(answered.model.tryOns)).toEqual(Option.some([drawing]))
  })

  test('a photo tried on before keeps its This is me; a look’s pieces become the choice, nine at most', () => {
    const pieces = Array.from({ length: 11 }, (_, at) => pieceFixture(`p${String(at)}`))
    const look = Schema.decodeUnknownSync(Look)({
      id: `lk_${'big'.padEnd(22, 'x')}`,
      name: 'Everything',
      occasion: null,
      pieces,
      shared: false,
      check: null,
      createdAt: '2026-10-31T10:00:00.000Z',
    })
    story(
      TryOn.update,
      given(loaded([done])),
      message(TryOn.Message.ClickedNew()),
      message(TryOn.Message.SelectedPhoto({ photoId: photo.id })),
      message(TryOn.Message.SelectedLook({ pieceIds: look.pieces.map(({ id }) => id) })),
      model((current) =>
        expect(screenOf(current)).toMatchObject({ thisIsMe: true, pieceIds: pieces.slice(0, 9).map(({ id }) => id) }),
      ),
    )
  })

  test('Delete asks once more, keeps its operation id when the answer is lost, and goes back to the list', () => {
    const deleteOperation = Schema.decodeUnknownSync(OperationId)('delete-lost-0001')
    story(
      TryOn.update,
      given(loaded([done], opened)),
      message(TryOn.Message.ClickedDelete()),
      Command.expectNone(),
      message(TryOn.Message.ClickedConfirmDelete()),
      Command.expectExact(TryOn.DeleteTryOn({ tryOnId: done.id, maybeOperationId: Option.none() })),
      Command.resolve(TryOn.DeleteTryOn, TryOn.Message.FailedDeleteTryOn({ operationId: deleteOperation })),
      model((current) => expect(current.deletion).toEqual(Deletion.Failed())),
      message(TryOn.Message.ClickedConfirmDelete()),
      Command.expectExact(TryOn.DeleteTryOn({ tryOnId: done.id, maybeOperationId: Option.some(deleteOperation) })),
      Command.resolve(TryOn.DeleteTryOn, TryOn.Message.SucceededDeleteTryOn({ tryOnId: done.id })),
      expectOutMessage(TryOn.OutMessage.DeletedTryOn()),
      model((current) => expect(AsyncData.getData(current.tryOns)).toEqual(Option.some([]))),
    )
  })

  test('a refused try-on offers the same photo and pieces again, and Cancel returns to it', () => {
    const refused = tryOnOf({ status: 'refused' })
    story(
      TryOn.update,
      given(loaded([refused], TryOn.initOpen(refused.id))),
      message(TryOn.Message.ClickedTryAgain({ photoId: photo.id, pieceIds: refused.pieceIds })),
      model((current) =>
        expect(screenOf(current)).toMatchObject({
          maybePhotoId: Option.some(photo.id),
          pieceIds: refused.pieceIds,
          thisIsMe: true,
        }),
      ),
      message(TryOn.Message.ClickedBack()),
      model((current) => expect(screenOf(current)).toMatchObject({ _tag: 'Open', tryOnId: refused.id })),
    )
  })
})
