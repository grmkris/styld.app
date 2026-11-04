import { OperationId } from '@styld/protocol'
import { Option } from 'effect'
import { AsyncData } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { Deletion } from '../src/Confirm.ts'
import * as ServerData from '../src/ServerData.ts'
import * as Wardrobe from '../src/page/Wardrobe.ts'
import { DeletePieces, init, Message, Model, OutMessage, update } from '../src/page/WardrobeSelect.ts'
import { pieceFixture } from './WardrobeFixtures.ts'
import { browseGroup, browseType } from '../src/WardrobeBrowse.ts'

const knit = pieceFixture('knit').id
const tee = pieceFixture('tee').id
const jeans = pieceFixture('jeans').id
const lost = OperationId.make('op-lost-answer-0001')

describe('select mode on the wardrobe grid', () => {
  test('ticks and unticks pieces, asks once, then deletes the ticked ones and ends', () => {
    story(
      update,
      given(init()),
      message(Message.ClickedSelect()),
      message(Message.ToggledPiece({ pieceId: knit })),
      message(Message.ToggledPiece({ pieceId: tee })),
      message(Message.ToggledPiece({ pieceId: jeans })),
      message(Message.ToggledPiece({ pieceId: knit })),
      model((current) =>
        expect(current).toEqual(
          Model.On({ pieceIds: [tee, jeans], deletion: Deletion.Idle(), maybeOperationId: Option.none() }),
        ),
      ),
      message(Message.ClickedDelete()),
      Command.expectNone(),
      model((current) => expect(Model.guards.On(current) && Deletion.guards.Confirming(current.deletion)).toBe(true)),
      message(Message.ClickedConfirmDelete()),
      Command.expectExact(DeletePieces({ pieceIds: [tee, jeans], maybeOperationId: Option.none() })),
      Command.resolve(DeletePieces, Message.SucceededDeletePieces()),
      model((current) => expect(current).toEqual(Model.Off())),
      expectOutMessage(OutMessage.DeletedPieces()),
    )
  })

  test('a delete whose answer was lost is sent again under the same operation id', () => {
    story(
      update,
      given(Model.On({ pieceIds: [knit], deletion: Deletion.Confirming(), maybeOperationId: Option.none() })),
      message(Message.ClickedConfirmDelete()),
      Command.expectExact(DeletePieces({ pieceIds: [knit], maybeOperationId: Option.none() })),
      Command.resolve(DeletePieces, Message.FailedDeletePieces({ maybeOperationId: Option.some(lost) })),
      model((current) =>
        expect(current).toEqual(
          Model.On({ pieceIds: [knit], deletion: Deletion.Failed(), maybeOperationId: Option.some(lost) }),
        ),
      ),
      message(Message.ClickedConfirmDelete()),
      Command.expectExact(DeletePieces({ pieceIds: [knit], maybeOperationId: Option.some(lost) })),
      Command.resolve(DeletePieces, Message.SucceededDeletePieces()),
      expectOutMessage(OutMessage.DeletedPieces()),
    )
  })

  test('another tick after a failure is another delete, under a new id; a delete on its way keeps its ticks', () => {
    const failed = Model.On({ pieceIds: [knit], deletion: Deletion.Failed(), maybeOperationId: Option.some(lost) })
    expect(update(failed, Message.ToggledPiece({ pieceId: tee })).model).toEqual(
      Model.On({ pieceIds: [knit, tee], deletion: Deletion.Idle(), maybeOperationId: Option.none() }),
    )
    const deleting = Model.On({ pieceIds: [knit], deletion: Deletion.Deleting(), maybeOperationId: Option.none() })
    expect(update(deleting, Message.ToggledPiece({ pieceId: tee })).model).toEqual(deleting)
    expect(update(deleting, Message.ClickedDone()).model).toEqual(deleting)
  })

  test('nothing ticked asks nothing; Cancel keeps the ticks, and Done clears them', () => {
    story(
      update,
      given(init()),
      message(Message.ClickedSelect()),
      message(Message.ClickedDelete()),
      Command.expectNone(),
      model((current) =>
        expect(current).toEqual(Model.On({ pieceIds: [], deletion: Deletion.Idle(), maybeOperationId: Option.none() })),
      ),
      message(Message.ToggledPiece({ pieceId: knit })),
      message(Message.ClickedDelete()),
      message(Message.ClickedCancelDelete()),
      model((current) =>
        expect(current).toEqual(
          Model.On({ pieceIds: [knit], deletion: Deletion.Idle(), maybeOperationId: Option.none() }),
        ),
      ),
      message(Message.ClickedDone()),
      model((current) => expect(current).toEqual(Model.Off())),
    )
  })
})

describe('the wardrobe page with select mode', () => {
  const tops = browseType('shortSleeveTops')
  const browsing = Wardrobe.init()
  const atTops = (current: Wardrobe.Model, next: Wardrobe.Message) =>
    Wardrobe.update(current, next, { maybeBrowse: Option.some(tops) })

  test('pieces deleted from the grid ask the app to read the pieces again', () => {
    story(
      atTops,
      given(Wardrobe.reflectBrowse(Option.some(tops), tops)(browsing)),
      message(Wardrobe.Message.GotSelectMessage({ message: Message.ClickedSelect() })),
      message(Wardrobe.Message.GotSelectMessage({ message: Message.SucceededDeletePieces() })),
      model((current) => expect(current.selection).toEqual(Model.Off())),
      expectOutMessage(Wardrobe.OutMessage.DeletedPieces()),
    )
  })

  test('browsing elsewhere ends select mode', () => {
    const selecting = atTops(browsing, Wardrobe.Message.GotSelectMessage({ message: Message.ClickedSelect() }))
    expect(Model.guards.On(selecting.model.selection)).toBe(true)
    // A filter on the same type keeps it; another level ends it.
    const winter = modifyFields(tops, {
      filters: (filters) => modifyFields(filters, { season: () => Option.some('winter' as const) }),
    })
    expect(Model.guards.On(Wardrobe.reflectBrowse(Option.some(tops), winter)(selecting.model).selection)).toBe(true)
    expect(Wardrobe.reflectBrowse(Option.some(tops), browseGroup('clothing'))(selecting.model).selection).toEqual(
      Model.Off(),
    )
  })

  test('the pieces are read again even while an older read is on its way, which may predate the delete', () => {
    const reading = { ...ServerData.init(), pieces: AsyncData.Loading() }
    expect(ServerData.readPiecesAgain(reading).commands).toEqual([ServerData.ListPieces()])
    expect(ServerData.revisitPieces(reading).commands ?? []).toEqual([])
  })
})
