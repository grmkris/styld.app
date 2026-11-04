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
      expect(role('button', { name: 'Your photo' })).toHaveAttr('aria-current', 'true'),
      click(role('button', { name: 'Back' })),
      expect(role('img', { name: 'Coat, back' })).toExist(),
      expect(role('button', { name: 'Back' })).toHaveAttr('aria-current', 'true'),
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
      expect(text('1 credit.')).not.toExist(),
      click(role('button', { name: 'Edit' })),
      expect(role('button', { name: 'Rotate image 90°' })).toExist(),
      expect(text('Add the back')).toExist(),
      expect(text('1 credit.')).not.toExist(),
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

  test('shows the shop-style picture first, the photo, the cut-out and the back one swipe or dot away', () => {
    const images = {
      thumb: signedPicture(jeans.id, 'thumb', 'clean2'),
      full: signedPicture(jeans.id, 'full', 'clean2'),
      clean: signedPicture(jeans.id, 'full', 'drawing2'),
      photo: signedPicture(jeans.id, 'full', 'original'),
      cutout: signedPicture(jeans.id, 'full', 'cutout'),
      back: signedPicture(jeans.id, 'full', 'back'),
    }
    const drawn = {
      ...jeans,
      images,
      hasBack: true,
      picture: { state: 'ready', shows: 'clean', version: 2 },
    } as const
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: drawn }))),
      // The drawing is the main picture, and shows first.
      expect(role('img', { name: 'Jeans' })).toHaveAttr('src', images.clean),
      expect(role('button', { name: 'Shop-style picture' })).toHaveAttr('aria-current', 'true'),
      expect(text('Main picture')).toExist(),
      expect(role('button', { name: 'Use as the main picture' })).not.toExist(),
      click(role('button', { name: 'Your photo' })),
      expect(role('img', { name: 'Jeans, Your photo' })).toHaveAttr('src', images.photo),
      // The photo a cut-out was made from is not a picture the wardrobe can show.
      expect(role('button', { name: 'Use as the main picture' })).not.toExist(),
      click(role('button', { name: 'Cut-out' })),
      expect(role('img', { name: 'Jeans, Cut-out' })).toHaveAttr('src', images.cutout),
      expect(role('button', { name: 'Use as the main picture' })).toExist(),
      click(role('button', { name: 'Back' })),
      expect(role('img', { name: 'Jeans, back' })).toHaveAttr('src', images.back),
      expect(role('button', { name: 'Use as the main picture' })).not.toExist(),
    )
  })

  test('turns to the back drawn from the person’s photo of it, which itself comes last', () => {
    const images = {
      thumb: signedPicture(jeans.id, 'thumb', 'clean2'),
      full: signedPicture(jeans.id, 'full', 'clean2'),
      clean: signedPicture(jeans.id, 'full', 'drawing2'),
      backClean: signedPicture(jeans.id, 'full', 'backClean1'),
      photo: signedPicture(jeans.id, 'full', 'original'),
      cutout: signedPicture(jeans.id, 'full', 'cutout'),
      back: signedPicture(jeans.id, 'full', 'back'),
    }
    const turned = { ...jeans, images, hasBack: true, picture: { state: 'ready', shows: 'clean', version: 2 } } as const
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: turned }))),
      click(role('button', { name: 'Back' })),
      expect(role('img', { name: 'Jeans, back' })).toHaveAttr('src', images.backClean),
      expect(text('Drawn by AI from your cut-out')).toExist(),
      expect(role('button', { name: 'Use as the main picture' })).not.toExist(),
      click(role('button', { name: 'Your photo of the back' })),
      expect(role('img', { name: 'Jeans, back' })).toHaveAttr('src', images.back),
    )
  })

  test('the cut-out, or the drawing again, becomes the main picture from its slide', () => {
    // The API signs a new address for every picture it shows, so a new main picture loads a new one.
    const images = {
      thumb: signedPicture(jeans.id, 'thumb', 'clean2'),
      full: signedPicture(jeans.id, 'full', 'clean2'),
      clean: signedPicture(jeans.id, 'full', 'drawing2'),
      photo: signedPicture(jeans.id, 'full', 'original'),
      cutout: signedPicture(jeans.id, 'full', 'cutout'),
    }
    const drawn = { ...jeans, images, picture: { state: 'ready', shows: 'clean', version: 2 } } as const
    const photoImages = { ...images, full: signedPicture(jeans.id, 'full', 'photo2') }
    const setAside = { ...drawn, images: photoImages, picture: { state: 'ready', shows: 'photo', version: 2 } } as const
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: drawn }))),
      click(role('button', { name: 'Cut-out' })),
      click(role('button', { name: 'Use as the main picture' })),
      Command.resolve(
        ChoosePicture({ pieceId: drawn.id, use: 'photo' }),
        PieceMessage.SucceededChoosePicture({ piece: setAside }),
      ),
      // The cut-out stays on screen, now the main picture.
      expect(role('img', { name: 'Jeans' })).toHaveAttr('src', images.cutout),
      expect(text('Main picture')).toExist(),
      click(role('button', { name: 'Shop-style picture' })),
      expect(text('Drawn by AI from your cut-out')).toExist(),
      click(role('button', { name: 'Use as the main picture' })),
      Command.resolve(ChoosePicture({ pieceId: drawn.id, use: 'clean' }), PieceMessage.FailedChoosePicture()),
      expect(role('alert')).toHaveText('The picture could not be changed. Try again.'),
    )
  })

  test('while a drawing is being made its slide says so, and the page opens on the cut-out meanwhile', () => {
    const images = {
      thumb: signedPicture(jeans.id, 'thumb', 'photo0'),
      full: signedPicture(jeans.id, 'full', 'photo0'),
      photo: signedPicture(jeans.id, 'full', 'original'),
      cutout: signedPicture(jeans.id, 'full', 'cutout'),
    }
    const making = { ...jeans, images, picture: { state: 'drawing', shows: 'photo', version: 0 } } as const
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: making }))),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('src', images.cutout),
      expect(role('button', { name: 'Cut-out' })).toHaveAttr('aria-current', 'true'),
      expect(role('button', { name: 'Redraw' })).not.toExist(),
      click(role('button', { name: 'Shop-style picture' })),
      expect(role('status')).toHaveText('Making a shop-style picture…'),
      expect(role('button', { name: 'Use as the main picture' })).not.toExist(),
    )
  })

  test('Rotate turns the picture by what is not saved yet, and once saved the server alone turns it', () => {
    // The server delivers the photo and the cut-out already turned by the saved rotation (signed addresses carry it).
    const images = {
      thumb: signedPicture(jeans.id, 'thumb', 'r0'),
      full: signedPicture(jeans.id, 'full', 'r0'),
      photo: signedPicture(jeans.id, 'full', 'original-r0'),
      cutout: signedPicture(jeans.id, 'full', 'cutout-r0'),
    }
    const upright = { ...jeans, images }
    const turnedImages = { ...images, cutout: signedPicture(jeans.id, 'full', 'cutout-r180') }
    const saved = { ...jeans, images: turnedImages, rotation: 180 } as const
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: upright }))),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('data-rotation', '0'),
      click(role('button', { name: 'Edit' })),
      click(role('button', { name: 'Rotate image 90°' })),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('data-rotation', '90'),
      click(role('button', { name: 'Rotate image 90°' })),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('data-rotation', '180'),
      submit(role('form')),
      Command.resolve(SavePiece, PieceMessage.SucceededUpdatePiece({ piece: saved })),
      // The turned address alone: no turn on top of it.
      expect(role('img', { name: 'Jeans' })).toHaveAttr('src', turnedImages.cutout),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('data-rotation', '0'),
      click(role('button', { name: 'Edit' })),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('data-rotation', '0'),
      click(role('button', { name: 'Rotate image 90°' })),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('data-rotation', '90'),
    )
  })

  test('Rotate turns the shop-style picture too, and its turn by the drawing’s own turn and what is not saved yet', () => {
    // Eva, 4 November: Rotate turned the cut-out but never the shop-style picture.
    const images = { thumb: '/test/thumb', full: '/test/full', clean: '/test/clean' }
    const drawn = { ...jeans, images, picture: { state: 'ready', shows: 'clean', version: 1 } } as const
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: drawn }))),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('src', images.clean),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('data-rotation', '0'),
      click(role('button', { name: 'Edit' })),
      click(role('button', { name: 'Rotate image 90°' })),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('data-rotation', '90'),
    )
    // The turn's frames are served as they were made: the browser turns them by the drawing's turn.
    const layout = { frames: 30, columns: 6, width: 288, height: 384, pivot: [0.5, 0.027] } as const
    const turning = {
      ...drawn,
      rotation: 180,
      picture: { state: 'ready', shows: 'clean', version: 1, rotation: 180 },
      turn: { state: 'ready', version: 9, layout, media: { sheet: '/test/turn-sheet.png' } },
    } as const
    scene(
      { update, view },
      given(piecePage(PieceData.Success({ data: turning }))),
      Mount.resolve(ShowTurn, PieceMessage.ShowedTurn()),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('data-rotation', '180'),
      click(role('button', { name: 'Edit' })),
      click(role('button', { name: 'Rotate image 90°' })),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('data-rotation', '270'),
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
        PieceMessage.FailedRedrawPicture({ problem: 'busy', operationId: OperationId.make('redraw-0001') }),
      ),
      expect(role('alert')).toHaveText('A clean picture of this piece is already being drawn.'),
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
      images: { thumb: '/test/thumb', full: '/test/full', clean: '/test/clean' },
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
