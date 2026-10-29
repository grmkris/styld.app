import { catalogVersion } from '@styld/i18n'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { Message, Navigate, ReadSession, Session, init, update } from '../src/App.ts'
import { Message as AddPieceMessage } from '../src/page/AddPiece.ts'
import { AppRoute } from '../src/route.ts'
import { pageAt } from './WardrobeFixtures.ts'

const page = pageAt

const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }

describe('the session decides where a visitor belongs', () => {
  test('a visitor without a session is sent from their account or wardrobe to sign in', () => {
    for (const pathname of ['/account', '/wardrobe', '/wardrobe/add', '/wardrobe/pc_abc'])
      story(
        update,
        given(page(pathname)),
        message(Message.ReceivedSession({ claims: null })),
        Command.expectExact(Navigate({ href: '/login' })),
        Command.resolve(Navigate({ href: '/login' }), Message.CompletedNavigate()),
        model(({ session }) => expect(Session.guards.SignedOut(session)).toBe(true)),
      )
  })

  test('a signed-in visitor who opens sign-in goes straight to their account', () => {
    story(
      update,
      given(page('/login')),
      message(Message.ReceivedSession({ claims })),
      model(({ session }) => expect(Session.guards.SignedIn(session)).toBe(true)),
      Command.expectExact(Navigate({ href: '/account' })),
      Command.resolve(Navigate({ href: '/account' }), Message.CompletedNavigate()),
    )
  })

  test('a signed-in visitor sent to sign in by an assistant resumes its authorization', () => {
    story(
      update,
      given(page('/login/connect')),
      message(Message.ReceivedSession({ claims })),
      model(({ session }) => expect(Session.guards.SignedIn(session)).toBe(true)),
      Command.expectExact(Navigate({ href: '/oauth/mcp/authorize' })),
      Command.resolve(Navigate({ href: '/oauth/mcp/authorize' }), Message.CompletedNavigate()),
    )
  })

  test('pages open to everyone stay put whatever the session', () => {
    for (const claimsRead of [null, claims])
      story(
        update,
        given(page('/')),
        message(Message.ReceivedSession({ claims: claimsRead })),
        Command.expectNone(),
        model(({ route }) => expect(route).toEqual(AppRoute.Home())),
      )
  })

  test('an unreadable session offers a retry that reads it again', () => {
    story(
      update,
      given(page('/account')),
      message(Message.FailedReadSession()),
      model(({ session }) => expect(Session.guards.Unavailable(session)).toBe(true)),
      message(Message.RequestedSession()),
      Command.expectExact(ReadSession),
      Command.resolve(ReadSession, Message.ReceivedSession({ claims })),
      model(({ session }) => expect(Session.guards.SignedIn(session)).toBe(true)),
    )
  })
})

const opening = (pathname: string) =>
  (
    init({
      locale: 'en',
      catalogVersion,
      timeZone: 'UTC',
      referenceTime: 0,
      pathname,
      origin: 'https://styld.test',
      telemetryConsent: 'denied',
    }).commands ?? []
  ).map(({ name }) => name)

describe('the wardrobe pages', () => {
  test('each page asks for what it shows as it opens', () => {
    expect(opening('/wardrobe')).toEqual(['ReadSession', 'ListPieces'])
    expect(opening('/wardrobe/pc_abc')).toEqual(['ReadSession', 'GetPiece'])
    expect(opening('/wardrobe/add')).toEqual(['ReadSession'])
  })

  test('a piece just added opens on its own page', () => {
    story(
      update,
      given(page('/wardrobe/add')),
      message(Message.GotAddPieceMessage({ message: AddPieceMessage.SucceededAddPiece({ pieceId: 'pc_new' }) })),
      Command.expectExact(Navigate({ href: '/wardrobe/pc_new' })),
      Command.resolve(Navigate({ href: '/wardrobe/pc_new' }), Message.CompletedNavigate()),
      model(({ route }) => expect(AppRoute.guards.AddPiece(route)).toBe(true)),
    )
  })
})
