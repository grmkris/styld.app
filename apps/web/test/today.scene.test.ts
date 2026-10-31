import { BoardSummary, OutfitSession, outfitKeyOf } from '@styld/protocol'
import { Option, Result, Schema } from 'effect'
import { expect, given, inside, role, scene, selector } from 'foldkit/scene'
import { AsyncData } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { LastBoardData, OutfitsData, TrayData } from '../src/page/Today.ts'
import { PiecesData } from '../src/page/Wardrobe.ts'
import { view } from '../src/View.ts'
import { signedInAt } from './AppFixtures.ts'
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
  modifyFields(signedInAt('/'), {
    wardrobe: (wardrobe) => modifyFields(wardrobe, { pieces: () => PiecesData.Success({ data: [knit] }) }),
    today: (today) =>
      modifyFields(today, {
        tray: () => TrayData.Success({ data: { waiting, pictures } }),
        lastBoard: () => LastBoardData.Success({ data: maybeBoard }),
      }),
  })

/** Home with today's outfits as given. */
const withOutfits = (outfits: OutfitsData) =>
  modifyFields(home(0, Option.none()), {
    today: (today) => modifyFields(today, { outfits: () => outfits }),
  })

describe('Home', () => {
  test('the bar holds Home, Ask, Wardrobe and Boards, and Explore is the round in Home’s head', () => {
    scene(
      { update, view },
      given(home(0, Option.none())),
      inside(
        role('navigation', { name: 'Navigation' }),
        expect(role('link', { name: 'Home' })).toHaveAttr('aria-current', 'page'),
        expect(role('link', { name: 'Ask' })).toExist(),
        expect(role('link', { name: 'Wardrobe' })).toExist(),
        expect(role('link', { name: 'Boards' })).toExist(),
        expect(role('link', { name: 'Explore' })).not.toExist(),
      ),
      inside(role('main'), expect(role('link', { name: 'Explore' })).toHaveAttr('href', '/explore')),
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

  test('the tray card shows the first pieces waiting, on paper', () => {
    const cutout = `/cdn/detections/dt_${'tee'.padEnd(22, 'x')}/cutout`
    scene({ update, view }, given(home(2, Option.none(), [cutout])), expect(selector(`img[src="${cutout}"]`)).toExist())
  })

  test('with nothing waiting and no board on the go, there is nothing to pick up', () => {
    scene(
      { update, view },
      given(home(0, Option.none())),
      expect(role('region', { name: 'Pick up where you left off' })).not.toExist(),
    )
  })
})
