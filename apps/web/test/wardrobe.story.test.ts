import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { ListPieces, Message, Pieces, WaitToRefresh, init, update } from '../src/page/Wardrobe.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const ready = pieceFixture('ready', { name: 'White tee' })
const processing = pieceFixture('processing', { status: 'processing' })

describe('the wardrobe keeps its pieces current', () => {
  test('a piece still processing brings the list back until none is', () => {
    story(
      update,
      given(init()),
      message(Message.SucceededListPieces({ pieces: [processing, ready] })),
      Command.expectExact(WaitToRefresh),
      Command.resolve(WaitToRefresh, Message.ElapsedRefreshPause()),
      Command.expectExact(ListPieces),
      Command.resolve(
        ListPieces,
        Message.SucceededListPieces({ pieces: [pieceFixture('processing', { status: 'ready' }), ready] }),
      ),
      Command.expectNone(),
      model(({ pieces }) => expect(Pieces.guards.Loaded(pieces) && pieces.pieces.length).toBe(2)),
    )
  })

  test('a failed refresh keeps the pieces already shown', () => {
    story(
      update,
      given(init()),
      message(Message.SucceededListPieces({ pieces: [processing] })),
      Command.resolve(WaitToRefresh, Message.ElapsedRefreshPause()),
      Command.resolve(ListPieces, Message.FailedListPieces()),
      model(({ pieces }) => expect(Pieces.guards.Loaded(pieces)).toBe(true)),
    )
  })

  test('a wardrobe that cannot load says so and loads again on retry', () => {
    story(
      update,
      given(init()),
      message(Message.FailedListPieces()),
      model(({ pieces }) => expect(Pieces.guards.Failed(pieces)).toBe(true)),
      message(Message.ClickedRetry()),
      model(({ pieces }) => expect(Pieces.guards.Loading(pieces)).toBe(true)),
      Command.expectExact(ListPieces),
      Command.resolve(ListPieces, Message.SucceededListPieces({ pieces: [] })),
    )
  })

  test('a category chip filters the grid and All shows everything again', () => {
    story(
      update,
      given(init()),
      message(Message.ClickedCategory({ category: Option.some('shoes') })),
      model(({ category }) => expect(category).toEqual(Option.some('shoes'))),
      message(Message.ClickedCategory({ category: Option.none() })),
      model(({ category }) => expect(category).toEqual(Option.none())),
    )
  })
})
