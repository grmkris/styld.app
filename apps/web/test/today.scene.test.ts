import { BoardSummary } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { expect, given, inside, role, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { LastBoardData, TrayData } from '../src/page/Today.ts'
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
const home = (waiting: number, maybeBoard: Option.Option<BoardSummary>) =>
  modifyFields(signedInAt('/'), {
    wardrobe: (wardrobe) => modifyFields(wardrobe, { pieces: () => PiecesData.Success({ data: [knit] }) }),
    today: (today) =>
      modifyFields(today, {
        tray: () => TrayData.Success({ data: waiting }),
        lastBoard: () => LastBoardData.Success({ data: maybeBoard }),
      }),
  })

describe('Home', () => {
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

  test('with nothing waiting and no board on the go, there is nothing to pick up', () => {
    scene(
      { update, view },
      given(home(0, Option.none())),
      expect(role('region', { name: 'Pick up where you left off' })).not.toExist(),
    )
  })
})
