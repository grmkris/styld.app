import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { init, Message, RemoveBack, SetBack, update } from '../src/page/PieceBack.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const piece = pieceFixture('jeans')

describe('a piece’s back', () => {
  test('a picked photo becomes the back, shown at once; removing it shows the front again', () => {
    const file = new File(['back'], 'back.jpg', { type: 'image/jpeg' })
    const withBack = pieceFixture('jeans', { hasBack: true })
    story(
      update,
      given(init(piece.id)),
      message(Message.ChoseBack({ files: [file] })),
      Command.expectExact(SetBack({ pieceId: piece.id, file })),
      model(({ work }) => expect(work).toBe('sending')),
      Command.resolve(SetBack, Message.SucceededBack({ piece: withBack })),
      model(({ side, work }) => {
        expect(side).toBe('back')
        expect(work).toBe('idle')
      }),
      expectOutMessage({ _tag: 'ChangedPiece', piece: withBack }),
    )
  })

  test('removing the back shows the front, and one that does not go through says so', () => {
    story(
      update,
      given({ ...init(piece.id), side: 'back' }),
      message(Message.ClickedRemoveBack()),
      Command.resolve(RemoveBack, Message.SucceededBack({ piece })),
      model(({ side }) => expect(side).toBe('front')),
      message(Message.ClickedRemoveBack()),
      Command.resolve(RemoveBack, Message.FailedBack()),
      model(({ work }) => expect(work).toBe('failed')),
    )
  })
})
