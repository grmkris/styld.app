import { Option } from 'effect'
import { Command, click, expect, given, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { ListPieces, Message as PiecesMessage, PiecesData } from '../src/ServerData.ts'
import { DeletePieces, Message as SelectMessage } from '../src/page/WardrobeSelect.ts'
import { view } from '../src/View.ts'
import { at } from './AppFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const tee = pieceFixture('tee', { name: 'White tee' })
const shirt = pieceFixture('shirt', { name: 'Linen shirt' })
const vest = pieceFixture('vest', { name: 'Ribbed vest' })

const tops = modifyFields(at('/wardrobe?group=clothing&type=tops', { signedIn: true }), {
  data: (data) => modifyFields(data, { pieces: () => PiecesData.Success({ data: [tee, shirt, vest] }) }),
})

describe('select mode on the wardrobe grid', () => {
  test('Select, tick two, Delete 2 pieces, confirm: they go, the pieces are read again, and the grid is back', () => {
    scene(
      { update, view },
      given(tops),
      click(role('button', { name: 'Select' })),
      expect(role('button', { name: 'Filters' })).not.toExist(),
      expect(role('link', { name: 'White tee' })).not.toExist(),
      expect(text('Tap the pieces to delete.')).toExist(),
      click(role('button', { name: 'White tee' })),
      click(role('button', { name: 'Ribbed vest' })),
      expect(role('button', { name: 'White tee' })).toHaveAttr('aria-pressed', 'true'),
      expect(role('button', { name: 'Linen shirt' })).toHaveAttr('aria-pressed', 'false'),
      click(role('button', { name: 'Delete 2 pieces' })),
      expect(
        role('alertdialog', {
          name: "Delete 2 pieces? They leave your boards, looks and photos. This can't be undone.",
        }),
      ).toExist(),
      click(role('button', { name: 'Delete 2 pieces' })),
      Command.expectExact(DeletePieces({ pieceIds: [tee.id, vest.id], maybeOperationId: Option.none() })),
      Command.resolve(DeletePieces, SelectMessage.SucceededDeletePieces()),
      Command.expectHas(ListPieces()),
      Command.resolve(ListPieces, PiecesMessage.SucceededListPieces({ pieces: [shirt] })),
      expect(role('link', { name: 'Linen shirt' })).toExist(),
      expect(role('link', { name: 'White tee' })).not.toExist(),
      expect(role('button', { name: 'Filters' })).toExist(),
    )
  })

  test('Done leaves select mode with nothing deleted', () => {
    scene(
      { update, view },
      given(tops),
      click(role('button', { name: 'Select' })),
      click(role('button', { name: 'Linen shirt' })),
      click(role('button', { name: 'Done' })),
      Command.expectNone(),
      expect(role('link', { name: 'Linen shirt' })).toExist(),
      expect(role('button', { name: 'Select' })).toExist(),
    )
  })
})
