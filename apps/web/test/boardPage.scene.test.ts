import { Board, BoardOutfitId } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { Dialog } from '@foldkit/ui'
import { click, Command, expect, given, Mount, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { Message as BoardMessage } from '../src/page/Board/Message.ts'
import { fromBoard, init as boardInit } from '../src/page/Board/Model.ts'
import { FocusPin, UnpinThings } from '../src/page/Board/PageCommands.ts'
import { view } from '../src/View.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage, withPieces } from './AppFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'
import { sceneSheetOpened } from './SheetFixtures.ts'
import { MeasurePaper } from '../src/page/Board/Commands.ts'
import { KeepOutfit, Message as OutfitsMessage } from '../src/page/Board/Outfits.ts'
import { Message as ShareMessage, ShareLink } from '../src/page/Share.ts'

const boardId = `bd_${'weekend'.padEnd(22, 'x')}`
const knit = pieceFixture('knit', { name: 'Cable knit' })
const board = Schema.decodeUnknownSync(Board)({
  id: boardId,
  name: 'Weekend',
  paper: 'paper',
  version: 1,
  items: [],
  pins: [{ _tag: 'PiecePin', id: `pn_${'knit'.padEnd(22, 'x')}`, piece: knit, addedAt: '2026-10-31T09:00:00.000Z' }],
  publicPins: [],
  moods: [],
  visibility: 'private',
  check: null,
  updatedAt: '2026-10-31T09:00:00.000Z',
})
const page = withPage(at(`/boards/${boardId}`, { signedIn: true }), lenses.board, () =>
  fromBoard(boardInit(boardId, true), board),
)

/** The board's page with its picker open over the person's pieces, in `locale`. */
const picking = (locale: 'en' | 'sl') =>
  withPieces(
    withPage(at(`/boards/${boardId}`, { signedIn: true, locale }), lenses.board, () =>
      modifyFields(fromBoard(boardInit(boardId, true), board), { picker: (picker) => ({ ...picker, isOpen: true }) }),
    ),
    [
      knit,
      pieceFixture('tee', { type: 'shirts', colours: ['white', 'blue'] }),
      pieceFixture('shoes', { type: 'flats', colours: ['black'] }),
    ],
  )

const measured = Mount.resolve(MeasurePaper, BoardMessage.MeasuredPaper({ width: 500 }))
const withSettings = (state: typeof page) =>
  withPage(state, lenses.board, (currentBoard) =>
    modifyFields(currentBoard, { settings: (settings) => ({ ...settings, isOpen: true }) }),
  )

describe("a board's page", () => {
  test('keeps the way back and says what it is doing while the board loads', () => {
    scene(
      { update, view },
      given(withPage(page, lenses.board, () => boardInit(boardId, true))),
      expect(role('status')).toHaveText('Opening your board…'),
      expect(role('link', { name: 'All boards' })).toHaveAttr('href', '/boards'),
      expect(role('heading', { level: 1 })).not.toExist(),
    )
  })

  test('says when visitors see fewer pins than are pinned, as the board it read says', () => {
    const shown = withPage(at(`/boards/${boardId}`, { signedIn: true }), lenses.board, () =>
      fromBoard(boardInit(boardId, true), { ...board, visibility: 'public', publicPins: [] }),
    )
    scene(
      { update, view },
      given(withSettings(shown)),
      measured,
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      expect(text('1 pin, 0 of them public on your profile')).toExist(),
      expect(text('Only you see this one until it has its own picture and passes Styld’s check')).toExist(),
    )
  })

  test('marks no pin when visitors see every one of them', () => {
    const shown = withPage(at(`/boards/${boardId}`, { signedIn: true }), lenses.board, () =>
      fromBoard(boardInit(boardId, true), {
        ...board,
        visibility: 'public',
        publicPins: board.pins.map(({ id }) => id),
      }),
    )
    scene(
      { update, view },
      given(withSettings(shown)),
      measured,
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      expect(text('1 pin, 0 of them public on your profile')).not.toExist(),
      expect(text('Only you see this one until it has its own picture and passes Styld’s check')).not.toExist(),
    )
  })

  test('Share on a public board shares its link, and says so where it was copied (T-20)', () => {
    const shown = withPage(at(`/boards/${boardId}`, { signedIn: true }), lenses.board, () =>
      fromBoard(boardInit(boardId, true), { ...board, visibility: 'public' }),
    )
    scene(
      { update, view },
      given(shown),
      measured,
      click(role('button', { name: 'Share' })),
      Command.resolve(
        ShareLink({ path: `/boards/${boardId}`, title: 'Weekend' }),
        ShareMessage.SucceededShareLink({ copied: true }),
      ),
      expect(role('status', { name: 'Link copied' })).toExist(),
    )
  })

  test('Share on a private board opens its settings, where it can be made public', () => {
    scene(
      { update, view },
      given(page),
      measured,
      click(role('button', { name: 'Share' })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      ...sceneSheetOpened,
      expect(role('dialog')).toExist(),
      expect(role('switch')).toExist(),
    )
  })

  test('opens the interactive canvas directly with a way back and its tools', () => {
    scene(
      { update, view },
      given(page),
      measured,
      expect(text('1 pin, only you can see it')).toExist(),
      expect(role('region', { name: 'The table' })).toExist(),
      expect(role('button', { name: 'Add your piece' })).toExist(),
      expect(role('link', { name: 'All boards' })).toHaveAttr('href', '/boards'),
      expect(role('link', { name: 'Edit collage' })).not.toExist(),
    )
  })

  test('asks before a pin comes off, since it leaves the collage too', () => {
    scene(
      { update, view },
      given(withSettings(page)),
      measured,
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      click(role('button', { name: 'Take Cable knit off the board' })),
      Command.resolve(FocusPin, BoardMessage.CompletedFocusPin()),
      expect(role('group', { name: 'Take Cable knit off the board' })).toHaveText(
        /Take it off the board\? It comes off the collage too\./,
      ),
      click(role('button', { name: 'Keep' })),
      Command.resolve(FocusPin, BoardMessage.CompletedFocusPin()),
      expect(role('button', { name: 'Keep' })).not.toExist(),
      click(role('button', { name: 'Take Cable knit off the board' })),
      Command.resolve(FocusPin, BoardMessage.CompletedFocusPin()),
      click(role('button', { name: 'Take off' })),
      Command.expectExact(UnpinThings),
      Command.resolve(UnpinThings, BoardMessage.SucceededPins({ board: { ...board, pins: [], version: 2 } })),
      expect(role('button', { name: 'Take Cable knit off the board' })).not.toExist(),
    )
  })

  test('the picker tells each piece apart by its name, or what it is and its colours', () => {
    scene(
      { update, view },
      given(picking('en')),
      measured,
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      expect(role('button', { name: 'Shirt (white and blue)' })).toExist(),
      expect(role('button', { name: 'Flats (black)' })).toExist(),
    )
    scene(
      { update, view },
      given(picking('sl')),
      measured,
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      expect(role('button', { name: 'Srajca (bela in modra)' })).toExist(),
      expect(role('button', { name: 'Balerinke (črna)' })).toExist(),
    )
  })
})

describe('a "One piece, six outfits" board (T-10)', () => {
  const jeans = pieceFixture('jeans', { type: 'jeans', name: 'Dark jeans' })
  const outfit = (seed: string, lookId: string | null) => ({
    id: `bo_${seed.padEnd(22, 'x')}`,
    pieces: [pieceFixture(`${seed}-tee`, { type: 'tops' }), jeans, pieceFixture(`${seed}-shoes`, { type: 'trainers' })],
    lookId,
    session: `os_${'run'.padEnd(22, 'x')}`,
    mode: 'fast',
  })
  const outfitBoard = (anchor: typeof jeans | null) =>
    withPage(at(`/boards/${boardId}`, { signedIn: true }), lenses.board, () =>
      fromBoard(boardInit(boardId, true), {
        ...board,
        name: 'Jeans: six outfits',
        outfitsAround: Schema.decodeUnknownSync(Board.fields.outfitsAround)({
          anchor,
          outfits: [outfit('a', null), outfit('b', `lk_${'kept'.padEnd(22, 'x')}`)],
        }),
      }),
    )

  test('shows each outfit as a card under the table: Keep and Another, or the look it became; fewer than six said', () => {
    scene(
      { update, view },
      given(outfitBoard(jeans)),
      measured,
      expect(role('heading', { name: 'Six outfits' })).toExist(),
      expect(text('Your wardrobe made 2 outfits around this piece. Add shoes and accessories for more.')).toExist(),
      expect(role('img', { name: 'Outfit 1' })).toExist(),
      expect(role('button', { name: 'Keep' })).toExist(),
      expect(role('button', { name: 'Another' })).not.toHaveAttr('aria-disabled', 'true'),
      expect(role('link', { name: 'Open the look' })).toHaveAttr('href', `/looks/lk_${'kept'.padEnd(22, 'x')}`),
      click(role('button', { name: 'Keep' })),
      Command.expectHas(KeepOutfit),
      expect(role('button', { name: 'Keeping…' })).toHaveAttr('aria-disabled', 'true'),
      Command.resolve(
        KeepOutfit,
        OutfitsMessage.FailedKeep({
          outfitId: BoardOutfitId.make(`bo_${'a'.padEnd(22, 'x')}`),
          problem: 'failed',
          operationId: Option.none(),
        }),
      ),
      expect(role('alert')).toHaveText('That didn’t go through. Try again.'),
      expect(role('button', { name: 'Keep' })).not.toHaveAttr('aria-disabled', 'true'),
    )
  })

  test('says when its piece was deleted, and offers no other outfit', () => {
    scene(
      { update, view },
      given(outfitBoard(null)),
      measured,
      expect(text('The piece this board was built around was deleted. Its outfits stay.')).toExist(),
      expect(role('button', { name: 'Another' })).toHaveAttr('aria-disabled', 'true'),
    )
  })
})
