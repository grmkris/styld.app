import { Option } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import {
  BuildTurnSheet,
  ChoosePicture,
  DeletePiece,
  Deletion,
  GetPiece,
  Load,
  MakeTurn,
  Message,
  OutMessage,
  RedrawPicture,
  SavePiece,
  WaitToRefreshPiece,
  init,
  update,
} from '../src/page/Piece.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const piece = pieceFixture('jeans', {
  type: 'jeans',
  colours: ['navy'],
  notes: 'Hem taken up',
})
const opened = () => update(init(piece.id), Message.SucceededGetPiece({ piece })).model

describe('a piece you own', () => {
  test('a piece still processing is asked for again until it is ready', () => {
    story(
      update,
      given(init(piece.id)),
      message(Message.SucceededGetPiece({ piece: pieceFixture('jeans', { status: 'processing' }) })),
      Command.expectExact(WaitToRefreshPiece),
      Command.resolve(WaitToRefreshPiece, Message.ElapsedRefreshPause()),
      Command.expectExact(GetPiece({ pieceId: piece.id })),
      Command.resolve(GetPiece, Message.SucceededGetPiece({ piece })),
      Command.expectNone(),
      model(({ load }) => expect(Load.guards.Loaded(load) && load.piece.status).toBe('ready')),
    )
  })

  test('a piece that is not yours or no longer exists is missing', () => {
    story(
      update,
      given(init('pc_nothing')),
      message(Message.FailedGetPiece({ missing: true })),
      model(({ load }) => expect(Load.guards.Missing(load)).toBe(true)),
    )
  })

  test('deleting asks first, then removes the piece and leaves the page', () => {
    story(
      update,
      given(opened()),
      message(Message.ClickedDelete()),
      Command.expectNone(),
      message(Message.ClickedConfirmDelete()),
      Command.expectExact(DeletePiece({ pieceId: piece.id })),
      model(({ deletion }) => expect(Deletion.guards.Deleting(deletion)).toBe(true)),
      Command.resolve(DeletePiece, Message.SucceededDeletePiece()),
      expectOutMessage(OutMessage.DeletedPiece()),
    )
  })

  test('a second confirmation while the piece is being deleted deletes nothing more', () => {
    const deleting = update(update(opened(), Message.ClickedDelete()).model, Message.ClickedConfirmDelete()).model
    story(
      update,
      given(deleting),
      message(Message.ClickedConfirmDelete()),
      Command.expectNone(),
      model(({ deletion }) => expect(Deletion.guards.Deleting(deletion)).toBe(true)),
    )
  })

  test('a shop link that is not an https address is refused before anything is sent', () => {
    story(
      update,
      given(opened()),
      message(Message.ClickedEdit()),
      message(Message.UpdatedShopUrl({ value: 'shop.example/coat' })),
      message(Message.SubmittedEdit()),
      Command.expectNone(),
      model(({ draft }) =>
        expect(Option.map(draft, ({ shopUrlInvalid }) => shopUrlInvalid)).toEqual(Option.some(true)),
      ),
      message(Message.UpdatedShopUrl({ value: 'https://shop.example/coat' })),
      model(({ draft }) =>
        expect(Option.map(draft, ({ shopUrlInvalid }) => shopUrlInvalid)).toEqual(Option.some(false)),
      ),
    )
  })

  test('editing sends the changed piece: its type, colours, attributes, brand and shop link', () => {
    story(
      update,
      given(opened()),
      message(Message.ClickedEdit()),
      message(Message.UpdatedName({ value: '  Dark jeans ' })),
      message(Message.ChoseType({ type: 'jackets' })),
      message(Message.ToggledColour({ colour: 'black' })),
      message(Message.ChoseSeason({ season: 'cold' })),
      message(Message.ToggledOccasion({ occasion: 'casual' })),
      message(Message.ToggledOccasion({ occasion: 'smart' })),
      message(Message.ToggledOccasion({ occasion: 'casual' })),
      message(Message.ChosePattern({ pattern: 'plain' })),
      message(Message.ChosePattern({ pattern: 'plain' })),
      message(Message.UpdatedBrand({ value: ' Levi’s ' })),
      message(Message.UpdatedNotes({ value: '' })),
      message(Message.SubmittedEdit()),
      Command.expectExact(
        SavePiece({
          pieceId: piece.id,
          changes: {
            name: 'Dark jeans',
            notes: null,
            type: 'jackets',
            colours: ['navy', 'black'],
            season: 'cold',
            occasions: ['smart'],
            pattern: null,
            brand: 'Levi’s',
            shopUrl: null,
          },
        }),
      ),
      Command.resolve(
        SavePiece,
        Message.SucceededUpdatePiece({ piece: pieceFixture('jeans', { name: 'Dark jeans' }) }),
      ),
      model(({ draft, load }) => {
        expect(Option.isNone(draft)).toBe(true)
        expect(Load.guards.Loaded(load) && load.piece.name).toBe('Dark jeans')
      }),
    )
  })

  test('a proposed clean picture is chosen in place of the photo', () => {
    const proposed = pieceFixture('jeans', { picture: { state: 'proposed', shows: 'photo', version: 1 } })
    const chosen = pieceFixture('jeans', { picture: { state: 'proposed', shows: 'clean', version: 1 } })
    const shown = update(init(piece.id), Message.SucceededGetPiece({ piece: proposed })).model
    const sending = update(shown, Message.ClickedShowPicture({ use: 'clean' })).model
    expect(update(sending, Message.ClickedShowPicture({ use: 'clean' })).commands ?? []).toEqual([])
    story(
      update,
      given(shown),
      message(Message.ClickedShowPicture({ use: 'clean' })),
      Command.expectExact(ChoosePicture({ pieceId: piece.id, use: 'clean' })),
      Command.resolve(ChoosePicture, Message.SucceededChoosePicture({ piece: chosen })),
      model(({ load, choosing }) => {
        expect(choosing).toBe('idle')
        expect(Load.guards.Loaded(load) && load.piece.picture?.shows).toBe('clean')
      }),
    )
  })

  test('a redraw sends the owner’s words, then the page waits for the new drawing', () => {
    const ready = pieceFixture('jeans', { picture: { state: 'ready', shows: 'clean', version: 1 } })
    story(
      update,
      given(update(init(piece.id), Message.SucceededGetPiece({ piece: ready })).model),
      message(Message.ClickedRedraw()),
      message(Message.UpdatedHint({ value: ' dark selvedge jeans ' })),
      message(Message.SubmittedRedraw()),
      Command.expectExact(
        RedrawPicture({ pieceId: piece.id, hint: ' dark selvedge jeans ', operationId: Option.none() }),
      ),
      Command.resolve(
        RedrawPicture,
        Message.SucceededRedrawPicture({ picture: { state: 'drawing', shows: 'photo', version: 1 } }),
      ),
      model(({ redraw, load }) => {
        expect(Option.isNone(redraw)).toBe(true)
        expect(Load.guards.Loaded(load) && load.piece.picture?.state).toBe('drawing')
      }),
      Command.expectExact(WaitToRefreshPiece),
      Command.resolve(WaitToRefreshPiece, Message.ElapsedRefreshPause()),
      Command.resolve(
        GetPiece,
        Message.SucceededGetPiece({
          piece: pieceFixture('jeans', { picture: { state: 'ready', shows: 'clean', version: 2 } }),
        }),
      ),
      Command.expectNone(),
    )
  })

  test('a redraw whose answer was lost is sent again as the same operation; a refusal is not', () => {
    const ready = pieceFixture('jeans', { picture: { state: 'failed', shows: 'photo', version: 1 } })
    story(
      update,
      given(update(init(piece.id), Message.SucceededGetPiece({ piece: ready })).model),
      message(Message.ClickedRedraw()),
      message(Message.SubmittedRedraw()),
      Command.resolve(RedrawPicture, Message.FailedRedrawPicture({ problem: 'network', operationId: 'redraw-0001' })),
      model(({ redraw }) =>
        expect(Option.map(redraw, ({ problem, operationId }) => ({ problem, operationId }))).toEqual(
          Option.some({ problem: Option.some('network'), operationId: Option.some('redraw-0001') }),
        ),
      ),
      message(Message.SubmittedRedraw()),
      Command.expectExact(RedrawPicture({ pieceId: piece.id, hint: '', operationId: Option.some('redraw-0001') })),
      Command.resolve(
        RedrawPicture,
        Message.FailedRedrawPicture({ problem: 'dailyLimit', operationId: 'redraw-0001' }),
      ),
      model(({ redraw }) => expect(Option.flatMap(redraw, ({ operationId }) => operationId)).toEqual(Option.none())),
    )
  })

  test('a turn is asked for, waited on while it is made, then cut into frames here once', () => {
    const clean = pieceFixture('jeans', { picture: { state: 'ready', shows: 'clean', version: 1 } })
    const building = pieceFixture('jeans', {
      picture: { state: 'ready', shows: 'clean', version: 1 },
      turn: { state: 'building', version: 7 },
    })
    const ready = pieceFixture('jeans', {
      picture: { state: 'ready', shows: 'clean', version: 1 },
      turn: {
        state: 'ready',
        version: 8,
        layout: { frames: 30, columns: 6, width: 288, height: 384, pivot: [0.5, 0.027] },
      },
    })
    story(
      update,
      given(update(init(piece.id), Message.SucceededGetPiece({ piece: clean })).model),
      message(Message.ClickedMakeTurn()),
      Command.expectExact(MakeTurn({ pieceId: piece.id })),
      Command.resolve(MakeTurn, Message.SucceededMakeTurn({ turn: { state: 'making', version: 6 } })),
      Command.expectExact(WaitToRefreshPiece),
      Command.resolve(WaitToRefreshPiece, Message.ElapsedRefreshPause()),
      Command.resolve(GetPiece, Message.SucceededGetPiece({ piece: building })),
      Command.expectExact(BuildTurnSheet({ pieceId: piece.id, version: 7 })),
      model(({ turnWork }) => expect(turnWork).toBe('building')),
      Command.resolve(
        BuildTurnSheet,
        Message.SucceededBuildTurnSheet({ turn: ready.turn ?? { state: 'failed', version: 0 } }),
      ),
      Command.expectNone(),
      model(({ load, turnWork }) => {
        expect(turnWork).toBe('idle')
        expect(Load.guards.Loaded(load) && load.piece.turn?.state).toBe('ready')
      }),
    )
  })

  test('a refused turn says why, and a device that cannot cut the frames says so', () => {
    const clean = pieceFixture('jeans', { picture: { state: 'ready', shows: 'clean', version: 1 } })
    const showing = update(init(piece.id), Message.SucceededGetPiece({ piece: clean })).model
    story(
      update,
      given(showing),
      message(Message.ClickedMakeTurn()),
      Command.resolve(MakeTurn, Message.FailedMakeTurn({ problem: 'dailyLimit' })),
      model(({ turnProblem, turnWork }) =>
        expect({ turnProblem, turnWork }).toEqual({ turnProblem: Option.some('dailyLimit'), turnWork: 'idle' }),
      ),
    )
    story(
      update,
      given(showing),
      message(Message.FailedBuildTurnSheet()),
      model(({ turnProblem }) => expect(turnProblem).toEqual(Option.some('build'))),
    )
  })

  test('a save that fails keeps the form and says so', () => {
    story(
      update,
      given(opened()),
      message(Message.ClickedEdit()),
      message(Message.SubmittedEdit()),
      Command.resolve(SavePiece, Message.FailedUpdatePiece()),
      model(({ draft }) =>
        expect(Option.map(draft, ({ failed, saving }) => ({ failed, saving }))).toEqual(
          Option.some({ failed: true, saving: false }),
        ),
      ),
    )
  })
})
