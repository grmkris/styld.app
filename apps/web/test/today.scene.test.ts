import { BoardSummary, Day, OutfitSession, outfitKeyOf } from '@styld/protocol'
import { Option, Result, Schema } from 'effect'
import { click, Command, expect, given, inside, role, scene, selector, text } from 'foldkit/scene'
import { AsyncData } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { FavouriteData, Message, OutfitsData, ReadWorn, SwapPiece, TrayData, Wear, Worn } from '../src/page/Today.ts'
import { view } from '../src/View.ts'
import { lenses } from '../src/Page.ts'
import { at, withBoards, withPage, withPieces } from './AppFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const knit = pieceFixture('knit', { name: 'Cable knit' })
const layers = Schema.decodeUnknownSync(BoardSummary)({
  id: `bd_${'layers'.padEnd(22, 'x')}`,
  name: 'Autumn layers',
  paper: 'sand',
  items: [
    {
      _tag: 'PieceItem',
      id: `bi_${'knit'.padEnd(22, 'x')}`,
      pieceId: knit.id,
      x: 500,
      y: 300,
      size: 400,
      turn: 0,
      z: 1,
      flipped: false,
    },
  ],
  cover: [],
  pinCount: 1,
  visibility: 'private',
  updatedAt: '2026-10-31T08:00:00.000Z',
})

/** Home with the wardrobe read, the tray holding `waiting` pieces and the last board, if any. */
const home = (waiting: number, maybeBoard: Option.Option<BoardSummary>, pictures: ReadonlyArray<string> = []) =>
  withPage(
    withBoards(withPieces(at('/', { signedIn: true }), [knit]), Option.toArray(maybeBoard)),
    lenses.today,
    (today) =>
      modifyFields(today, {
        tray: () => TrayData.Success({ data: { waiting, pictures } }),
        favourite: () => FavouriteData.Success({ data: Option.none() }),
      }),
  )

/** Home on a day already worn, with today's outfits as given. */
const wornWith = (outfits: OutfitsData) =>
  withPage(withOutfits(outfits), lenses.today, (today) =>
    modifyFields(today, { worn: () => Worn.Worn({ pieceIds: [knit.id] }) }),
  )

/** Home with today's outfits as given. */
const withOutfits = (outfits: OutfitsData) =>
  withPage(home(0, Option.none()), lenses.today, (today) => modifyFields(today, { outfits: () => outfits }))

const jeans = pieceFixture('jeans', { type: 'jeans' })
const trainers = pieceFixture('trainers', { type: 'trainers' })
const boots = pieceFixture('boots', { type: 'boots' })
const proposalOf = (pieces: ReadonlyArray<typeof knit>) => ({
  key: outfitKeyOf(pieces.map(({ id }) => id)),
  pieceIds: pieces.map(({ id }) => id),
  score: 0.8,
})
const thursday = Schema.decodeUnknownSync(Day)('2026-10-29')

/** Home on a known day with the knit, jeans and trainers on the table, and boots in the wardrobe. */
const dressed = () =>
  withPage(withPieces(home(0, Option.none()), [knit, jeans, trainers, boots]), lenses.today, (today) =>
    modifyFields(today, {
      maybeDay: () => Option.some(thursday),
      outfits: () =>
        OutfitsData.Success({
          data: {
            session: OutfitSession.make(`os_${'a'.repeat(22)}`),
            proposals: [proposalOf([knit, jeans, trainers])],
            at: 0,
            missing: [],
            exhausted: true,
            refilling: false,
          },
        }),
    }),
  )

