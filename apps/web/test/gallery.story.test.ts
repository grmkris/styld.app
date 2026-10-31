import { Board, BoardItemId, BoardSummary, Day, type Piece, PieceItem } from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import * as Ask from '../src/page/Ask.ts'
import { matching } from '../src/page/AskSearch.ts'
import * as Boards from '../src/page/Boards.ts'
import { missingFrom, outfitFor } from '../src/page/Outfit.ts'
import * as Today from '../src/page/Today.ts'
import { cropFrom, headline } from '../src/page/TodayView.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const redTop = pieceFixture('red-top', { type: 'tops', colours: ['red'], name: 'Red shirt' })
const navyKnit = pieceFixture('navy-knit', { type: 'tops', colours: ['navy'], name: 'Cable knit' })
const greenTrousers = pieceFixture('green-trousers', { type: 'trousers', colours: ['green'], name: 'Green trousers' })
const blackShoes = pieceFixture('black-shoes', { type: 'trainers', colours: ['black'], name: 'Derby shoes' })
const wardrobe = [redTop, navyKnit, greenTrousers, blackShoes]
const thursday = Schema.decodeUnknownSync(Day)('2026-10-29')
const drawn = { type: 'tops', picture: { state: 'ready', shows: 'clean', version: 1 } }
const drawnOxford = pieceFixture('drawn-oxford', drawn)
const drawnPolo = pieceFixture('drawn-polo', drawn)
const photoTops = ['photo-tee', 'photo-henley', 'photo-knit'].map((seed) => pieceFixture(seed, { type: 'tops' }))
/** Every piece thirty Spins of one day lay out. */
const piecesOverSpins = (pieces: ReadonlyArray<Piece>) =>
  new Set(
    Array.range(0, 30)
      .flatMap((spin) => outfitFor(pieces, `2026-10-29:${String(spin)}`))
      .map(({ piece }) => piece.id),
  )
/** The knit laid 400 units across, centred `y` units down a table. */
const knitAt = (y: number) =>
  PieceItem.make({
    id: Schema.decodeUnknownSync(BoardItemId)(`bi_${String(y).padEnd(22, 'x')}`),
    pieceId: navyKnit.id,
    x: 500,
    y,
    size: 400,
    turn: 0,
    z: 1,
    flipped: false,
  })
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

  test('Spin lays out clean drawings before photos once a slot has two of them, and photos with fewer', () => {
    expect(piecesOverSpins([...photoTops, drawnOxford, drawnPolo])).toEqual(new Set([drawnOxford.id, drawnPolo.id]))
    // One drawing alone would never let the top change, so every top still takes its turn.
    expect(piecesOverSpins([...photoTops, drawnOxford]).size).toBe(4)
  })

  test('the same day and Spin always lay out the same outfit', () => {
    expect(outfitFor(wardrobe, '2026-10-29:3')).toEqual(outfitFor(wardrobe, '2026-10-29:3'))
  })

  test('a wardrobe short of a whole outfit says what it lacks; a dress stands in for a top and a bottom', () => {
    expect(missingFrom([redTop])).toEqual(['bottom', 'shoes'])
    expect(missingFrom(wardrobe)).toEqual([])
    expect(missingFrom([pieceFixture('dress', { type: 'dresses' })])).toEqual(['shoes'])
  })

  test('the headline is the day in the visitor’s language', () => {
    expect(headline('2026-10-30', 'en')).toBe('FRI 30')
    expect(headline('2026-10-30', 'sl')).toBe('PET 30')
  })

  test("a board's card on Home shows the 16:10 window of its table where its pieces lie", () => {
    // A 400-unit piece near the top of the 1250-unit table: the window starts at the top.
    expect(cropFrom([knitAt(300)])).toBe(0)
    // Pieces too far apart for one window: one of them whole, the nearer the middle, rather than two slivers.
    expect(cropFrom([knitAt(300), knitAt(950)])).toBe(0.08)
    // Two that fit together (300 to 900): both whole, the window centred on them.
    expect(cropFrom([knitAt(500), knitAt(700)])).toBe(0.23)
    // One piece at the foot: the window ends at the foot.
    expect(cropFrom([knitAt(1050)])).toBe(0.5)
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
    pins: [],
    moods: [],
    visibility: 'private',
    check: null,
    updatedAt: '2026-10-30T08:00:00.000Z',
  })
  const listed = Schema.decodeUnknownSync(BoardSummary)({
    id: created.id,
    name: created.name,
    paper: created.paper,
    items: [],
    cover: [],
    pinCount: 0,
    visibility: 'private',
    updatedAt: created.updatedAt,
  })

  test('a new board takes the default name, and opens once it exists', () => {
    story(
      Boards.update,
      given(Boards.init()),
      message(Boards.Message.ClickedNewBoard({ defaultName: 'My board' })),
      Command.expectExact(Boards.CreateBoard({ name: 'My board' })),
      Command.resolve(Boards.CreateBoard, Boards.Message.SucceededCreateBoard({ board: created })),
      expectOutMessage(Boards.OutMessage.CreatedBoard({ boardId: created.id })),
      model(({ creating }) => expect(Boards.Creating.guards.Idle(creating)).toBe(true)),
    )
  })

  test('a board already being made is not asked for again', () => {
    story(
      Boards.update,
      given(modifyFields(Boards.init(), { creating: () => Boards.Creating.Sending() })),
      message(Boards.Message.ClickedNewBoard({ defaultName: 'My board' })),
      Command.expectNone(),
      model(({ creating }) => expect(Boards.Creating.guards.Sending(creating)).toBe(true)),
    )
  })

  test('a list that did not load asks again', () => {
    story(
      Boards.update,
      given(modifyFields(Boards.init(), { boards: () => Boards.BoardsData.Failure({ error: 'Unavailable' }) })),
      message(Boards.Message.ClickedRetry()),
      Command.expectExact(Boards.ListBoards),
      Command.resolve(Boards.ListBoards, Boards.Message.SucceededListBoards({ boards: [listed] })),
      model(({ boards }) => expect(boards).toEqual(Boards.BoardsData.Success({ data: [listed] }))),
    )
  })
})

describe('Ask', () => {
  test('search finds pieces by every word of the query: name, kind or colour, in the visitor’s language', () => {
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
