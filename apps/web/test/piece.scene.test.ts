import { Look, OperationId } from '@styld/protocol'
import { Dialog } from '@foldkit/ui'
import { Option, Schema } from 'effect'
import { Command, Mount, click, expect, given, role, scene, submit, text, type } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Message, update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage } from './AppFixtures.ts'
import { Navigate } from '../src/Navigation.ts'
import {
  ChoosePicture,
  DeletePiece,
  PieceData,
  Message as PieceMessage,
  RedrawPicture,
  SavePiece,
  ShowTurn,
  TurnWork,
} from '../src/page/Piece.ts'
import * as PieceLooks from '../src/page/PieceLooks.ts'
import { ListBoards, Message as DataMessage } from '../src/ServerData.ts'
import { view } from '../src/View.ts'
import { sceneSheetOpened } from './SheetFixtures.ts'
import { pieceFixture, signedPicture } from './WardrobeFixtures.ts'
import { boardSummaryFixture } from './BoardFixtures.ts'

const jeans = pieceFixture('jeans', {
  type: 'jeans',
  colours: ['navy'],
  notes: 'Hem taken up',
})

const piecePage = (shown: PieceData) =>
  withPage(at(`/wardrobe/${jeans.id}`, { signedIn: true }), lenses.piece, (piece) =>
    modifyFields(piece, { piece: () => shown }),
  )

const autumn = boardSummaryFixture('autumn', { name: 'Autumn', pinCount: 3 })

