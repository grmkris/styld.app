import { OperationId } from '@styld/protocol'
import { Array, Option } from 'effect'
import { AsyncData } from 'foldkit'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import {
  BuildTurnSheet,
  ChoosePicture,
  DeletePiece,
  Deletion,
  GetPiece,
  Choosing,
  type Model,
  PieceData,
  RedrawSend,
  TurnWork,
  MakeTurn,
  Message,
  OutMessage,
  RedrawPicture,
  SavePiece,
  subscriptions,
  init,
  update,
} from '../src/page/Piece.ts'
import { DraftSave } from '../src/page/PieceDraft.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const piece = pieceFixture('jeans', {
  type: 'jeans',
  colours: ['navy'],
  notes: 'Hem taken up',
})
const opened = () => update(init(piece.id), Message.SucceededGetPiece({ piece })).model
const processing = pieceFixture('jeans', { status: 'processing' })
const showingProcessing = () => update(init(piece.id), Message.SucceededGetPiece({ piece: processing })).model

/** The piece as the page shows it, if read. */
const shownPiece = (current: Model) => Option.getOrNull(AsyncData.getData(current.piece))

/** What the page's one poll waits on; none while it does not run. */
const pending = (current: Model) => subscriptions.pieceWhileSettling.modelToDependencies(current).pendingIds

