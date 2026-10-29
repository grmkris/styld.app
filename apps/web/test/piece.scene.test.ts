import { catalogVersion } from '@styld/i18n'
import { Command, click, expect, given, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Message, Navigate, Session, init, update } from '../src/App.ts'
import { DeletePiece, Load, Message as PieceMessage } from '../src/page/Piece.ts'
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
      expect(text('Bottoms, Jeans')).toExist(),
      expect(role('img', { name: 'Navy' })).toExist(),
      expect(text('Hem taken up')).toExist(),
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
      expect(text('Bottoms, Jeans')).toExist(),
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
