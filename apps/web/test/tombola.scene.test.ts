import { Day } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { click, Command, expect, given, inside, Mount, role, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import { DrawPiece, FocusOpener, FocusResult, HoldTombola, Message, TurnWheel, wheelOf } from '../src/page/Tombola.ts'
import { view } from '../src/View.ts'
import { at, withPage, withPieces } from './AppFixtures.ts'
import { settled } from './HomeFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

// What to wear today on Home: the button under the day opens a screen where a wheel of the person's pieces turns and
// stops on one, with the ways on from it; Escape or Close shuts it and focus goes back to the button.

const skirt = pieceFixture('skirt', { type: 'skirts', name: 'Black skirt' })
const tee = pieceFixture('tee', { type: 'shortSleeveTops', name: 'White tee' })
const day = Schema.decodeUnknownSync(Day)('2026-11-04')

const home = (pieces: ReadonlyArray<typeof skirt>) =>
  withPage(withPieces(at('/', { signedIn: true }), pieces), lenses.today, (today) =>
    modifyFields(settled(today), { maybeDay: () => Option.some(day) }),
  )

describe('What to wear today', () => {
  test('shows only with two pieces to draw from', () => {
    scene({ update, view }, given(home([skirt])), expect(role('button', { name: 'What to wear today' })).not.toExist())
  })

  test('the wheel stops on a piece, which says what it is and opens; Close goes back to the button', () => {
    scene(
      { update, view },
      given(home([skirt, tee])),
      click(role('button', { name: 'What to wear today' })),
      Command.resolve(
        DrawPiece,
        Message.CompletedDrawPiece({ round: 1, slots: wheelOf([skirt.id, tee.id], 0), landing: 0 }),
      ),
      Mount.resolve(HoldTombola, Message.CompletedHoldTombola()),
      inside(role('dialog', { name: 'What to wear today' }), expect(role('status')).toHaveText('Spinning…')),
      Mount.resolve(TurnWheel, Message.CompletedTurnWheel({ round: 1 })),
      // The wheel gives way to the piece it stopped on.
      Mount.expectEnded(TurnWheel),
      Command.resolve(FocusResult, Message.CompletedFocusResult()),
      inside(
        role('dialog', { name: 'What to wear today' }),
        expect(role('heading', { name: 'Today’s pick: Black skirt' })).toExist(),
        expect(role('link', { name: 'Open the piece' })).toHaveAttr('href', `/wardrobe/${skirt.id}`),
        expect(role('button', { name: 'Spin again' })).toExist(),
        click(role('button', { name: 'Close' })),
      ),
      Command.resolve(FocusOpener, Message.CompletedFocusOpener()),
      Mount.expectEnded(HoldTombola),
      expect(role('dialog')).not.toExist(),
    )
  })
})
