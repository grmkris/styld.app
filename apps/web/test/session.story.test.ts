import { Day } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'
import { Message, ReadSession, Session, init, update } from '../src/App.ts'
import { ListBoards, ListPieces, Message as DataMessage } from '../src/ServerData.ts'
import { ReadYou, You } from '../src/You.ts'
import { Navigate } from '../src/Navigation.ts'
import { Message as AddPiecesMessage } from '../src/page/AddPieces/Message.ts'
import { Message as ReviewMessage } from '../src/page/Review.ts'
import * as Today from '../src/page/Today.ts'
import { AppRoute } from '../src/route.ts'
import { lenses } from '../src/Page.ts'
import { at, claims, flags, pageOf, urlOf } from './AppFixtures.ts'

const page = (path: string) => at(path, { signedIn: false })

const thursday = Schema.decodeUnknownSync(Day)('2026-10-29')

/** Sign-in opened from a page, asked to return to `next` once signed in. */
const atLogin = (next: string) =>
  modifyFields(page('/login'), { route: () => AppRoute.Login({ next: Option.some(next) }) })

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

  test('a signed-in visitor who signed in from a page goes back to it, and only to a page of this site', () => {
    const elsewhere = [
      '//evil.example/@nika',
      '/\\evil.example',
      '/\tevil.example',
      'https://evil.example/',
      'javascript:alert(1)',
      '@nika.kovac',
      '',
      '/login',
      '/login/connect',
      '/no/such/page',
    ]
    // Back to the page; anywhere else, the account. Only a Follow pressed in this tab follows there (SignInReturn).
    const cases = [
      ['/@nika.kovac#follow', '/@nika.kovac#follow'],
      ['/boards/bd_1?from=explore#pins', '/boards/bd_1?from=explore#pins'],
      ...elsewhere.map((next) => [next, '/account']),
    ] as const
    for (const [next, href] of cases)
      story(
        update,
        given(atLogin(next)),
        message(Message.ReceivedSession({ claims })),
        model(({ session }) => expect(Session.guards.SignedIn(session)).toBe(true)),
        Command.expectExact(Navigate({ href })),
        Command.resolve(Navigate({ href }), Message.CompletedNavigate()),
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
      Command.expectExact(
        Today.DetermineDay,
        Today.ReadFavourite,
        Today.ReadTray,
        Today.ReadFeed,
        ListPieces,
        ListBoards,
        ReadYou,
      ),
      Command.resolve(ReadYou, Message.FailedReadYou()),
      Command.resolve(ListPieces, DataMessage.FailedListPieces()),
      Command.resolve(ListBoards, DataMessage.FailedListBoards()),
      Command.resolve(Today.ReadFavourite, Today.Message.FailedReadFavourite()),
      Command.resolve(Today.ReadTray, Today.Message.FailedReadTray()),
      Command.resolve(Today.ReadFeed, Today.Message.FailedReadFeed()),
      Command.resolve(Today.DetermineDay, Today.Message.CompletedDetermineDay({ day: thursday })),
      // Knowing the day, Home asks the outfit engine for today's outfits and what was worn on it.
      Command.resolve(Today.MakeOutfits, Today.Message.FailedMakeOutfits()),
      Command.resolve(Today.ReadWorn, Today.Message.FailedReadWorn()),
      model((current) => {
        expect(current.route).toEqual(AppRoute.Home())
        expect(pageOf(current, lenses.today).maybeDay).toEqual(Option.some(thursday))
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
      Command.resolve(ReadYou, Message.FailedReadYou()),
    )
  })

  test('once signed in, the masthead shows the profile as others see it, and the sign-in name if it has none', () => {
    story(
      update,
      given(page('/account')),
      message(Message.ReceivedSession({ claims })),
      // Blank while the profile is read, so the sign-in initial never shows first.
      model(({ you }) => expect(you).toEqual(You.Reading())),
      Command.resolve(ReadYou, Message.SucceededReadYou({ name: 'Kris (preview)', tone: 'sage' })),
      model(({ you }) => expect(you).toEqual(You.Known({ name: 'Kris (preview)', tone: 'sage' }))),
      message(Message.SucceededReadYou({ name: '  ', tone: 'sage' })),
      model(({ you }) => expect(you).toEqual(You.Unknown())),
    )
  })
})

const opening = (path: string) => (init(flags(false), urlOf(path)).commands ?? []).map(({ name }) => name)

describe('the time zone', () => {
  test('times read in the browser’s own zone once the page runs; the server’s first paint is in UTC', () => {
    const opened = page('/ask/stylist')
    expect(opened.context.timeZone).toBe('UTC')
    const read = update(opened, Message.SucceededReadTimeZone({ timeZone: 'Europe/Ljubljana' }))
    expect(read.model.context.timeZone).toBe('Europe/Ljubljana')
  })
})

describe('the wardrobe pages', () => {
  test('each page asks for what it shows as it opens', () => {
    expect(opening('/wardrobe')).toEqual(['ReadSession', 'ReadTimeZone', 'ListPieces'])
    expect(opening('/wardrobe/pc_abc')).toEqual(['ReadSession', 'ReadTimeZone', 'GetPiece', 'ListPiecePhotos'])
    expect(opening('/wardrobe/add')).toEqual(['ReadSession', 'ReadTimeZone'])
    expect(opening('/wardrobe/review')).toEqual(['ReadSession', 'ReadTimeZone', 'LoadTray'])
    expect(opening('/looks')).toEqual(['ReadSession', 'ReadTimeZone', 'ListLooks'])
    expect(opening(`/looks/lk_${'a'.repeat(22)}`)).toEqual(['ReadSession', 'ReadTimeZone', 'GetLook'])
    expect(opening('/wardrobe/gallery')).toEqual(['ReadSession', 'ReadTimeZone', 'ListPhotos'])
    expect(opening(`/wardrobe/gallery/ph_${'a'.repeat(22)}`)).toEqual([
      'ReadSession',
      'ReadTimeZone',
      'GetPhoto',
      'ListPieces',
    ])
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
