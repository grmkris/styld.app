import {
  Board,
  BoardItemId,
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
import * as BoardStart from '../src/page/BoardStart.ts'
import * as Today from '../src/page/Today.ts'
import { cropFrom } from '../src/page/PickUpView.ts'
import { headline } from '../src/page/TodayView.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const redTop = pieceFixture('red-top', { type: 'shortSleeveTops', colours: ['red'], name: 'Red shirt' })
const navyKnit = pieceFixture('navy-knit', { type: 'shortSleeveTops', colours: ['navy'], name: 'Cable knit' })
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
        Today.MakeOutfits({
          day: thursday,
          brief: { season: 'autumn' },
          session: Option.none(),
          seen: [],
          anchor: Option.none(),
        }),
        Today.ReadWorn({ day: thursday }),
      ),
      Command.resolve(Today.MakeOutfits, Today.Message.SucceededMakeOutfits({ batch: batchOf(outfits) })),
      Command.resolve(Today.ReadWorn, Today.Message.SucceededReadWorn({ pieceIds: [] })),
      model((current) => expect(Today.tableOutfit(current, wardrobe)).toEqual([navyKnit, greenTrousers, blackShoes])),
    )
    expect(Today.briefFor(Schema.decodeUnknownSync(Day)('2026-11-02'))).toEqual({ season: 'autumn' })
    expect(Today.briefFor(Schema.decodeUnknownSync(Day)('2026-07-14'))).toEqual({ season: 'summer' })
    expect(Today.briefFor(Schema.decodeUnknownSync(Day)('2026-01-20'))).toEqual({ season: 'winter' })
    expect(Today.briefFor(Schema.decodeUnknownSync(Day)('2026-04-02'))).toEqual({ season: 'spring' })
  })

  test('Spin walks the batch and asks for more, naming what was shown, while two are left', () => {
    story(
      Today.update,
      given(spun()),
      message(Today.Message.ClickedSpin()),
      Command.expectExact(
        Today.MakeOutfits({
          day: thursday,
          brief: { season: 'autumn' },
          session: Option.some(session),
          seen: outfits.map(({ key }) => key),
          anchor: Option.none(),
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
      Command.expectExact(
        Today.MakeOutfits({
          day: thursday,
          brief: { season: 'autumn' },
          session: Option.none(),
          seen: [],
          anchor: Option.none(),
        }),
      ),
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

  test('swapping one piece locks the others, keeps them on the table, and Wear this reports the outfit as edited', () => {
    const ready = spun()
    const shown = [navyKnit, greenTrousers, blackShoes].map(({ id }) => id)
    const from = outfitKeyOf(shown)
    const swappedIn = [redTop.id, greenTrousers.id, blackShoes.id]
    const coat = pieceFixture('camel-coat', { type: 'coats', colours: ['beige'], name: 'Camel coat' })
    story(
      Today.update,
      given(ready),
      message(Today.Message.ClickedSwapPiece({ pieceId: navyKnit.id, pieceIds: shown })),
      Command.expectExact(
        Today.SwapPiece({
          day: thursday,
          brief: { season: 'autumn' },
          session,
          lockedPieceIds: [greenTrousers.id, blackShoes.id],
          seen: outfits.map(({ key }) => key),
          pieceId: navyKnit.id,
          from,
          anchor: Option.none(),
        }),
      ),
      model((current) => expect(Today.Swap.guards.Swapping(current.swap)).toBe(true)),
      // The first still wears the knit, the second brings a coat besides; the third swaps the knit alone.
      Command.resolve(
        Today.SwapPiece,
        Today.Message.SucceededSwapPiece({
          pieceId: navyKnit.id,
          from,
          proposals: [
            proposal([navyKnit, greenTrousers, blackShoes, coat]),
            proposal([redTop, greenTrousers, coat, blackShoes]),
            proposal([redTop, greenTrousers, blackShoes]),
          ],
        }),
      ),
      model((current) => {
        expect(Today.tableOutfit(current, [...wardrobe, coat])).toEqual([redTop, greenTrousers, blackShoes])
        expect(Today.Swap.guards.Idle(current.swap)).toBe(true)
      }),
      message(Today.Message.ClickedWear({ pieceIds: swappedIn })),
      Command.expectExact(
        Today.Wear({
          day: thursday,
          pieceIds: swappedIn,
          proposal: Option.some({ session, mode: 'fast', position: 0, edited: true }),
        }),
      ),
      Command.resolve(Today.Wear, Today.Message.SucceededWear({ pieceIds: swappedIn })),
    )
  })

  test('a swap that only keeps the piece or leaves its place empty changes nothing and says so; one overtaken by Spin is dropped', () => {
    const shown = [navyKnit, greenTrousers, blackShoes].map(({ id }) => id)
    const from = outfitKeyOf(shown)
    story(
      Today.update,
      given(spun()),
      message(Today.Message.ClickedSwapPiece({ pieceId: blackShoes.id, pieceIds: shown })),
      Command.resolve(
        Today.SwapPiece,
        Today.Message.SucceededSwapPiece({
          pieceId: blackShoes.id,
          from,
          proposals: [proposal([navyKnit, greenTrousers, blackShoes, redTop]), proposal([navyKnit, greenTrousers])],
        }),
      ),
      model((current) => {
        expect(Today.tableOutfit(current, wardrobe)).toEqual([navyKnit, greenTrousers, blackShoes])
        expect(current.swap).toEqual(Today.Swap.NoOther({ pieceId: blackShoes.id }))
      }),
      message(Today.Message.ClickedSpin()),
      Command.resolve(Today.MakeOutfits, Today.Message.SucceededMakeOutfits({ batch: batchOf([]) })),
      message(
        Today.Message.SucceededSwapPiece({
          pieceId: blackShoes.id,
          from,
          proposals: [proposal([navyKnit, greenTrousers, redTop])],
        }),
      ),
      model((current) => {
        expect(Today.tableOutfit(current, wardrobe)).toEqual([redTop, greenTrousers, blackShoes])
        expect(Today.Swap.guards.Idle(current.swap)).toBe(true)
      }),
    )
  })

  test('an outfit with more pieces than the engine locks offers no swap', () => {
    const many = Array.from({ length: 7 }, (_, at) => pieceFixture(`many-${String(at)}`, { type: 'shortSleeveTops' }))
    const big = modifyFields(spun(), {
      outfits: () =>
        Today.OutfitsData.Success({
          data: { session, proposals: [proposal(many)], at: 0, missing: [], exhausted: true, refilling: false },
        }),
    })
    expect(Today.canSwap(big, many)).toBe(false)
    expect(Today.canSwap(big, many.slice(0, 6))).toBe(true)
    const [first] = many
    if (first === undefined) {
      throw new Error('the outfit has pieces')
    }
    story(
      Today.update,
      given(big),
      message(Today.Message.ClickedSwapPiece({ pieceId: first.id, pieceIds: many.map(({ id }) => id) })),
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
    publicPins: [],
    moods: [],
    visibility: 'private',
    check: null,
    updatedAt: '2026-10-30T08:00:00.000Z',
  })

  test('New board opens the new-board sheet instead of making a board (F-26)', () => {
    const opened = Boards.update(Boards.init(), Boards.Message.ClickedNewBoard())
    expect(opened.model.start.sheet.isOpen).toBe(true)
    expect(Boards.Creating.guards.Idle(opened.model.creating)).toBe(true)
    expect((opened.commands ?? []).map(({ name }) => name)).not.toContain('CreateBoard')
  })

  test('Blank in the sheet takes the default name, and the board opens once it exists', () => {
    const opened = Boards.update(Boards.init(), Boards.Message.ClickedNewBoard()).model
    const blank = Boards.update(
      opened,
      Boards.Message.GotStartMessage({ message: BoardStart.Message.ClickedBlank({ defaultName: 'My board' }) }),
    )
    expect(blank.model.start.sheet.isOpen).toBe(false)
    expect((blank.commands ?? []).find(({ name }) => name === 'CreateBoard')?.args).toEqual(
      Boards.CreateBoard({ name: 'My board', maybeOperationId: Option.none() }).args,
    )
    const made = Boards.update(blank.model, Boards.Message.SucceededCreateBoard({ board: created }))
    expect(made.outMessage).toEqual(Boards.OutMessage.CreatedBoard({ boardId: created.id }))
    expect(Boards.Creating.guards.Idle(made.model.creating)).toBe(true)
  })

  test('Start a board in Ask opens the sheet once Boards is entered, and only then (F-26)', () => {
    const asked = Boards.startOnEnter(Boards.init()).model
    expect(asked.start.sheet.isOpen).toBe(false)
    const entered = Boards.revisit(asked).model
    expect(entered.start.sheet.isOpen).toBe(true)
    expect(entered.startOnEnter).toBe(false)
    expect(Boards.revisit(Boards.init()).model.start.sheet.isOpen).toBe(false)
  })

  test('a board already being made is not asked for again', () => {
    const sending = modifyFields(Boards.init(), { creating: () => Boards.Creating.Sending() })
    expect(Boards.startBoard('My board')(sending).commands ?? []).toEqual([])
  })

  test('a list that did not load is asked of the app again', () => {
    story(
      Boards.update,
      given(Boards.init()),
      message(Boards.Message.ClickedRetry()),
      Command.expectNone(),
      expectOutMessage(Boards.OutMessage.RequestedBoards()),
      model((current) => expect(current).toEqual(Boards.init())),
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
      (current: Ask.Model, next: Ask.Message) => Ask.update(current, next, { query: '' }),
      given(Ask.init()),
      message(Ask.Message.ClickedRetry()),
      expectOutMessage(Ask.OutMessage.RequestedPieces()),
      model((current) => expect(current).toEqual(Ask.init())),
    )
  })
})
