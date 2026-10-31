import { catalogVersion } from '@styld/i18n'
import { Option } from 'effect'
import { Command, Mount, click, expect, given, role, scene, submit, text, type } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Message, Session, init, update } from '../src/App.ts'
import { Navigate } from '../src/Navigation.ts'
import {
  ChoosePicture,
  DeletePiece,
  Load,
  Message as PieceMessage,
  RedrawPicture,
  ShowTurn,
} from '../src/page/Piece.ts'
import { view } from '../src/View.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }
const jeans = pieceFixture('jeans', {
  category: 'bottom',
  subcategory: 'jeans',
  colours: ['navy'],
  notes: 'Hem taken up',
})

const piecePage = (load: typeof Load.Type) =>
  modifyFields(
    init({
      locale: 'en',
      catalogVersion,
      timeZone: 'UTC',
      referenceTime: 0,
      pathname: `/wardrobe/${jeans.id}`,
      origin: 'https://styld.test',
      telemetryConsent: 'denied',
    }).model,
    { session: () => Session.SignedIn({ claims }), piece: (piece) => modifyFields(piece, { load: () => load }) },
  )

describe('the piece page', () => {
  test('shows the photo, what it is, its colours and notes', () => {
    scene(
      { update, view },
      given(piecePage(Load.Loaded({ piece: jeans }))),
      expect(role('heading', { name: 'Jeans' })).toExist(),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('src', `/cdn/pieces/${jeans.id}/full`),
      // Unnamed, its title already says what it is: no line repeating it.
      expect(text('Colour')).toExist(),
      expect(text('Navy')).toExist(),
      expect(text('Hem taken up')).toExist(),
      // Save to board is the one action; Edit waits at the bar's end.
      expect(role('button', { name: 'Edit' })).toExist(),
    )
  })

  test('a named piece says what one of its kind is under its name', () => {
    scene(
      { update, view },
      given(piecePage(Load.Loaded({ piece: { ...jeans, name: 'Weekend denim' } }))),
      expect(role('heading', { name: 'Weekend denim' })).toExist(),
      expect(text('Jeans')).toExist(),
    )
  })

  test('deleting confirms in the page and returns to the wardrobe', () => {
    scene(
      { update, view },
      given(piecePage(Load.Loaded({ piece: jeans }))),
      click(role('button', { name: 'Delete' })),
      expect(role('heading', { name: 'Delete this item?' })).toExist(),
      click(role('button', { name: 'Delete' })),
      expect(role('button', { name: 'Deleting…' })).toBeDisabled(),
      Command.resolve(DeletePiece, PieceMessage.SucceededDeletePiece()),
      Command.expectExact(Navigate({ href: '/wardrobe' })),
      Command.resolve(Navigate({ href: '/wardrobe' }), Message.CompletedNavigate()),
    )
  })

  test('editing offers the shelves of the chosen category', () => {
    scene(
      { update, view },
      given(piecePage(Load.Loaded({ piece: jeans }))),
      click(role('button', { name: 'Edit' })),
      expect(role('button', { name: 'Jeans' })).toHaveAttr('aria-pressed', 'true'),
      click(role('button', { name: 'Shoes' })),
      expect(role('button', { name: 'Boots' })).toHaveAttr('aria-pressed', 'false'),
      expect(role('button', { name: 'Jeans' })).not.toExist(),
      click(role('button', { name: 'Cancel' })),
      expect(role('heading', { name: 'Jeans' })).toExist(),
    )
  })

  test('a proposed clean picture waits beside the photo until the owner takes it', () => {
    const proposed = { ...jeans, picture: { state: 'proposed', shows: 'photo', version: 2 } } as const
    const taken = { ...jeans, picture: { state: 'proposed', shows: 'clean', version: 2 } } as const
    scene(
      { update, view },
      given(piecePage(Load.Loaded({ piece: proposed }))),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('src', `/cdn/pieces/${proposed.id}/full?v=photo2`),
      expect(role('img', { name: 'AI-cleaned picture' })).toHaveAttr(
        'src',
        `/cdn/pieces/${proposed.id}/clean/thumb?v=2`,
      ),
      click(role('button', { name: 'Use this picture' })),
      Command.resolve(
        ChoosePicture({ pieceId: proposed.id, use: 'clean' }),
        PieceMessage.SucceededChoosePicture({ piece: taken }),
      ),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('src', `/cdn/pieces/${proposed.id}/full?v=clean2`),
      expect(text('AI-cleaned picture')).toExist(),
      expect(role('button', { name: 'Show my photo' })).toExist(),
    )
  })

  test('redrawing asks what the piece is, and says what a credit buys', () => {
    const shown = pieceFixture('jeans', { picture: { state: 'retake', shows: 'photo', version: 0 } })
    scene(
      { update, view },
      given(piecePage(Load.Loaded({ piece: shown }))),
      expect(text(/Too little of this piece showed/)).toExist(),
      click(role('button', { name: 'Redraw' })),
      type(role('textbox', { name: 'What is it? (optional)' }), 'a navy wool scarf'),
      expect(text('Costs 1 credit, refunded if no picture comes of it.')).toExist(),
      submit(role('form')),
      expect(role('button', { name: 'Redraw' })).toBeDisabled(),
      Command.resolve(
        RedrawPicture({ pieceId: shown.id, hint: 'a navy wool scarf', operationId: Option.none() }),
        PieceMessage.FailedRedrawPicture({ problem: 'face', operationId: 'redraw-0001' }),
      ),
      expect(role('alert')).toHaveText('A face may show in this cut-out, so it is not sent to be drawn.'),
    )
  })

  test('a clean picture offers its turn and its price, and a device that cannot cut the frames says so', () => {
    const clean = { ...jeans, picture: { state: 'ready', shows: 'clean', version: 1 } } as const
    scene(
      { update, view },
      given(piecePage(Load.Loaded({ piece: clean }))),
      expect(role('button', { name: 'Make it turn' })).toExist(),
      expect(text('5 credits, refunded if no turn comes of it.')).toExist(),
    )
    const building = { ...clean, turn: { state: 'building', version: 3 } } as const
    scene(
      { update, view },
      given(
        modifyFields(piecePage(Load.Loaded({ piece: building })), {
          piece: (piece) => modifyFields(piece, { turnProblem: () => Option.some('build' as const) }),
        }),
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
      turn: { state: 'ready', version: 9, layout },
    } as const
    scene(
      { update, view },
      given(piecePage(Load.Loaded({ piece: turned }))),
      expect(role('button', { name: 'Turn it' })).toExist(),
      expect(text('Tap the picture to turn it.')).toExist(),
      Mount.expectExact(ShowTurn({ pieceId: turned.id, version: 9, layout })),
      Mount.resolve(ShowTurn, PieceMessage.ShowedTurn()),
    )
  })

  test('a missing piece says so and leads back to the wardrobe', () => {
    scene(
      { update, view },
      given(piecePage(Load.Missing())),
      expect(role('alert')).toHaveText('Item not found'),
      expect(role('link', { name: 'Back to wardrobe' })).toHaveAttr('href', '/wardrobe'),
    )
  })
})
