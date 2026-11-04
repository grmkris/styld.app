import type { TryOn as TryOnContract } from '@styld/protocol'
import { Option } from 'effect'
import { Command, click, expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import * as TryOn from '../src/page/TryOn.ts'
import { view } from '../src/View.ts'
import { at, withPage, withPieces } from './AppFixtures.ts'
import { done, drawing, jeans, loaded, photo, tee, tryOnOf } from './TryOnFixtures.ts'

// Try on in the Lab (owner, 4 November 2026), through the app's own view: the cost, the person's word that the photo
// shows them, the drawn try-on beside its photo, and Delete.

const onTryOn = (tryOns: ReadonlyArray<TryOnContract>) =>
  withPage(withPieces(at('/try-on', { signedIn: true }), [tee, jeans]), lenses.tryOn, () => loaded(tryOns))

describe('Try on', () => {
  test('shows its cost and asks This is me before it sends; a spent allowance says so', () => {
    scene(
      { update, view },
      given(onTryOn([])),
      expect(role('heading', { name: 'See yourself in your clothes' })).toExist(),
      click(role('button', { name: 'New try-on' })),
      expect(text('2 credits from today’s free allowance.')).toExist(),
      expect(role('button', { name: 'Try on' })).toHaveAttr('aria-disabled', 'true'),
      click(role('button', { name: 'Outfit photo from 31 Oct' })),
      click(role('button', { name: 'White tee' })),
      expect(text('Chosen: 1 of 9')).toExist(),
      expect(role('button', { name: 'Try on' })).toHaveAttr('aria-disabled', 'true'),
      click(role('checkbox', { name: 'This is me' })),
      expect(role('button', { name: 'Try on' })).not.toHaveAttr('aria-disabled', 'true'),
      click(role('button', { name: 'Try on' })),
      Command.resolve(
        TryOn.StartTryOn({ photoId: photo.id, pieceIds: [tee.id], maybeOperationId: Option.none() }),
        TryOn.Message.FailedStartTryOn({ spent: true, maybeOperationId: Option.none() }),
      ),
      expect(role('alert')).toHaveText('Today’s free credits are spent. Try again tomorrow.'),
    )
  })

  test('a try-on being drawn says so, and a refused one gives the credits back in words', () => {
    scene(
      { update, view },
      given(
        onTryOn([
          drawing,
          tryOnOf({ id: `to_${'second'.padEnd(22, 'x')}`, status: 'refused', createdAt: '2026-11-03T20:00:00.000Z' }),
        ]),
      ),
      expect(text('Drawing…')).toExist(),
      click(role('button', { name: 'Try-on from 4 Nov' })),
      expect(text('Drawing you in these clothes. It takes about 15 seconds.')).toExist(),
      click(role('button', { name: 'All try-ons' })),
      click(role('button', { name: 'Try-on from 3 Nov' })),
      expect(role('alert')).toHaveText('Muse wouldn’t draw this one. Your credits are back.'),
      expect(role('button', { name: 'Try again' })).toExist(),
    )
  })

  test('a drawn try-on stands beside its photo, Before or After on a phone, and Delete asks once more', () => {
    scene(
      { update, view },
      given(onTryOn([done])),
      click(role('button', { name: 'Try-on from 4 Nov' })),
      expect(role('img', { name: 'Your photo' })).toExist(),
      expect(role('img', { name: 'You in the chosen pieces' })).toExist(),
      expect(role('button', { name: 'After' })).toHaveAttr('aria-pressed', 'true'),
      click(role('button', { name: 'Before' })),
      expect(role('button', { name: 'Before' })).toHaveAttr('aria-pressed', 'true'),
      expect(role('button', { name: 'Save to board' })).toExist(),
      click(role('button', { name: 'Delete try-on' })),
      expect(text('Delete this try-on? Your photo stays in your Gallery.')).toExist(),
      click(role('button', { name: 'Delete try-on' })),
      Command.resolve(
        TryOn.DeleteTryOn({ tryOnId: done.id }),
        TryOn.Message.SucceededDeleteTryOn({ tryOnId: done.id }),
      ),
      expect(role('heading', { name: 'See yourself in your clothes' })).toExist(),
    )
  })
})
