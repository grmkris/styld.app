import {
  Board,
  BoardItemId,
  BoardSummary,
  Day,
  OutfitProposals,
  OutfitSession,
  outfitKeyOf,
  type Piece,
  PieceItem,
} from '@styld/protocol'
import { Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import * as Ask from '../src/page/Ask.ts'
import { matching } from '../src/page/AskSearch.ts'
import * as Boards from '../src/page/Boards.ts'
import * as Today from '../src/page/Today.ts'
import { cropFrom, headline } from '../src/page/TodayView.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const redTop = pieceFixture('red-top', { type: 'tops', colours: ['red'], name: 'Red shirt' })
const navyKnit = pieceFixture('navy-knit', { type: 'tops', colours: ['navy'], name: 'Cable knit' })
const greenTrousers = pieceFixture('green-trousers', { type: 'trousers', colours: ['green'], name: 'Green trousers' })
const blackShoes = pieceFixture('black-shoes', { type: 'trainers', colours: ['black'], name: 'Derby shoes' })
const wardrobe = [redTop, navyKnit, greenTrousers, blackShoes]
const thursday = Schema.decodeUnknownSync(Day)('2026-10-29')
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

const session = OutfitSession.make(`os_${'a'.repeat(22)}`)
const proposal = (pieces: ReadonlyArray<Piece>) => ({
  key: outfitKeyOf(pieces.map(({ id }) => id)),
  pieceIds: pieces.map(({ id }) => id),
  score: 0.8,
})
const outfits = [
  [navyKnit, greenTrousers, blackShoes],
  [redTop, greenTrousers, blackShoes],
  [navyKnit, blackShoes],
].map(proposal)
const batchOf = (proposals: ReadonlyArray<ReturnType<typeof proposal>>, exhausted = false) =>
  Schema.decodeUnknownSync(OutfitProposals)({ session, mode: 'fast', proposals, missing: [], exhausted })
const withDay = modifyFields(Today.init(), { maybeDay: () => Option.some(thursday) })
/** Home with the day known and a first batch of outfits on the table. */
const spun = (exhausted = false) =>
  modifyFields(withDay, {
    outfits: () =>
      Today.OutfitsData.Success({
        data: { session, proposals: outfits, at: 0, missing: [], exhausted, refilling: false },
      }),
  })

describe("today's table", () => {
  test('a known day asks the engine for today’s outfits, for the weather of its month, and reads what was worn', () => {
    story(
      Today.update,
      given(Today.init()),
      message(Today.Message.CompletedDetermineDay({ day: thursday })),
      Command.expectExact(
        Today.MakeOutfits({ day: thursday, brief: {}, session: Option.none(), seen: [] }),
        Today.ReadWorn({ day: thursday }),
      ),
      Command.resolve(Today.MakeOutfits, Today.Message.SucceededMakeOutfits({ batch: batchOf(outfits) })),
      Command.resolve(Today.ReadWorn, Today.Message.SucceededReadWorn({ pieceIds: [] })),
      model((current) => expect(Today.tableOutfit(current, wardrobe)).toEqual([navyKnit, greenTrousers, blackShoes])),
    )
    expect(Today.briefFor(Schema.decodeUnknownSync(Day)('2026-11-02'))).toEqual({ season: 'cold' })
    expect(Today.briefFor(Schema.decodeUnknownSync(Day)('2026-07-14'))).toEqual({ season: 'warm' })
  })

  test('Spin walks the batch and asks for more, naming what was shown, while two are left', () => {
    story(
      Today.update,
      given(spun()),
      message(Today.Message.ClickedSpin()),
      Command.expectExact(
        Today.MakeOutfits({
          day: thursday,
          brief: {},
          session: Option.some(session),
          seen: outfits.map(({ key }) => key),
        }),
      ),
      model((current) => expect(Today.tableOutfit(current, wardrobe)).toEqual([redTop, greenTrousers, blackShoes])),
      Command.resolve(
        Today.MakeOutfits,
        Today.Message.SucceededMakeOutfits({ batch: batchOf([proposal([redTop, blackShoes])], true) }),
      ),
      message(Today.Message.ClickedSpin()),
      message(Today.Message.ClickedSpin()),
      Command.expectNone(),
      model((current) => expect(Today.tableOutfit(current, wardrobe)).toEqual([redTop, blackShoes])),
    )
  })

  test('a run with nothing more to propose goes round again from its first outfit', () => {
    story(
      Today.update,
      given(spun(true)),
      message(Today.Message.ClickedSpin()),
      message(Today.Message.ClickedSpin()),
      message(Today.Message.ClickedSpin()),
      Command.expectNone(),
      model((current) => expect(Today.tableOutfit(current, wardrobe)).toEqual([navyKnit, greenTrousers, blackShoes])),
    )
  })

  test('outfits that never came offer to try again', () => {
    story(
      Today.update,
      given(modifyFields(withDay, { outfits: () => AsyncData.Loading() })),
      message(Today.Message.FailedMakeOutfits()),
      model((current) => expect(AsyncData.isFailure(current.outfits)).toBe(true)),
      message(Today.Message.ClickedRetryOutfits()),
      Command.expectExact(Today.MakeOutfits({ day: thursday, brief: {}, session: Option.none(), seen: [] })),
      Command.resolve(Today.MakeOutfits, Today.Message.SucceededMakeOutfits({ batch: batchOf(outfits) })),
      model((current) => expect(AsyncData.isSuccess(current.outfits)).toBe(true)),
    )
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

  test('Wear this records the outfit on the table for today, once, with the proposal it came from', () => {
    const ready = spun()
    const worn = Today.tableOutfit(ready, wardrobe).map(({ id }) => id)
    story(
      Today.update,
      given(ready),
      message(Today.Message.ClickedWear({ pieceIds: worn })),
      Command.expectExact(
        Today.Wear({
          day: thursday,
          pieceIds: worn,
          proposal: Option.some({ session, mode: 'fast', position: 0, edited: false }),
        }),
      ),
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
