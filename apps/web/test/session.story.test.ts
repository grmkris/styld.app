import { catalogVersion } from '@styld/i18n'
import { Day } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import { Message, ReadSession, Session, init, update } from '../src/App.ts'
import { Navigate } from '../src/Navigation.ts'
import { Message as AddPiecesMessage } from '../src/page/AddPieces/Message.ts'
import { Message as ReviewMessage } from '../src/page/Review.ts'
import * as Today from '../src/page/Today.ts'
import * as Wardrobe from '../src/page/Wardrobe.ts'
import { AppRoute } from '../src/route.ts'
import { pageAt } from './WardrobeFixtures.ts'

const page = pageAt

const thursday = Schema.decodeUnknownSync(Day)('2026-10-29')

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
    story(
      update,
      given(page('/')),
      message(Message.ReceivedSession({ claims: null })),
      Command.expectNone(),
      model(({ route }) => expect(route).toEqual(AppRoute.Home())),
    )
  })

  test('a signed-in visitor stays on Home, which lays out the table for today', () => {
    story(
      update,
      given(page('/')),
      message(Message.ReceivedSession({ claims })),
      // The table is laid from the wardrobe's pieces, which every page shares.
      Command.expectExact(Today.DetermineDay, Today.ListBoards, Today.ReadTray, Today.ReadFeed, Wardrobe.ListPieces),
      Command.resolve(Wardrobe.ListPieces, Wardrobe.Message.FailedListPieces()),
      Command.resolve(Today.ListBoards, Today.Message.FailedListBoards()),
      Command.resolve(Today.ReadTray, Today.Message.FailedReadTray()),
      Command.resolve(Today.ReadFeed, Today.Message.FailedReadFeed()),
      Command.resolve(Today.DetermineDay, Today.Message.CompletedDetermineDay({ day: thursday })),
      // Knowing the day, Home asks what was worn on it.
      Command.resolve(Today.ReadWorn, Today.Message.FailedReadWorn()),
      model(({ route, today }) => {
        expect(route).toEqual(AppRoute.Home())
        expect(today.maybeDay).toEqual(Option.some(thursday))
      }),
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
    expect(opening('/wardrobe')).toEqual(['ReadSession', 'ListPieces', 'CountUndrawn'])
    expect(opening('/wardrobe/pc_abc')).toEqual(['ReadSession', 'GetPiece'])
    expect(opening('/wardrobe/add')).toEqual(['ReadSession'])
    expect(opening('/wardrobe/review')).toEqual(['ReadSession', 'LoadTray'])
    expect(opening('/looks')).toEqual(['ReadSession', 'ListLooks'])
    expect(opening(`/looks/lk_${'a'.repeat(22)}`)).toEqual(['ReadSession', 'GetLook'])
  })

  test('the review tray opens once the files are sent, and the wardrobe once pieces are kept', () => {
    story(
      update,
      given(page('/wardrobe/add')),
      message(Message.GotAddPiecesMessage({ message: AddPiecesMessage.ClickedReview() })),
      Command.expectExact(Navigate({ href: '/wardrobe/review' })),
      Command.resolve(Navigate({ href: '/wardrobe/review' }), Message.CompletedNavigate()),
    )
    story(
      update,
      given(page('/wardrobe/review')),
      message(Message.GotReviewMessage({ message: ReviewMessage.SucceededReview({ count: 2 }) })),
      Command.expectExact(Navigate({ href: '/wardrobe' })),
      Command.resolve(Navigate({ href: '/wardrobe' }), Message.CompletedNavigate()),
      model(({ route }) => expect(AppRoute.guards.Review(route)).toBe(true)),
    )
  })
})
