import { Option } from 'effect'
import { AsyncData } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import {
  DrawPictures,
  ListPieces,
  Message,
  PiecesData,
  enter,
  init,
  revisit,
  subscriptions,
  update,
} from '../src/page/Wardrobe.ts'
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

  test('a group, then one of its types, filters the grid; another group starts from all its types', () => {
    story(
      update,
      given(init()),
      message(Message.ClickedGroup({ group: Option.some('shoes') })),
      message(Message.ClickedType({ type: Option.some('boots') })),
      model(({ group, type }) => {
        expect(group).toEqual(Option.some('shoes'))
        expect(type).toEqual(Option.some('boots'))
      }),
      message(Message.ClickedGroup({ group: Option.some('clothing') })),
      model(({ type }) => expect(type).toEqual(Option.none())),
      message(Message.ClickedGroup({ group: Option.none() })),
      model(({ group }) => expect(group).toEqual(Option.none())),
    )
  })
})

/** Whether the wardrobe asks for its pieces again on each tick. */
const refreshing = (current: Parameters<typeof update>[0]) =>
  subscriptions.refreshWhileProcessing.modelToDependencies(current).isActive
const drawn = (state: 'drawing' | 'ready') => pieceFixture('drawn', { picture: { state, shows: 'photo', version: 0 } })

describe('clean pictures for the pieces that have none', () => {
  test('the wardrobe page counts them, and one tap asks for all of them and reads the pieces again', () => {
    expect(enter(init()).commands?.map(({ name }) => name)).toEqual(['ListPieces', 'CountUndrawn'])
    const counted = update(showing(ready), Message.CompletedCountUndrawn({ pieces: 4 })).model
    expect(counted.undrawn).toBe(4)
    const sending = update(counted, Message.ClickedDrawPictures()).model
    expect(update(sending, Message.ClickedDrawPictures()).commands ?? []).toEqual([])
    story(
      update,
      given(counted),
      message(Message.ClickedDrawPictures()),
      Command.expectExact(DrawPictures),
      Command.resolve(DrawPictures, Message.SucceededDrawPictures()),
      model(({ undrawn, backfill }) => expect({ undrawn, backfill }).toEqual({ undrawn: 0, backfill: 'sent' })),
      Command.expectExact(ListPieces),
      Command.resolve(ListPieces, Message.SucceededListPieces({ pieces: [ready] })),
    )
  })

  test('the pieces are asked for again while a drawing is on its way, and not once it is done', () => {
    expect(refreshing(showing(drawn('drawing'), ready))).toBe(true)
    expect(refreshing(showing(drawn('ready'), ready))).toBe(false)
  })
})
