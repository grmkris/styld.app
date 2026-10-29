import { FileDrop } from '@foldkit/ui'
import { Option } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import {
  AddPiece,
  DrawOperationId,
  Message,
  OutMessage,
  RevokePreview,
  ShowPreview,
  Submission,
  UploadPhoto,
  init,
  update,
} from '../src/page/AddPiece.ts'

const photo = new globalThis.File(['jpeg-bytes'], 'jeans.jpg', { type: 'image/jpeg' })
const dropped = (file: File) => Message.GotDropMessage({ message: FileDrop.Message.DroppedFiles({ files: [file] }) })

/** A photo chosen, its preview shown, and a category picked: ready to add. */
const ready = () => {
  const chosen = update(init(), dropped(photo)).model
  const previewed = update(chosen, Message.CreatedPreview({ url: 'blob:preview-1' })).model
  return update(previewed, Message.ChoseCategory({ category: 'bottom' })).model
}

const addArgs = {
  operationId: 'op-1',
  uploadId: 'up_1',
  category: 'bottom' as const,
  subcategory: Option.none(),
  colours: [],
  name: Option.none(),
}

describe('adding a piece by hand', () => {
  test('nothing is sent without a photo and a category, and the page says which is missing', () => {
    story(
      update,
      given(init()),
      message(Message.SubmittedPiece()),
      Command.expectNone(),
      model(({ photoProblem, categoryMissing }) => {
        expect(photoProblem).toEqual(Option.some('missing'))
        expect(categoryMissing).toBe(true)
      }),
    )
  })

  test('a file that is not a photo, or is too large, is refused before anything is sent', () => {
    story(
      update,
      given(init()),
      message(dropped(new globalThis.File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' }))),
      Command.expectNone(),
      model(({ photo: chosen, photoProblem }) => {
        expect(Option.isNone(chosen)).toBe(true)
        expect(photoProblem).toEqual(Option.some('notAnImage'))
      }),
    )
    const huge = new globalThis.File([new ArrayBuffer(15 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' })
    story(
      update,
      given(init()),
      message(dropped(huge)),
      model(({ photoProblem }) => expect(photoProblem).toEqual(Option.some('tooLarge'))),
    )
  })

  test('a chosen photo is previewed, and replacing it lets the old preview go', () => {
    story(
      update,
      given(init()),
      message(dropped(photo)),
      Command.expectExact(ShowPreview),
      Command.resolve(ShowPreview, Message.CreatedPreview({ url: 'blob:preview-1' })),
      message(dropped(new globalThis.File(['png'], 'other.png', { type: 'image/png' }))),
      Command.expectExact(RevokePreview({ url: 'blob:preview-1' }), ShowPreview),
      Command.resolveAll(
        [RevokePreview, Message.RevokedPreview()],
        [ShowPreview, Message.CreatedPreview({ url: 'blob:preview-2' })],
      ),
      model(({ preview }) => expect(preview).toEqual(Option.some('blob:preview-2'))),
    )
  })

  test('adding uploads the photo, then adds the piece, then hands its id to the page', () => {
    story(
      update,
      given(ready()),
      message(Message.ChoseSubcategory({ subcategory: Option.some('jeans') })),
      message(Message.ToggledColour({ colour: 'navy' })),
      message(Message.UpdatedName({ value: ' Dark jeans ' })),
      message(Message.SubmittedPiece()),
      Command.expectExact(DrawOperationId),
      Command.resolve(DrawOperationId, Message.DrewOperationId({ operationId: 'op-1' })),
      Command.expectExact(UploadPhoto({ photo, contentType: 'image/jpeg' })),
      Command.resolve(UploadPhoto, Message.SucceededUploadPhoto({ uploadId: 'up_1' })),
      Command.expectExact(
        AddPiece({
          ...addArgs,
          subcategory: Option.some('jeans'),
          colours: ['navy'],
          name: Option.some('Dark jeans'),
        }),
      ),
      model(({ submission }) => expect(Submission.guards.Adding(submission)).toBe(true)),
      Command.resolve(AddPiece, Message.SucceededAddPiece({ pieceId: 'pc_new' })),
      expectOutMessage(OutMessage.AddedPiece({ pieceId: 'pc_new' })),
    )
  })

  test('a lost answer is retried with the same operation and upload, never a second photo', () => {
    story(
      update,
      given(ready()),
      message(Message.SubmittedPiece()),
      Command.resolve(DrawOperationId, Message.DrewOperationId({ operationId: 'op-1' })),
      Command.resolve(UploadPhoto, Message.SucceededUploadPhoto({ uploadId: 'up_1' })),
      Command.resolve(AddPiece, Message.FailedAddPiece({ retry: 'same' })),
      model(({ submission }) => expect(Submission.guards.Failed(submission)).toBe(true)),
      message(Message.SubmittedPiece()),
      Command.expectExact(AddPiece(addArgs)),
      Command.resolve(AddPiece, Message.SucceededAddPiece({ pieceId: 'pc_new' })),
    )
  })

  test('a refused upload or a changed piece starts a new attempt', () => {
    story(
      update,
      given(ready()),
      message(Message.SubmittedPiece()),
      Command.resolve(DrawOperationId, Message.DrewOperationId({ operationId: 'op-1' })),
      Command.resolve(UploadPhoto, Message.SucceededUploadPhoto({ uploadId: 'up_1' })),
      Command.resolve(AddPiece, Message.FailedAddPiece({ retry: 'fresh' })),
      message(Message.SubmittedPiece()),
      Command.expectExact(DrawOperationId),
      Command.resolve(DrawOperationId, Message.DrewOperationId({ operationId: 'op-2' })),
      Command.resolve(UploadPhoto, Message.FailedUploadPhoto()),
      message(Message.ChoseCategory({ category: 'top' })),
      model(({ attempt }) => expect(Option.isNone(attempt)).toBe(true)),
    )
  })

  test('nothing changes while the piece is on its way', () => {
    const sending = update(ready(), Message.SubmittedPiece()).model
    story(
      update,
      given(sending),
      message(Message.ChoseCategory({ category: 'top' })),
      Command.expectNone(),
      model(({ category }) => expect(category).toEqual(Option.some('bottom'))),
    )
  })
})