describe('the piece page', () => {
  test('Save to board lists the boards the app reads for it, and reads them again when they did not load', () => {
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: jeans }))),
      click(role('button', { name: 'Add to board' })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      ...sceneSheetOpened,
      Command.resolve(ListBoards, DataMessage.FailedListBoards()),
      expect(role('alert')).toHaveText("Your boards didn't load."),
      click(role('button', { name: 'Try again' })),
      Command.resolve(ListBoards, DataMessage.SucceededListBoards({ boards: [autumn] })),
      expect(role('button', { name: /^Autumn\s*3 pins$/ })).toExist(),
    )
  })

  test('shows the photo, what it is, its colours and notes', () => {
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: jeans }))),
      expect(role('heading', { name: 'Jeans' })).toExist(),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('src', jeans.images?.full ?? ''),
      // Unnamed, its title already says what it is: no line repeating it.
      expect(text('Colour')).toExist(),
      expect(text('Navy')).toExist(),
      expect(text('Hem taken up')).toExist(),
      // Edit waits at the bar's end.
      expect(role('button', { name: 'Edit' })).toExist(),
    )
  })

  test('says what it is once, when and what for it is worn, its brand and its shop, and turns to its back', () => {
    const coat = {
      ...jeans,
      type: 'coats',
      seasons: ['autumn', 'winter'],
      rainproof: true,
      occasions: ['casual', 'smart'],
      pattern: 'checked',
      brand: 'COS',
      shopUrl: 'https://shop.example/coat',
      hasBack: true,
    } as const
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: coat }))),
      // The head says what it is; the facts do not repeat it as a shop's aisle.
      expect(role('heading', { name: 'Coat' })).toExist(),
      expect(text('Coats')).not.toExist(),
      expect(text('Autumn, Winter, Rainproof')).toExist(),
      expect(text('Casual, Smart')).toExist(),
      expect(text('Checked')).toExist(),
      expect(text('COS')).toExist(),
      expect(role('link', { name: 'Open the shop’s page' })).toHaveAttr('href', 'https://shop.example/coat'),
      expect(role('button', { name: 'Front' })).toHaveAttr('aria-pressed', 'true'),
      click(role('button', { name: 'Back' })),
      expect(role('img', { name: 'Coat, back' })).toExist(),
      expect(text('Replace the back')).not.toExist(),
      click(role('button', { name: 'Edit' })),
      expect(text('Replace the back')).toExist(),
      expect(role('button', { name: 'Remove the back' })).toExist(),
    )
  })

  test('a named piece says what one of its kind is under its name', () => {
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: { ...jeans, name: 'Weekend denim' } }))),
      expect(role('heading', { name: 'Weekend denim' })).toExist(),
      expect(text('Jeans')).toExist(),
    )
  })

  test('lists the saved looks the piece is in, each opening its look, and nothing when it is in none', () => {
    const look = Schema.decodeUnknownSync(Look)({
      id: `lk_${'dinner'.padEnd(22, 'x')}`,
      name: 'Moja zbirka',
      occasion: null,
      pieces: [jeans],
      shared: false,
      check: null,
      createdAt: '2026-11-02T14:00:00.000Z',
    })
    const withLooks = (looks: ReadonlyArray<Look>) =>
      withPage(piecePage(PieceData.Success({ data: jeans })), lenses.piece, (piece) =>
        modifyFields(piece, {
          looks: () =>
            PieceLooks.update(PieceLooks.init(jeans.id), PieceLooks.Message.SucceededListLooks({ looks })).model,
        }),
      )
    scene(
      { update, view },
      given(withLooks([look])),
      expect(role('heading', { name: 'In your looks' })).toExist(),
      expect(role('link', { name: /^Moja zbirka/ })).toHaveAttr('href', `/looks/${look.id}`),
    )
    scene({ update, view }, given(withLooks([])), expect(role('heading', { name: 'In your looks' })).not.toExist())
  })

  test('deleting confirms in the page and returns to the wardrobe', () => {
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: jeans }))),
      expect(role('button', { name: 'Delete' })).not.toExist(),
      click(role('button', { name: 'Edit' })),
      click(role('button', { name: 'Delete' })),
      expect(role('heading', { name: 'Delete this item?' })).toExist(),
      click(role('button', { name: 'Delete' })),
      expect(role('button', { name: 'Deleting…' })).toBeDisabled(),
      Command.resolve(DeletePiece, PieceMessage.SucceededDeletePiece()),
      Command.expectExact(Navigate({ href: '/wardrobe' })),
      Command.resolve(Navigate({ href: '/wardrobe' }), Message.CompletedNavigate()),
    )
  })

  test('back-photo actions and deletion live in Edit, and cancelling deletion keeps the draft', () => {
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: jeans }))),
      expect(text('Add the back')).not.toExist(),
      expect(text('1 credit from today’s free allowance.')).not.toExist(),
      click(role('button', { name: 'Edit' })),
      expect(role('button', { name: 'Rotate image 90°' })).toExist(),
      expect(text('Add the back')).toExist(),
      expect(role('textbox', { name: 'Name (optional)' })).toHaveValue(''),
      type(role('textbox', { name: 'Name (optional)' }), 'Weekend denim'),
      click(role('button', { name: 'Delete' })),
      click(role('button', { name: 'Cancel' })),
      expect(role('textbox', { name: 'Name (optional)' })).toHaveValue('Weekend denim'),
      click(role('button', { name: 'Save' })),
      expect(role('button', { name: 'Delete' })).toBeDisabled(),
      Command.resolve(SavePiece, PieceMessage.FailedUpdatePiece()),
      expect(role('textbox', { name: 'Name (optional)' })).toHaveValue('Weekend denim'),
    )
  })

  test('editing offers every garment type under its group, as a shop lists them, and the attributes', () => {
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: jeans }))),
      click(role('button', { name: 'Edit' })),
      expect(role('button', { name: 'Jeans' })).toHaveAttr('aria-pressed', 'true'),
      expect(text('Shoes')).toExist(),
      click(role('button', { name: 'Boots' })),
      expect(role('button', { name: 'Boots' })).toHaveAttr('aria-pressed', 'true'),
      expect(role('button', { name: 'Jeans' })).toHaveAttr('aria-pressed', 'false'),
      expect(role('group', { name: 'When it’s worn (optional)' })).toExist(),
      expect(role('button', { name: 'Winter' })).toHaveAttr('aria-pressed', 'false'),
      click(role('button', { name: 'Winter' })),
      expect(role('button', { name: 'Winter' })).toHaveAttr('aria-pressed', 'true'),
      expect(role('button', { name: 'Rainproof' })).toHaveAttr('aria-pressed', 'false'),
      expect(role('textbox', { name: 'Brand (optional)' })).toExist(),
      click(role('button', { name: 'Cancel' })),
      expect(role('heading', { name: 'Jeans' })).toExist(),
    )
  })

  test('a clean picture the owner set aside for the photo is shown again at a tap', () => {
    // The API signs a new address for every picture it shows, so taking the drawing loads a new one.
    const images = {
      thumb: signedPicture(jeans.id, 'thumb', 'photo2'),
      full: signedPicture(jeans.id, 'full', 'photo2'),
      clean: signedPicture(jeans.id, 'thumb', 'clean2'),
    }
    const proposed = { ...jeans, images, picture: { state: 'ready', shows: 'photo', version: 2 } } as const
    const takenImages = { ...images, full: signedPicture(jeans.id, 'full', 'clean2') }
    const taken = { ...jeans, images: takenImages, picture: { state: 'ready', shows: 'clean', version: 2 } } as const
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: proposed }))),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('src', images.full),
      click(role('button', { name: 'Show the clean picture' })),
      Command.resolve(
        ChoosePicture({ pieceId: proposed.id, use: 'clean' }),
        PieceMessage.SucceededChoosePicture({ piece: taken }),
      ),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('src', takenImages.full),
      expect(text('AI-cleaned picture')).toExist(),
      expect(role('button', { name: 'Show my photo' })).toExist(),
    )
  })

  test('redrawing asks what the piece is, and says what a credit buys', () => {
    const shown = pieceFixture('jeans', { picture: { state: 'retake', shows: 'photo', version: 0 } })
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: shown }))),
      expect(text(/Too little of this piece showed/)).toExist(),
      click(role('button', { name: 'Redraw' })),
      type(role('textbox', { name: 'What is it? (optional)' }), 'a navy wool scarf'),
      expect(text('Costs 1 credit, refunded if no picture comes of it.')).toExist(),
      submit(role('form')),
      expect(role('button', { name: 'Redraw' })).toBeDisabled(),
      Command.resolve(
        RedrawPicture({ pieceId: shown.id, hint: 'a navy wool scarf', maybeOperationId: Option.none() }),
        PieceMessage.FailedRedrawPicture({ problem: 'face', operationId: OperationId.make('redraw-0001') }),
      ),
      expect(role('alert')).toHaveText('A face may show in this cut-out, so it is not sent to be drawn.'),
    )
  })

  test('a clean picture offers its turn and its price, and a device that cannot cut the frames says so', () => {
    const clean = { ...jeans, picture: { state: 'ready', shows: 'clean', version: 1 } } as const
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: clean }))),
      expect(role('button', { name: 'Make it turn' })).toExist(),
      expect(text('5 credits, refunded if no turn comes of it.')).toExist(),
    )
    const building = { ...clean, turn: { state: 'building', version: 3 } } as const
    scene(
      { update, view },
      given(
        withPage(piecePage(PieceData.Success({ data: building })), lenses.piece, (piece) =>
          modifyFields(piece, { turnWork: () => TurnWork.Failed({ problem: 'build' }) }),
        ),
      ),
      expect(role('alert')).toHaveText('The turn could not be prepared on this device. Open the piece again to retry.'),
      expect(role('button', { name: 'Make it turn' })).not.toExist(),
    )
  })

  test('a ready turn shows the still until its player has drawn, then the player alone', () => {
    const layout = { frames: 30, columns: 6, width: 288, height: 384, pivot: [0.5, 0.027] } as const
    const turned = {
      ...jeans,
      picture: { state: 'ready', shows: 'clean', version: 1 },
      turn: { state: 'ready', version: 9, layout, media: { sheet: '/test/turn-sheet.png' } },
    } as const
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: turned }))),
      expect(role('button', { name: 'Turn it' })).toExist(),
      expect(text('Tap the picture to turn it.')).toExist(),
      Mount.expectExact(ShowTurn({ sheet: '/test/turn-sheet.png', layout })),
      Mount.resolve(ShowTurn, PieceMessage.ShowedTurn()),
    )
  })

  test('a missing piece says so and leads back to the wardrobe', () => {
    scene(
      { update, view },
      given(piecePage(PieceData.Failure({ error: 'NotFound' }))),
      expect(role('alert')).toHaveText('Item not found'),
      expect(role('link', { name: 'Back to wardrobe' })).toHaveAttr('href', '/wardrobe'),
    )
  })
})