describe('Home', () => {
  test('the bar holds Home, Ask, Wardrobe and the Lab, and Home’s head holds only the day', () => {
    scene(
      { update, view },
      given(home(0, Option.none())),
      inside(
        role('navigation', { name: 'Navigation' }),
        expect(role('link', { name: 'Home' })).toHaveAttr('aria-current', 'page'),
        expect(role('link', { name: 'Ask' })).toExist(),
        expect(role('link', { name: 'Wardrobe' })).toExist(),
        expect(role('link', { name: 'Lab' })).toHaveAttr('href', '/boards'),
        expect(role('link', { name: 'Explore' })).not.toExist(),
      ),
      inside(role('main'), expect(role('link', { name: 'Explore' })).not.toExist()),
    )
  })

  test('picking up says where the waiting pieces came from, and each card ends in its way back in', () => {
    scene(
      { update, view },
      given(home(69, Option.some(layers))),
      inside(
        role('region', { name: 'Pick up where you left off' }),
        expect(role('link', { name: 'Finish adding' })).toHaveAttr('href', '/wardrobe/review'),
        expect(role('link', { name: 'Finish adding' })).toHaveAccessibleDescription(
          '69 pieces from your scan to check',
        ),
        expect(role('link', { name: 'Keep pinning' })).toHaveAttr('href', `/boards/${layers.id}`),
        expect(role('link', { name: 'Keep pinning' })).toHaveAccessibleDescription('Autumn layers'),
      ),
    )
  })

  test('Wear this and Spin stand only beside an outfit: waiting shapes while one comes, none when it failed', () => {
    const outfit = {
      session: OutfitSession.make(`os_${'a'.repeat(22)}`),
      proposals: [{ key: outfitKeyOf([knit.id]), pieceIds: [knit.id], score: 0.8 }],
      at: 0,
      missing: [],
      exhausted: false,
      refilling: false,
    }
    scene(
      { update, view },
      given(withOutfits(AsyncData.Loading())),
      expect(role('button', { name: 'Wear this' })).not.toExist(),
      expect(selector('[data-skeleton]')).toExist(),
    )
    scene(
      { update, view },
      given(withOutfits(AsyncData.settle(AsyncData.Loading(), Result.fail('Unavailable' as const)))),
      expect(role('button', { name: 'Wear this' })).not.toExist(),
      expect(role('button', { name: 'Try again' })).toExist(),
      expect(selector('[data-skeleton]')).not.toExist(),
    )
    scene(
      { update, view },
      given(withOutfits(OutfitsData.Success({ data: outfit }))),
      expect(role('button', { name: 'Wear this' })).toExist(),
      expect(role('button', { name: 'Spin for another outfit' })).toExist(),
    )
  })

  test('on a worn day, Spin waits for today’s outfits, and stays away when they failed', () => {
    scene(
      { update, view },
      given(wornWith(AsyncData.Loading())),
      expect(role('button', { name: 'Worn today' })).toExist(),
      expect(role('button', { name: 'Spin for another outfit' })).not.toExist(),
    )
    scene(
      { update, view },
      given(wornWith(AsyncData.settle(AsyncData.Loading(), Result.fail('Unavailable' as const)))),
      expect(role('button', { name: 'Worn today' })).toExist(),
      expect(role('button', { name: 'Spin for another outfit' })).not.toExist(),
    )
  })

  test('a log of today that did not load says so, and Try again reads it again', () => {
    const unread = withPage(home(0, Option.none()), lenses.today, (today) =>
      modifyFields(today, { maybeDay: () => Option.some(thursday), worn: () => Worn.Unread() }),
    )
    scene(
      { update, view },
      given(unread),
      expect(text('Today’s log didn’t load.')).toExist(),
      click(role('button', { name: 'Try again' })),
      Command.resolve(ReadWorn, Message.FailedReadWorn()),
      expect(text('Today’s log didn’t load.')).toExist(),
      click(role('button', { name: 'Try again' })),
      Command.resolve(ReadWorn, Message.SucceededReadWorn({ pieceIds: [knit.id] })),
      expect(text('Today’s log didn’t load.')).not.toExist(),
      expect(role('button', { name: 'Worn today' })).toExist(),
    )
  })

  test('the tray card shows the first pieces waiting, on paper', () => {
    const cutout = `/cdn/detections/dt_${'tee'.padEnd(22, 'x')}/cutout`
    scene({ update, view }, given(home(2, Option.none(), [cutout])), expect(selector(`img[src="${cutout}"]`)).toExist())
  })

  test('the board to keep pinning is the newest with something on its table', () => {
    const empty = Schema.decodeUnknownSync(BoardSummary)({ ...layers, id: `bd_${'empty'.padEnd(22, 'x')}`, items: [] })
    scene(
      { update, view },
      given(withBoards(home(0, Option.none()), [empty, layers])),
      expect(role('link', { name: 'Keep pinning' })).toHaveAttr('href', `/boards/${layers.id}`),
    )
  })

  test('with nothing waiting and no board on the go, there is nothing to pick up', () => {
    scene(
      { update, view },
      given(home(0, Option.none())),
      expect(role('region', { name: 'Pick up where you left off' })).not.toExist(),
    )
  })

  test('one piece swaps for another while the rest stays, and Wear this then says the outfit is logged', () => {
    const from = outfitKeyOf([knit.id, jeans.id, trainers.id])
    scene(
      { update, view },
      given(dressed()),
      inside(
        role('group', { name: 'Swap one piece' }),
        expect(role('button', { name: 'Swap Cable knit' })).toExist(),
        expect(role('button', { name: 'Swap Jeans' })).toExist(),
        expect(role('button', { name: 'Swap Trainers' })).toExist(),
      ),
      click(role('button', { name: 'Swap Trainers' })),
      expect(role('button', { name: 'Swap Jeans' })).toHaveAttr('aria-disabled', 'true'),
      expect(role('button', { name: 'Wear this' })).toHaveAttr('aria-disabled', 'true'),
      Command.resolve(
        SwapPiece,
        Message.SucceededSwapPiece({ pieceId: trainers.id, from, proposals: [proposalOf([knit, jeans, boots])] }),
      ),
      expect(role('button', { name: 'Swap Boots' })).toExist(),
      expect(role('button', { name: 'Swap Trainers' })).not.toExist(),
      expect(role('button', { name: 'Swap Cable knit' })).toExist(),
      expect(role('img', { name: 'Today’s outfit: Cable knit, Jeans, Boots' })).toExist(),
      expect(role('status')).toHaveText(''),
      click(role('button', { name: 'Wear this' })),
      Command.resolve(Wear, Message.SucceededWear({ pieceIds: [knit.id, jeans.id, boots.id] })),
      expect(role('button', { name: 'Worn today' })).toExist(),
      expect(role('status')).toHaveText('Logged for today.'),
      expect(role('group', { name: 'Swap one piece' })).not.toExist(),
    )
  })

  test('a piece with nothing else to go with the rest stays, and the note says so', () => {
    scene(
      { update, view },
      given(dressed()),
      click(role('button', { name: 'Swap Trainers' })),
      Command.resolve(
        SwapPiece,
        Message.SucceededSwapPiece({
          pieceId: trainers.id,
          from: outfitKeyOf([knit.id, jeans.id, trainers.id]),
          proposals: [],
        }),
      ),
      expect(role('button', { name: 'Swap Trainers' })).toExist(),
      expect(role('status')).toHaveText('Trainers: nothing else fits this outfit.'),
    )
  })
})
