import { Option } from 'effect'
import { AsyncData } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { subscriptions as appSubscriptions } from '../src/App.ts'
import {
  BoardsData,
  init,
  ListBoards,
  ListPieces,
  Message,
  type Model,
  PiecesData,
  revisitBoards,
  revisitPieces,
  subscriptions,
  update,
} from '../src/ServerData.ts'
import { at, withPieces } from './AppFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'
import { boardSummaryFixture } from './BoardFixtures.ts'

const ready = pieceFixture('ready', { name: 'White tee' })
const processing = pieceFixture('processing', { status: 'processing' })
const showing = (...pieces: ReadonlyArray<typeof ready>): Model =>
  modifyFields(init(), { pieces: () => PiecesData.Success({ data: pieces }) })

/** The ids the pieces' poll waits on, or none while it does not run. */
const pending = (current: Model) => subscriptions.piecesWhileSettling.modelToDependencies(current).pendingIds

/** A piece whose clean picture is being drawn, or is drawn. */
const drawn = (state: 'drawing' | 'ready') => pieceFixture('drawn', { picture: { state, shows: 'photo', version: 0 } })

/** What the app's poll of the pieces waits on, at a path, while a piece processes; none while it does not run. */
const polled = (path: string) =>
  appSubscriptions.piecesWhileSettling.modelToDependencies(withPieces(at(path, { signedIn: true }), [processing]))
    .maybeDependencies

describe('the pieces every page shows are read once and kept current', () => {
  test('a first visit asks for the pieces; coming back keeps them on screen while they are asked for again', () => {
    const first = revisitPieces(init())
    expect(AsyncData.isLoading(first.model.pieces)).toBe(true)
    expect(first.commands?.map(({ name }) => name)).toEqual(['ListPieces'])
    const again = revisitPieces(showing(ready))
    expect(again.model.pieces).toEqual(PiecesData.Refreshing({ data: [ready] }))
    // A request already on its way is not sent twice.
    expect(revisitPieces(again.model).commands ?? []).toEqual([])
  })

  test('while a piece is processing, a tick asks again, a tick during that request asks for nothing, and the list settles', () => {
    story(
      update,
      given(showing(processing, ready)),
      message(Message.TickedPiecesRefresh()),
      Command.expectExact(ListPieces),
      Command.resolve(
        ListPieces,
        Message.SucceededListPieces({ pieces: [pieceFixture('processing', { status: 'ready' }), ready] }),
      ),
      Command.expectNone(),
      model((current) => expect(pending(current)).toEqual([])),
    )
    const asking = update(showing(processing), Message.TickedPiecesRefresh()).model
    expect(update(asking, Message.TickedPiecesRefresh()).commands ?? []).toEqual([])
  })

  test('a failed read keeps the pieces already shown, and a cold failure loads again on retry', () => {
    story(
      update,
      given(showing(processing)),
      message(Message.TickedPiecesRefresh()),
      Command.resolve(ListPieces, Message.FailedListPieces()),
      model(({ pieces }) => expect(pieces).toEqual(PiecesData.Stale({ error: 'Unavailable', data: [processing] }))),
    )
    const failed = update(revisitPieces(init()).model, Message.FailedListPieces()).model
    expect(AsyncData.isFailure(failed.pieces)).toBe(true)
    expect(revisitPieces(failed).commands?.map(({ name }) => name)).toEqual(['ListPieces'])
  })

  test('the pieces are asked for again while one processes or its drawing is on its way, and not once all settle', () => {
    expect(pending(showing(processing, ready))).toEqual([processing.id])
    expect(pending(showing(drawn('drawing'), ready))).toEqual([drawn('drawing').id])
    expect(pending(showing(drawn('ready'), ready))).toEqual([])
  })
})

describe('only a page that shows the pieces follows them', () => {
  test('the wardrobe, Home, Ask, a photo and both board addresses poll while a piece processes', () => {
    for (const path of ['/wardrobe', '/', '/ask', '/gallery/ph_1', '/boards/bd_1', '/boards/bd_1/collage'])
      expect(polled(path)).toEqual(Option.some({ pendingIds: [processing.id] }))
  })

  test('pages that do not show them do not', () => {
    for (const path of ['/boards', '/looks', '/account', '/wardrobe/review', `/wardrobe/${processing.id}`, '/explore'])
      expect(polled(path)).toEqual(Option.none())
  })
})

const autumn = boardSummaryFixture('autumn', { name: 'Autumn', pinCount: 3 })

describe('the boards Boards, Save to board and Home show are read in one place', () => {
  test('a first time asks; asking again keeps them on screen, and a failed read keeps what was shown', () => {
    const first = revisitBoards(init())
    expect(AsyncData.isLoading(first.model.boards)).toBe(true)
    expect(first.commands?.map(({ name }) => name)).toEqual([ListBoards.name])
    const read = update(first.model, Message.SucceededListBoards({ boards: [autumn] })).model
    expect(read.boards).toEqual(BoardsData.Success({ data: [autumn] }))
    const again = revisitBoards(read)
    expect(AsyncData.getData(again.model.boards)).toEqual(Option.some([autumn]))
    expect(again.commands?.map(({ name }) => name)).toEqual([ListBoards.name])
    story(
      update,
      given(again.model),
      message(Message.FailedListBoards()),
      model(({ boards }) => expect(boards).toEqual(BoardsData.Stale({ error: 'Unavailable', data: [autumn] }))),
    )
  })

  test('a read on its way is not asked for twice', () => {
    const asking = revisitBoards(init())
    expect(revisitBoards(asking.model).commands ?? []).toEqual([])
  })
})
