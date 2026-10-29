import { Option } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import {
  DeletePiece,
  Deletion,
  GetPiece,
  Load,
  Message,
  OutMessage,
  SavePiece,
  WaitToRefreshPiece,
  init,
  update,
} from '../src/page/Piece.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const piece = pieceFixture('jeans', {
  category: 'bottom',
  subcategory: 'jeans',
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

  test('editing sends the changed piece, and a new category clears the shelf of the old one', () => {
    story(
      update,
      given(opened()),
      message(Message.ClickedEdit()),
      message(Message.UpdatedName({ value: '  Dark jeans ' })),
      message(Message.ChoseCategory({ category: 'outerwear' })),
      model(({ draft }) => expect(Option.flatMap(draft, ({ subcategory }) => subcategory)).toEqual(Option.none())),
      message(Message.ToggledColour({ colour: 'black' })),
      message(Message.UpdatedNotes({ value: '' })),
      message(Message.SubmittedEdit()),
      Command.expectExact(
        SavePiece({
          pieceId: piece.id,
          changes: {
            name: 'Dark jeans',
            notes: null,
            category: 'outerwear',
            subcategory: null,
            colours: ['navy', 'black'],
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
