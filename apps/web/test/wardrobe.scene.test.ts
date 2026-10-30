import { catalogVersion } from '@styld/i18n'
import type { Piece } from '@styld/protocol'
import { Command, click, expect, given, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Session, init, update } from '../src/App.ts'
import { AsyncData } from 'foldkit'
import { ListPieces, Message as WardrobeMessage, PiecesData } from '../src/page/Wardrobe.ts'
import { view } from '../src/View.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }

const wardrobe = (pieces: PiecesData) =>
  modifyFields(
    init({
      locale: 'en',
      catalogVersion,
      timeZone: 'UTC',
      referenceTime: 0,
      pathname: '/wardrobe',
      origin: 'https://styld.test',
      telemetryConsent: 'denied',
    }).model,
    {
      session: () => Session.SignedIn({ claims }),
      wardrobe: (current) => modifyFields(current, { pieces: () => pieces }),
    },
  )

const loaded = (...pieces: ReadonlyArray<Piece>) => wardrobe(PiecesData.Success({ data: pieces }))

const tee = pieceFixture('tee', { name: 'White tee' })
const jeans = pieceFixture('jeans', { category: 'bottom', subcategory: 'jeans' })
const boots = pieceFixture('boots', { category: 'shoes', status: 'processing' })

describe('the wardrobe page', () => {
  test('draws the shape of the grid while the pieces load', () => {
    scene({ update, view }, given(wardrobe(AsyncData.Loading())), expect(role('status')).toHaveText('Loading pieces…'))
  })

  test('shows each piece by name, or by what it is, with a chip for every category it holds', () => {
    scene(
      { update, view },
      given(loaded(tee, jeans)),
      expect(role('link', { name: 'White tee' })).toHaveAttr('href', `/wardrobe/${tee.id}`),
      expect(role('img', { name: 'Jeans' })).toHaveAttr('src', `/cdn/pieces/${jeans.id}/thumb`),
      expect(role('button', { name: 'All 2' })).toHaveAttr('aria-pressed', 'true'),
      expect(role('button', { name: 'Bottoms 1' })).toExist(),
      expect(role('button', { name: 'Shoes 1' })).not.toExist(),
      click(role('button', { name: 'Bottoms 1' })),
      expect(role('button', { name: 'Bottoms 1' })).toHaveAttr('aria-pressed', 'true'),
      expect(role('link', { name: 'White tee' })).not.toExist(),
      expect(role('link', { name: 'Jeans' })).toExist(),
    )
  })

  test('a piece still processing says so', () => {
    scene({ update, view }, given(loaded(boots)), expect(text('Processing')).toExist())
  })

  test('an empty wardrobe offers the one action that fills it', () => {
    scene(
      { update, view },
      given(loaded()),
      expect(role('heading', { name: 'No pieces in your wardrobe yet' })).toExist(),
      expect(role('link', { name: 'Add your first pieces' })).toHaveAttr('href', '/wardrobe/add'),
      expect(role('link', { name: 'Add pieces' })).toHaveAttr('href', '/wardrobe/add'),
    )
  })

  test('a wardrobe that cannot load says what broke and how to try again', () => {
    scene(
      { update, view },
      given(wardrobe(PiecesData.Failure({ error: 'Unavailable' }))),
      expect(role('alert')).toHaveText('Could not load pieces. Try again.'),
      click(role('button', { name: 'Try again' })),
      expect(role('status')).toHaveText('Loading pieces…'),
      Command.resolve(ListPieces, WardrobeMessage.SucceededListPieces({ pieces: [] })),
    )
  })

  test('the signed-in shell names the current section', () => {
    scene(
      { update, view },
      given(loaded()),
      expect(role('navigation', { name: 'Navigation' })).toExist(),
      expect(role('link', { name: 'Wardrobe' })).toHaveAttr('aria-current', 'page'),
      expect(role('link', { name: 'Home' })).not.toHaveAttr('aria-current'),
    )
  })
})
