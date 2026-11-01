import { LookId, type Look as LookContract } from '@styld/protocol'
import { AsyncData } from 'foldkit'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import {
  DeleteLook,
  Deletion,
  Message as LookMessage,
  ShareLook,
  Sharing,
  LookData,
  LookShown,
  init as initLook,
  update as updateLook,
} from '../src/page/Look.ts'
import { ListLooks, Message, SavedData, init, revisit, update } from '../src/page/Looks.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const lookId = `lk_${'a'.repeat(22)}`
const weekend: LookContract = {
  id: LookId.make(lookId),
  name: 'Weekend',
  occasion: 'Brunch',
  pieces: [pieceFixture('tee', { name: 'White tee' }), pieceFixture('jeans', { type: 'trousers' })],
  shared: false,
  check: null,
  createdAt: '2026-10-29T12:00:00.000Z',
}

describe('the looks page', () => {
  test('lists the saved looks, and a list that cannot load loads again on retry', () => {
    story(
      update,
      given(revisit(init()).model),
      message(Message.FailedListLooks()),
      model(({ saved }) => expect(AsyncData.isFailure(saved)).toBe(true)),
      message(Message.ClickedRetry()),
      Command.resolve(ListLooks, Message.SucceededListLooks({ looks: [weekend] })),
      model(({ saved }) => expect(saved).toEqual(SavedData.Success({ data: [weekend] }))),
    )
  })
})

describe('one look', () => {
  test('a look that did not load is tried again; a failed read later keeps the look shown', () => {
    const failed = updateLook(initLook(lookId), LookMessage.FailedGetLook({ error: 'Unavailable' })).model
    expect(failed.look).toEqual(LookData.Failure({ error: 'Unavailable' }))
    const retried = updateLook(failed, LookMessage.ClickedRetry())
    expect(retried.model.look).toEqual(LookData.Loading())
    expect(retried.commands?.map(({ name }) => name)).toEqual(['GetLook'])
    const shown = updateLook(retried.model, LookMessage.SucceededGetLook({ look: weekend })).model
    expect(updateLook(shown, LookMessage.FailedGetLook({ error: 'Unavailable' })).model.look).toEqual(
      LookData.Stale({ error: 'Unavailable', data: LookShown.Own({ look: weekend }) }),
    )
  })

  test('a missing look says so rather than failing', () => {
    story(
      updateLook,
      given(initLook(lookId)),
      message(LookMessage.FailedGetLook({ error: 'NotFound' })),
      model(({ look }) => expect(look).toEqual(LookData.Failure({ error: 'NotFound' }))),
    )
  })

  test('sharing a look needs a published profile, and shows the shared look with its check', () => {
    const shared = { ...weekend, shared: true, check: { state: 'passed', reason: null, hidden: false } } as const
    story(
      updateLook,
      given(initLook(lookId)),
      message(LookMessage.SucceededGetLook({ look: weekend })),
      message(LookMessage.ToggledShared({ shared: true })),
      Command.resolve(ShareLook({ lookId, shared: true }), LookMessage.FailedShareLook({ needsProfile: true })),
      model(({ sharing }) => expect(sharing).toEqual(Sharing.Failed({ needsProfile: true }))),
      message(LookMessage.ToggledShared({ shared: true })),
      Command.resolve(ShareLook({ lookId, shared: true }), LookMessage.SucceededShareLook({ look: shared })),
      model(({ look, sharing }) => {
        expect(look).toEqual(LookData.Success({ data: LookShown.Own({ look: shared }) }))
        expect(Sharing.guards.Idle(sharing)).toBe(true)
      }),
    )
  })

  test('deleting asks first, can be cancelled, and hands back to the looks once done', () => {
    story(
      updateLook,
      given(initLook(lookId)),
      message(LookMessage.SucceededGetLook({ look: weekend })),
      message(LookMessage.ClickedDelete()),
      message(LookMessage.ClickedCancelDelete()),
      model(({ deletion }) => expect(Deletion.guards.Idle(deletion)).toBe(true)),
      message(LookMessage.ClickedDelete()),
      message(LookMessage.ClickedConfirmDelete()),
      Command.expectExact(DeleteLook({ lookId })),
      Command.resolve(DeleteLook({ lookId }), LookMessage.SucceededDeleteLook()),
      expectOutMessage({ _tag: 'DeletedLook' }),
    )
    story(
      updateLook,
      given(initLook(lookId)),
      message(LookMessage.ClickedDelete()),
      message(LookMessage.ClickedConfirmDelete()),
      Command.resolve(DeleteLook({ lookId }), LookMessage.FailedDeleteLook()),
      model(({ deletion }) => expect(Deletion.guards.Failed(deletion)).toBe(true)),
    )
  })
})
