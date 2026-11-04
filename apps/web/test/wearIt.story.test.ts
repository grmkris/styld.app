import { Day, OutfitProposals, OutfitSession, outfitKeyOf, type Piece } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'
import * as Today from '../src/page/Today.ts'
import * as Tombola from '../src/page/Tombola.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

// Wear it today: the piece the tombola drew becomes the anchor of today's outfits. Every outfit is made around it,
// a swap keeps it (as the anchor, never a lock), and it goes when the person asks for the usual outfits or the day
// changes.

const skirt = pieceFixture('skirt', { type: 'skirts', name: 'Black skirt' })
const tee = pieceFixture('tee', { type: 'shortSleeveTops' })
const boots = pieceFixture('boots', { type: 'boots' })
const thursday = Schema.decodeUnknownSync(Day)('2026-11-05')
const session = OutfitSession.make(`os_${'b'.repeat(22)}`)
const proposal = (pieces: ReadonlyArray<Piece>) => ({
  key: outfitKeyOf(pieces.map(({ id }) => id)),
  pieceIds: pieces.map(({ id }) => id),
  score: 0.8,
})
const batch = Schema.decodeUnknownSync(OutfitProposals)({
  session,
  mode: 'fast',
  proposals: [proposal([skirt, tee, boots])],
  missing: [],
  exhausted: false,
})

/** Home on Thursday with the tombola stopped on the skirt. */
const landed = modifyFields(Today.init(), {
  maybeDay: () => Option.some(thursday),
  tombola: () => ({
    ...Tombola.init(),
    round: 1,
    stage: Tombola.Stage.Landed({ round: 1, slots: Tombola.wheelOf([skirt.id, tee.id], 0), landing: 0 }),
  }),
})

const argsOf = (result: { readonly commands?: ReadonlyArray<{ readonly name: string; readonly args?: unknown }> }) =>
  (result.commands ?? []).map(({ name, args }) => ({ name, args }))

describe('Wear it today', () => {
  test('shuts the tombola and asks for today’s outfits around the drawn piece', () => {
    const worn = Today.update(landed, Today.Message.GotTombolaMessage({ message: Tombola.Message.ClickedWearIt() }))
    expect(Tombola.Stage.guards.Closed(worn.model.tombola.stage)).toBe(true)
    expect(worn.model.maybeAnchor).toEqual(Option.some(skirt.id))
    expect(argsOf(worn)).toContainEqual({
      name: Today.MakeOutfits.name,
      args: {
        day: thursday,
        brief: { season: 'autumn' },
        session: Option.none(),
        seen: [],
        anchor: Option.some(skirt.id),
      },
    })
  })

  const around = Today.update(
    Today.update(landed, Today.Message.GotTombolaMessage({ message: Tombola.Message.ClickedWearIt() })).model,
    Today.Message.SucceededMakeOutfits({ batch }),
  ).model

  test('a swap keeps the anchor as the anchor, not a lock, and the anchor itself is never swapped', () => {
    const pieceIds = [skirt.id, tee.id, boots.id]
    const swapping = Today.update(around, Today.Message.ClickedSwapPiece({ pieceId: tee.id, pieceIds }))
    expect(argsOf(swapping)[0]?.args).toMatchObject({ lockedPieceIds: [boots.id], anchor: Option.some(skirt.id) })
    expect(
      Today.update(around, Today.Message.ClickedSwapPiece({ pieceId: skirt.id, pieceIds })).commands ?? [],
    ).toEqual([])
    const pair = [skirt.id, boots.id]
    expect(
      argsOf(Today.update(around, Today.Message.ClickedSwapPiece({ pieceId: boots.id, pieceIds: pair })))[0]?.args,
    ).toMatchObject({
      lockedPieceIds: [],
      anchor: Option.some(skirt.id),
    })
  })

  test('Back to today’s outfits drops it and asks for the usual ones; a new day drops it too', () => {
    const usual = Today.update(around, Today.Message.ClickedUsualOutfits())
    expect(usual.model.maybeAnchor).toEqual(Option.none())
    expect(argsOf(usual)[0]?.args).toMatchObject({ anchor: Option.none() })
    const friday = Schema.decodeUnknownSync(Day)('2026-11-06')
    expect(Today.update(around, Today.Message.CompletedDetermineDay({ day: friday })).model.maybeAnchor).toEqual(
      Option.none(),
    )
  })
})
