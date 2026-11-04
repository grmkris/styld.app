import { Board, BoardOutfitId, OperationId, outfitKeyOf, OutfitSession } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import * as Outfits from '../src/page/Board/Outfits.ts'
import {
  CardWork,
  init,
  KeepOutfit,
  Message,
  OutMessage,
  ReplaceOutfit,
  withBoard,
  workOf,
} from '../src/page/Board/Outfits.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const jeans = pieceFixture('jeans', { type: 'jeans' })
const tee = pieceFixture('tee', { type: 'tops' })
const shirt = pieceFixture('shirt', { type: 'shirts' })
const trainers = pieceFixture('trainers', { type: 'trainers' })
const bag = pieceFixture('bag', { type: 'bags' })
const session = OutfitSession.make(`os_${'run'.padEnd(22, 'x')}`)
const outfitId = (seed: string) => BoardOutfitId.make(`bo_${seed.padEnd(22, 'x')}`)
const first = { id: outfitId('first'), pieces: [tee, jeans, trainers, bag], lookId: null, session, mode: 'fast' }
const second = { id: outfitId('second'), pieces: [shirt, jeans, trainers, bag], lookId: null, session, mode: 'fast' }
const keyOf = (pieces: ReadonlyArray<{ readonly id: string }>) => outfitKeyOf(pieces.map(({ id }) => id))

const board = Schema.decodeUnknownSync(Board)({
  id: `bd_${'jeans'.padEnd(22, 'x')}`,
  name: 'Jeans: six outfits',
  paper: 'sand',
  version: 0,
  items: [],
  pins: [],
  publicPins: [],
  moods: [],
  visibility: 'private',
  check: null,
  updatedAt: '2026-11-04T08:00:00.000Z',
  outfitsAround: { anchor: jeans, outfits: [first, second] },
})
const open = withBoard(init(board.id), board)
const operationId = Schema.decodeUnknownSync(OperationId)('kept-once-1234')

describe('the outfits of a "One piece, six outfits" board (T-10)', () => {
  test('the board’s outfits are the cards, every one of them shown; a blank board has none', () => {
    expect(Option.map(open.maybeAround, ({ outfits }) => outfits.length)).toEqual(Option.some(2))
    expect(open.shown).toEqual([keyOf(first.pieces), keyOf(second.pieces)])
    const { outfitsAround: _, ...blank } = board
    expect(Option.isNone(withBoard(init(board.id), blank).maybeAround)).toBe(true)
  })

  test('Keep keeps the card’s pieces as a look named after the board and its place, counted, and the board changes', () => {
    const kept = Schema.decodeUnknownSync(Board)({
      ...board,
      outfitsAround: { anchor: jeans, outfits: [first, { ...second, lookId: `lk_${'look'.padEnd(22, 'x')}` }] },
    })
    story(
      Outfits.update,
      given(open),
      message(Message.ClickedKeep({ outfitId: second.id, name: 'Jeans: six outfits · 2' })),
      Command.expectExact(
        KeepOutfit({
          boardId: board.id,
          outfitId: second.id,
          name: 'Jeans: six outfits · 2',
          pieceIds: second.pieces.map(({ id }) => id),
          proposal: { session, mode: 'fast', position: 1, edited: false },
          operationId: Option.none(),
        }),
      ),
      model((current) => expect(workOf(current, second.id)).toEqual(Option.some(CardWork.Keeping()))),
      Command.resolve(KeepOutfit, Message.SucceededKeep({ outfitId: second.id, board: kept })),
      expectOutMessage(OutMessage.ChangedBoard({ board: kept })),
      model((current) => {
        expect(Option.isNone(workOf(current, second.id))).toBe(true)
        expect(Option.map(current.maybeAround, ({ outfits }) => outfits[1]?.lookId)).toEqual(
          Option.some(`lk_${'look'.padEnd(22, 'x')}`),
        )
      }),
    )
  })

  test('a card being kept takes no other ask until it is done', () => {
    const keeping = Outfits.update(open, Message.ClickedKeep({ outfitId: first.id, name: 'Jeans: six outfits · 1' }))
    expect(Outfits.update(keeping.model, Message.ClickedAnother({ outfitId: first.id })).commands ?? []).toEqual([])
    expect(
      Outfits.update(keeping.model, Message.ClickedKeep({ outfitId: first.id, name: 'Jeans: six outfits · 1' }))
        .commands ?? [],
    ).toEqual([])
  })

  test('a keep that may have reached Styld is asked again under its operation id, so it is never kept twice', () => {
    story(
      Outfits.update,
      given(open),
      message(Message.FailedKeep({ outfitId: first.id, problem: 'failed', operationId: Option.some(operationId) })),
      message(Message.ClickedKeep({ outfitId: first.id, name: 'Jeans: six outfits · 1' })),
      Command.expectExact(
        KeepOutfit({
          boardId: board.id,
          outfitId: first.id,
          name: 'Jeans: six outfits · 1',
          pieceIds: first.pieces.map(({ id }) => id),
          proposal: { session, mode: 'fast', position: 0, edited: false },
          operationId: Option.some(operationId),
        }),
      ),
      Command.resolve(KeepOutfit, Message.SucceededKeep({ outfitId: first.id, board })),
      expectOutMessage(OutMessage.ChangedBoard({ board })),
      model((current) => expect(Option.isNone(workOf(current, first.id))).toBe(true)),
    )
  })

  test('Another names every combination shown, and says when the wardrobe has no other outfit', () => {
    story(
      Outfits.update,
      given(open),
      message(Message.ClickedAnother({ outfitId: first.id })),
      Command.expectExact(
        ReplaceOutfit({
          boardId: board.id,
          outfitId: first.id,
          seen: [keyOf(first.pieces), keyOf(second.pieces)],
          operationId: Option.none(),
        }),
      ),
      model((current) => expect(workOf(current, first.id)).toEqual(Option.some(CardWork.Replacing()))),
      Command.resolve(
        ReplaceOutfit,
        Message.FailedAnother({ outfitId: first.id, problem: 'noMore', operationId: Option.none() }),
      ),
      model((current) =>
        expect(workOf(current, first.id)).toEqual(
          Option.some(CardWork.Failed({ asked: 'another', problem: 'noMore', operationId: Option.none() })),
        ),
      ),
    )
  })
})
