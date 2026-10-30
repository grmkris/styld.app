import { Option } from 'effect'
import { AsyncData } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { ListPieces, Message, PiecesData, init, revisit, update } from '../src/page/Wardrobe.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const ready = pieceFixture('ready', { name: 'White tee' })
const processing = pieceFixture('processing', { status: 'processing' })
const showing = (...pieces: Parameters<typeof PiecesData.Success>[0]['data']) =>
  modifyFields(init(), { pieces: () => PiecesData.Success({ data: pieces }) })

describe('the wardrobe keeps its pieces current', () => {
  test('a first visit asks for the pieces; coming back keeps them on screen while they are asked for again', () => {
    const first = revisit(init())
    expect(AsyncData.isLoading(first.model.pieces)).toBe(true)
    expect(first.commands?.map(({ name }) => name)).toEqual(['ListPieces'])
    const again = revisit(showing(ready))
    expect(again.model.pieces).toEqual(PiecesData.Refreshing({ data: [ready] }))
    expect(again.commands?.map(({ name }) => name)).toEqual(['ListPieces'])
    // A request already on its way is not sent twice.
    expect(revisit(again.model).commands ?? []).toEqual([])
  })

  test('while a piece is processing, each tick asks again, and the list settles once none is', () => {
    story(
      update,
      given(showing(processing, ready)),
      message(Message.TickedRefresh()),
      model(({ pieces }) => expect(AsyncData.isRefreshing(pieces)).toBe(true)),
      Command.expectExact(ListPieces),
      Command.resolve(
        ListPieces,
        Message.SucceededListPieces({ pieces: [pieceFixture('processing', { status: 'ready' }), ready] }),
      ),
      Command.expectNone(),
      model(({ pieces }) =>
        expect(Option.map(AsyncData.getData(pieces), (list) => list.length)).toEqual(Option.some(2)),
      ),
    )
  })

  test('a failed refresh keeps the pieces already shown', () => {
    story(
      update,
      given(showing(processing)),
      message(Message.TickedRefresh()),
      Command.resolve(ListPieces, Message.FailedListPieces()),
      model(({ pieces }) => expect(pieces).toEqual(PiecesData.Stale({ error: 'Unavailable', data: [processing] }))),
    )
  })

  test('a wardrobe that cannot load says so and loads again on retry', () => {
    story(
      update,
      given(revisit(init()).model),
      message(Message.FailedListPieces()),
      model(({ pieces }) => expect(AsyncData.isFailure(pieces)).toBe(true)),
      message(Message.ClickedRetry()),
      model(({ pieces }) => expect(AsyncData.isLoading(pieces)).toBe(true)),
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
