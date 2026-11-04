import { Option, Struct } from 'effect'
import { describe, expect, test } from 'vitest'
import { OperationId } from '@styld/protocol'
import { CreateOutfitBoard } from '../src/page/BoardStart.ts'
import {
  DrawPiece,
  FocusOpener,
  FocusResult,
  init,
  landedPiece,
  Message,
  OpenBoard,
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

describe('the ways on from the drawn piece', () => {
  const drawn = {
    ...init(),
    round: 1,
    maybeSeason: Option.some('autumn' as const),
    stage: Stage.Landed({ round: 1, slots: wheelOf([tee.id, coat.id], 0), landing: 0 }),
  }
  const operationId = OperationId.make(`op_${'m'.repeat(22)}`)

  test('Make outfits with it asks for the outfit board around it, once; a failure is asked for again under its id', () => {
    const making = update(drawn, Message.ClickedMakeOutfits({ name: 'White tee: outfits' }))
    expect(making.commands?.map(({ name, args }) => ({ name, args }))).toEqual([
      {
        name: CreateOutfitBoard.name,
        args: {
          name: 'White tee: outfits',
          anchorPieceId: tee.id,
          maybeSeason: Option.some('autumn'),
          maybeOperationId: Option.none(),
        },
      },
    ])
    expect(update(making.model, Message.ClickedBuildOwn({ name: 'White tee: my board' })).commands ?? []).toEqual([])
    const failed = update(
      making.model,
      Message.FailedMakeOutfits({ problem: 'failed', missing: [], operationId: Option.some(operationId) }),
    ).model
    expect(
      update(failed, Message.ClickedMakeOutfits({ name: 'White tee: outfits' })).commands?.[0]?.args,
    ).toMatchObject({ maybeOperationId: Option.some(operationId) })
    const made = update(making.model, Message.SucceededMakeOutfits({ boardId: 'bd_made' }))
    expect(made.commands?.map(({ name, args }) => ({ name, args }))).toEqual([
      { name: OpenBoard.name, args: { boardId: 'bd_made' } },
    ])
  })

  test('Build my own saves the piece to a new board by its name, resuming a failed try, and opens it', () => {
    const building = update(drawn, Message.ClickedBuildOwn({ name: 'White tee: my board' }))
    expect(building.commands?.[0]?.args).toEqual({
      target: { kind: 'piece', id: tee.id },
      destination: { boardId: Option.none(), boardName: 'White tee: my board' },
      resume: Option.none(),
    })
    const resume = {
      destination: { boardId: Option.none(), boardName: 'White tee: my board' },
      createOperationId: operationId,
      pinOperationId: operationId,
      createdBoardId: Option.some('bd_half'),
    }
    const failed = update(building.model, Message.FailedBuildOwn({ resume })).model
    expect(update(failed, Message.ClickedBuildOwn({ name: 'White tee: my board' })).commands?.[0]?.args).toMatchObject({
      resume: Option.some(resume),
    })
    expect(
      update(building.model, Message.SucceededBuildOwn({ boardId: 'bd_own' })).commands?.map(({ name }) => name),
    ).toEqual([OpenBoard.name])
  })
})