describe('a piece you own', () => {
  test('a piece still processing is followed by the poll until it is ready', () => {
    story(
      update,
      given(init(piece.id)),
      message(Message.SucceededGetPiece({ piece: processing })),
      Command.expectNone(),
      model((current) => expect(pending(current)).toEqual([piece.id])),
      message(Message.TickedPieceRefresh()),
      Command.expectExact(GetPiece({ pieceId: piece.id })),
      Command.resolve(GetPiece, Message.SucceededGetPiece({ piece })),
      Command.expectNone(),
      model((current) => {
        expect(shownPiece(current)?.status).toBe('ready')
        expect(pending(current)).toEqual([])
      }),
    )
  })

  test('a tick while a read is on its way asks for nothing, so polls never stack', () => {
    const asking = update(showingProcessing(), Message.TickedPieceRefresh())
    expect(asking.commands?.map(({ name }) => name)).toEqual(['GetPiece'])
    expect(update(asking.model, Message.TickedPieceRefresh()).commands ?? []).toEqual([])
  })

  test('a poll answering while an edit saves or a redraw is sent leaves that work as it was', () => {
    const saving = update(update(showingProcessing(), Message.ClickedEdit()).model, Message.SubmittedEdit()).model
    const polled = update(saving, Message.SucceededGetPiece({ piece: processing })).model
    expect(Option.map(polled.draft, ({ save }) => save)).toEqual(Option.some(DraftSave.Saving()))
    const redrawing = update(
      update(showingProcessing(), Message.ClickedRedraw()).model,
      Message.SubmittedRedraw(),
    ).model
    const polledAgain = update(redrawing, Message.SucceededGetPiece({ piece: processing })).model
    expect(Option.map(polledAgain.redraw, ({ send }) => send)).toEqual(Option.some(RedrawSend.Sending()))
  })

  test('after five polls that do not get through the page stops following, and Try again starts it over', () => {
    const missed = Array.reduce(
      Array.range(1, 5),
      showingProcessing(),
      (current) =>
        update(update(current, Message.TickedPieceRefresh()).model, Message.FailedGetPiece({ error: 'Unavailable' }))
          .model,
    )
    expect(shownPiece(missed)?.status).toBe('processing')
    expect(pending(missed)).toEqual([])
    const retried = update(missed, Message.ClickedRetry())
    expect(retried.commands?.map(({ name }) => name)).toEqual(['GetPiece'])
    expect(pending(retried.model)).toEqual([piece.id])
  })

  test('a piece that is not yours or no longer exists is missing; one that did not load can be tried again', () => {
    expect(update(init('pc_nothing'), Message.FailedGetPiece({ error: 'NotFound' })).model.piece).toEqual(
      PieceData.Failure({ error: 'NotFound' }),
    )
    const failed = update(init(piece.id), Message.FailedGetPiece({ error: 'Unavailable' })).model
    expect(failed.piece).toEqual(PieceData.Failure({ error: 'Unavailable' }))
    expect(update(failed, Message.ClickedRetry()).commands?.map(({ name }) => name)).toEqual(['GetPiece'])
  })

  test('deleting asks first, then removes the piece and leaves the page', () => {
    story(
      update,
      given(opened()),
      message(Message.ClickedEdit()),
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
    const editing = update(opened(), Message.ClickedEdit()).model
    const deleting = update(update(editing, Message.ClickedDelete()).model, Message.ClickedConfirmDelete()).model
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
      model((current) => {
        expect(Option.isNone(current.draft)).toBe(true)
        expect(shownPiece(current)?.name).toBe('Dark jeans')
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
      model((current) => {
        expect(current.choosing).toEqual(Choosing.Idle())
        expect(shownPiece(current)?.picture?.shows).toBe('clean')
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
        RedrawPicture({ pieceId: piece.id, hint: ' dark selvedge jeans ', maybeOperationId: Option.none() }),
      ),
      Command.resolve(
        RedrawPicture,
        Message.SucceededRedrawPicture({ picture: { state: 'drawing', shows: 'photo', version: 1 } }),
      ),
      model((current) => {
        expect(Option.isNone(current.redraw)).toBe(true)
        expect(shownPiece(current)?.picture?.state).toBe('drawing')
        // The answer starts no poll of its own: the page's one poll follows the drawing.
        expect(pending(current)).toEqual([piece.id])
      }),
      Command.expectNone(),
      message(Message.TickedPieceRefresh()),
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
      Command.resolve(
        RedrawPicture,
        Message.FailedRedrawPicture({ problem: 'network', operationId: OperationId.make('redraw-0001') }),
      ),
      model(({ redraw }) =>
        expect(Option.map(redraw, ({ send }) => send)).toEqual(
          Option.some(
            RedrawSend.Failed({ problem: 'network', maybeOperationId: Option.some(OperationId.make('redraw-0001')) }),
          ),
        ),
      ),
      message(Message.SubmittedRedraw()),
      Command.expectExact(
        RedrawPicture({ pieceId: piece.id, hint: '', maybeOperationId: Option.some(OperationId.make('redraw-0001')) }),
      ),
      Command.resolve(
        RedrawPicture,
        Message.FailedRedrawPicture({ problem: 'dailyLimit', operationId: OperationId.make('redraw-0001') }),
      ),
      model(({ redraw }) =>
        expect(Option.map(redraw, ({ send }) => send)).toEqual(
          Option.some(RedrawSend.Failed({ problem: 'dailyLimit', maybeOperationId: Option.none() })),
        ),
      ),
      message(Message.SubmittedRedraw()),
      Command.expectExact(RedrawPicture({ pieceId: piece.id, hint: '', maybeOperationId: Option.none() })),
      Command.resolve(
        RedrawPicture,
        Message.SucceededRedrawPicture({ picture: { state: 'drawing', shows: 'photo', version: 2 } }),
      ),
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
      Command.expectNone(),
      model((current) => expect(pending(current)).toEqual([piece.id])),
      message(Message.TickedPieceRefresh()),
      Command.resolve(GetPiece, Message.SucceededGetPiece({ piece: building })),
      Command.expectExact(BuildTurnSheet({ pieceId: piece.id, turn: { state: 'building', version: 7 } })),
      model(({ turnWork }) => expect(turnWork).toEqual(TurnWork.Building())),
      Command.resolve(
        BuildTurnSheet,
        Message.SucceededBuildTurnSheet({ turn: ready.turn ?? { state: 'failed', version: 0 } }),
      ),
      Command.expectNone(),
      model((current) => {
        expect(current.turnWork).toEqual(TurnWork.Idle())
        expect(shownPiece(current)?.turn?.state).toBe('ready')
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
      model(({ turnWork }) => expect(turnWork).toEqual(TurnWork.Failed({ problem: 'dailyLimit' }))),
      // Trying again asks once more, and the reason goes while it is asked.
      message(Message.ClickedMakeTurn()),
      Command.expectExact(MakeTurn({ pieceId: piece.id })),
      model(({ turnWork }) => expect(turnWork).toEqual(TurnWork.Asking())),
      Command.resolve(MakeTurn, Message.FailedMakeTurn({ problem: 'busy' })),
    )
    story(
      update,
      given(showing),
      message(Message.FailedBuildTurnSheet()),
      model(({ turnWork }) => expect(turnWork).toEqual(TurnWork.Failed({ problem: 'build' }))),
    )
  })

  test('a save that fails keeps the form and says so', () => {
    const editing = update(opened(), Message.ClickedEdit()).model
    const saving = update(editing, Message.SubmittedEdit()).model
    const deletionAttempt = update(saving, Message.ClickedDelete())
    expect(deletionAttempt.commands ?? []).toEqual([])
    expect(deletionAttempt.model.deletion).toEqual(Deletion.Idle())
    story(
      update,
      given(opened()),
      message(Message.ClickedEdit()),
      message(Message.SubmittedEdit()),
      Command.resolve(SavePiece, Message.FailedUpdatePiece()),
      model(({ draft }) => expect(Option.map(draft, ({ save }) => save)).toEqual(Option.some(DraftSave.Failed()))),
    )
  })
})
