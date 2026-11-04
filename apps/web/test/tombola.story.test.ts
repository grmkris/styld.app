import { Option, Struct } from 'effect'
import { describe, expect, test } from 'vitest'
import {
  DrawPiece,
  FocusOpener,
  FocusResult,
  init,
  landedPiece,
  Message,
  Stage,
  tombolaPool,
  update,
  wheelOf,
  wheelSize,
} from '../src/page/Tombola.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

// What to wear today: a wheel of the person's pieces stops on one. It lands only on what a day is built around, in
// season first, and every spin is a fresh draw; an answer from an earlier spin changes nothing.

const coat = pieceFixture('coat', { type: 'coats', seasons: ['winter'] })
const sandals = pieceFixture('sandals', { type: 'sandals', seasons: ['summer'] })
const tee = pieceFixture('tee', { type: 'shortSleeveTops' })

const names = (commands: ReadonlyArray<{ readonly name: string }> | undefined) =>
  (commands ?? []).map(({ name }) => name)

describe('the pieces a spin may land on', () => {
  test('ready pieces with a picture, never sportswear, swimwear, loungewear, sport or outdoor shoes, or socks', () => {
    const left = ['sportswear', 'swimwear', 'loungewear', 'sportShoes', 'outdoorShoes', 'socks'].map((type) =>
      pieceFixture(type, { type }),
    )
    const processing = pieceFixture('new', { status: 'processing' })
    const unseen = Struct.omit(pieceFixture('unseen'), ['images'])
    expect(tombolaPool([...left, processing, unseen, tee], Option.none())).toEqual([tee.id])
  })

  test('those that suit the day’s season (a piece without seasons suits them all), else every one', () => {
    expect(tombolaPool([coat, sandals, tee], Option.some('winter'))).toEqual([coat.id, tee.id])
    expect(tombolaPool([coat, sandals], Option.some('autumn'))).toEqual([coat.id, sandals.id])
  })

  test('the wheel holds twelve, the drawn piece where it stops and the others round it', () => {
    const wheel = wheelOf([tee.id, coat.id, sandals.id], 5)
    expect(wheel).toHaveLength(wheelSize)
    expect(wheel[5]).toBe(tee.id)
    expect(wheel[6]).toBe(coat.id)
    expect(wheel[7]).toBe(sandals.id)
    expect(wheel.filter((id) => id === tee.id)).toHaveLength(1)
  })
})

describe('a spin', () => {
  const pool = [tee.id, coat.id]

  test('draws, turns, lands with focus on the piece, spins again, and shuts back to the button', () => {
    const opened = update(init(), Message.ClickedOpen({ pool, maybeSeason: Option.some('winter') }))
    expect(opened.model.stage).toEqual(Stage.Drawing({ round: 1 }))
    expect(opened.commands?.map(({ name, args }) => ({ name, args }))).toEqual([
      { name: DrawPiece.name, args: { pool, round: 1 } },
    ])
    const slots = wheelOf([coat.id, tee.id], 3)
    const turning = update(opened.model, Message.CompletedDrawPiece({ round: 1, slots, landing: 3 })).model
    expect(turning.stage).toEqual(Stage.Turning({ round: 1, slots, landing: 3 }))
    const landed = update(turning, Message.CompletedTurnWheel({ round: 1 }))
    expect(landedPiece(landed.model.stage)).toEqual(Option.some(coat.id))
    expect(names(landed.commands)).toEqual([FocusResult.name])
    const again = update(landed.model, Message.ClickedSpinAgain())
    expect(again.model.stage).toEqual(Stage.Drawing({ round: 2 }))
    expect(names(again.commands)).toEqual([DrawPiece.name])
    const shut = update(again.model, Message.ClickedClose())
    expect(shut.model.stage).toEqual(Stage.Closed())
    expect(names(shut.commands)).toEqual([FocusOpener.name])
  })

  test('an answer from an earlier spin changes nothing', () => {
    const opened = update(init(), Message.ClickedOpen({ pool, maybeSeason: Option.none() })).model
    const late = update(opened, Message.CompletedDrawPiece({ round: 0, slots: wheelOf(pool, 0), landing: 0 }))
    expect(late.model).toEqual(opened)
    expect(update(opened, Message.CompletedTurnWheel({ round: 1 })).model).toEqual(opened)
  })
})
