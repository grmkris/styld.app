import { Board, Day } from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import * as Ask from '../src/page/Ask.ts'
import { matching } from '../src/page/AskSearch.ts'
import * as Boards from '../src/page/Boards.ts'
import { missingFrom, outfitFor } from '../src/page/Outfit.ts'
import * as Today from '../src/page/Today.ts'
import { headline } from '../src/page/TodayView.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const redTop = pieceFixture('red-top', { category: 'top', colours: ['red'], name: 'Red shirt' })
const navyKnit = pieceFixture('navy-knit', { category: 'top', colours: ['navy'], name: 'Cable knit' })
const greenTrousers = pieceFixture('green-trousers', { category: 'bottom', colours: ['green'], name: 'Green trousers' })
const blackShoes = pieceFixture('black-shoes', { category: 'shoes', colours: ['black'], name: 'Derby shoes' })
const wardrobe = [redTop, navyKnit, greenTrousers, blackShoes]
const thursday = Schema.decodeUnknownSync(Day)('2026-10-29')
const ids = (query: string, locale: 'en' | 'sl') => matching(wardrobe, query, [locale]).map((piece) => piece.id)

describe("today's table", () => {
  test('an outfit takes one piece a slot, and never two loud colours together', () => {
    for (const spin of Array.range(0, 20)) {
      const outfit = outfitFor(wardrobe, `2026-10-29:${String(spin)}`).map(({ piece }) => piece.id)
      expect(outfit).toContain(greenTrousers.id)
      expect(outfit).toContain(blackShoes.id)
      // The trousers are green, so the red shirt never joins them.
      expect(outfit).toContain(navyKnit.id)
      expect(outfit).not.toContain(redTop.id)
    }
  })

  test('the same day and Spin always lay out the same outfit', () => {
    expect(outfitFor(wardrobe, '2026-10-29:3')).toEqual(outfitFor(wardrobe, '2026-10-29:3'))
  })

  test('a wardrobe short of a whole outfit says what it lacks; a dress stands in for a top and a bottom', () => {
    expect(missingFrom([redTop])).toEqual(['bottom', 'shoes'])
    expect(missingFrom(wardrobe)).toEqual([])
    expect(missingFrom([pieceFixture('dress', { category: 'dress' })])).toEqual(['shoes'])
  })

  test('the headline is the day in the visitor’s language', () => {
    expect(headline('2026-10-30', 'en')).toBe('FRI 30')
    expect(headline('2026-10-30', 'sl')).toBe('PET 30')
  })

  test('Wear this records the outfit on the table for today, once', () => {
    const ready = modifyFields(Today.init(), { maybeDay: () => Option.some(thursday) })
    const worn = Today.tableOutfit(ready, wardrobe).map(({ piece }) => piece.id)
    story(
      Today.update,
      given(ready),
      message(Today.Message.ClickedWear({ pieceIds: worn })),
      Command.expectExact(Today.Wear),
      Command.resolve(Today.Wear, Today.Message.SucceededWear({ pieceIds: worn })),
      model((current) => expect(Today.Worn.guards.Worn(current.worn)).toBe(true)),
      message(Today.Message.ClickedWear({ pieceIds: worn })),
      Command.expectNone(),
    )
  })
})

describe('boards', () => {
  const created = Schema.decodeUnknownSync(Board)({
    id: `bd_${'my-board'.padEnd(22, 'x')}`,
    name: 'My board',
    paper: 'paper',
    version: 0,
    items: [],
    updatedAt: '2026-10-30T08:00:00.000Z',
  })

  test('a new board without a name takes the default one, and opens once it exists', () => {
    story(
      Boards.update,
      given(Boards.init()),
      message(Boards.Message.SubmittedNewBoard({ defaultName: 'My board' })),
      Command.expectExact(Boards.CreateBoard),
      Command.resolve(Boards.CreateBoard, Boards.Message.SucceededCreateBoard({ board: created })),
      expectOutMessage(Boards.OutMessage.CreatedBoard({ boardId: created.id })),
      model(({ creating, name }) => {
        expect(Boards.Creating.guards.Idle(creating)).toBe(true)
        expect(name).toBe('')
      }),
    )
  })

  test('a list that did not load asks again', () => {
    story(
      Boards.update,
      given(modifyFields(Boards.init(), { boards: () => Boards.BoardsData.Failure({ error: 'Unavailable' }) })),
      message(Boards.Message.ClickedRetry()),
      Command.expectExact(Boards.ListBoards),
      Command.resolve(Boards.ListBoards, Boards.Message.SucceededListBoards({ boards: [created] })),
      model(({ boards }) => expect(boards).toEqual(Boards.BoardsData.Success({ data: [created] }))),
    )
  })
})

describe('Ask', () => {
  test('search finds pieces by every word of the query: name, category or colour, in the visitor’s language', () => {
    expect(ids('knit', 'en')).toEqual([navyKnit.id])
    expect(ids('green', 'en')).toEqual([greenTrousers.id])
    expect(ids('derby shoes', 'en')).toEqual([blackShoes.id])
    expect(ids('nothing like this', 'en')).toEqual([])
    expect(ids('', 'en')).toHaveLength(4)
  })

  test('a wardrobe that did not load asks again, through the one list of pieces every page shares', () => {
    story(
      Ask.update,
      given(Ask.init()),
      message(Ask.Message.ClickedRetry()),
      expectOutMessage(Ask.OutMessage.RequestedPieces()),
      model((current) => expect(current).toEqual(Ask.init())),
    )
  })
})
