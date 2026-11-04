import { Look } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import * as TryOn from '../src/page/TryOn.ts'
import { done, drawing, jeans, loaded, lostOperation, photo, tee, tryOnOf } from './TryOnFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

// Try on (owner, 4 November 2026): a Gallery photo of the person and their pieces, for two credits, sent only once
// the person says the photo shows them, and followed until it is drawn.

/** What the page's poll waits on. */
const pending = (current: TryOn.Model) => TryOn.subscriptions.tryOnsWhileMaking.modelToDependencies(current).pendingIds

const screenOf = (current: TryOn.Model) => current.screen

describe('Try on', () => {
  test('is sent only with a photo, a piece and This is me, then followed until it is drawn', () => {
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
      message(TryOn.Message.ToggledThisIsMe()),
      message(TryOn.Message.ClickedTryOn()),
      Command.expectExact(
        TryOn.StartTryOn({ photoId: photo.id, pieceIds: [tee.id, jeans.id], maybeOperationId: Option.none() }),
      ),
      Command.resolve(TryOn.StartTryOn, TryOn.Message.SucceededStartTryOn({ tryOn: drawing })),
      model((current) => expect(screenOf(current)).toEqual(TryOn.Screen.Open({ tryOnId: drawing.id, side: 'after' }))),
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
      message(TryOn.Message.ClickedNew()),
      message(TryOn.Message.SelectedPhoto({ photoId: photo.id })),
      message(TryOn.Message.ToggledPiece({ pieceId: tee.id })),
      message(TryOn.Message.ToggledThisIsMe()),
      message(TryOn.Message.ClickedTryOn()),
      Command.resolve(
        TryOn.StartTryOn,
        TryOn.Message.FailedStartTryOn({ spent: true, maybeOperationId: Option.none() }),
      ),
      model((current) =>
        expect(screenOf(current)).toMatchObject({
          sending: TryOn.Sending.Failed({ spent: true, maybeOperationId: Option.none() }),
        }),
      ),
      message(TryOn.Message.ClickedTryOn()),
      Command.resolve(
        TryOn.StartTryOn,
        TryOn.Message.FailedStartTryOn({ spent: false, maybeOperationId: Option.some(lostOperation) }),
      ),
      message(TryOn.Message.ClickedTryOn()),
      Command.expectExact(
        TryOn.StartTryOn({ photoId: photo.id, pieceIds: [tee.id], maybeOperationId: Option.some(lostOperation) }),
      ),
      Command.resolve(TryOn.StartTryOn, TryOn.Message.SucceededStartTryOn({ tryOn: drawing })),
    )
  })

  test('a changed choice is a new try-on: the lost answer’s id is dropped', () => {
    story(
      TryOn.update,
      given(loaded([])),
      message(TryOn.Message.ClickedTryAgain({ photoId: photo.id, pieceIds: [tee.id] })),
      message(TryOn.Message.ToggledThisIsMe()),
      message(TryOn.Message.ClickedTryOn()),
      Command.resolve(
        TryOn.StartTryOn,
        TryOn.Message.FailedStartTryOn({ spent: false, maybeOperationId: Option.some(lostOperation) }),
      ),
      message(TryOn.Message.ToggledPiece({ pieceId: jeans.id })),
      model((current) => expect(screenOf(current)).toMatchObject({ sending: TryOn.Sending.Idle() })),
      message(TryOn.Message.ClickedTryOn()),
      Command.expectExact(
        TryOn.StartTryOn({ photoId: photo.id, pieceIds: [tee.id, jeans.id], maybeOperationId: Option.none() }),
      ),
      Command.resolve(TryOn.StartTryOn, TryOn.Message.SucceededStartTryOn({ tryOn: drawing })),
    )
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
    const chosen = [
      TryOn.Message.ClickedNew(),
      TryOn.Message.SelectedPhoto({ photoId: photo.id }),
      TryOn.Message.SelectedLook({ pieceIds: look.pieces.map(({ id }) => id) }),
    ].reduce((current, next) => TryOn.update(current, next).model, loaded([done]))
    expect(screenOf(chosen)).toMatchObject({ thisIsMe: true, pieceIds: pieces.slice(0, 9).map(({ id }) => id) })
  })

  test('Delete asks once more, then the try-on leaves the list', () => {
    story(
      TryOn.update,
      given(loaded([done])),
      message(TryOn.Message.ClickedOpen({ tryOnId: done.id })),
      message(TryOn.Message.ClickedDelete()),
      Command.expectNone(),
      message(TryOn.Message.ClickedConfirmDelete()),
      Command.expectExact(TryOn.DeleteTryOn({ tryOnId: done.id })),
      Command.resolve(TryOn.DeleteTryOn, TryOn.Message.SucceededDeleteTryOn({ tryOnId: done.id })),
      model((current) => expect(AsyncData.getData(current.tryOns)).toEqual(Option.some([]))),
      model((current) => expect(screenOf(current)).toEqual(TryOn.Screen.List())),
    )
  })

  test('a refused try-on offers the same photo and pieces again', () => {
    const refused = tryOnOf({ status: 'refused' })
    const again = TryOn.update(
      loaded([refused]),
      TryOn.Message.ClickedTryAgain({ photoId: photo.id, pieceIds: refused.pieceIds }),
    ).model
    expect(screenOf(again)).toMatchObject({
      maybePhotoId: Option.some(photo.id),
      pieceIds: refused.pieceIds,
      thisIsMe: true,
    })
  })
})
