import { Option } from 'effect'
import { AsyncData } from 'foldkit'
import { UrlRequest } from 'foldkit/navigation'
import { modifyFields } from 'foldkit/struct'
import { Command, given, message, model, story } from 'foldkit/story'
import { fromString, type Url } from 'foldkit/url'
import { describe, expect, test } from 'vitest'
import { Message, Session, update } from '../src/App.ts'
import {
  FocusPageTitle,
  followLink,
  isTabChange,
  Navigate,
  NavigateInternal,
  ScrollToAnchor,
  ScrollToTop,
} from '../src/Navigation.ts'
import { LoadProfile, Message as AccountMessage } from '../src/page/Account.ts'
import { LoadSearchLanguages, Message as AskMessage } from '../src/page/Ask.ts'
import { ListLooks, Message as LooksMessage } from '../src/page/Looks.ts'
import { CountUndrawn, ListPieces, Message as WardrobeMessage, PiecesData } from '../src/page/Wardrobe.ts'
import { AppRoute } from '../src/route.ts'
import { pageAt, pieceFixture } from './WardrobeFixtures.ts'

const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }
const urlOf = (path: string): Url =>
  Option.getOrThrowWith(fromString(`https://styld.test${path}`), () => new Error(`Not a URL: ${path}`))
const internal = (path: string) => UrlRequest.Internal({ url: urlOf(path) })
const names = (commands: ReadonlyArray<{ readonly name: string }>) => commands.map(({ name }) => name)
const signedIn = (path: string) => modifyFields(pageAt(path), { session: () => Session.SignedIn({ claims }) })
const tee = pieceFixture('tee', { name: 'White tee' })

describe('following a link', () => {
  test('between tab pages the page stays and only the address changes', () => {
    expect(names(followLink(AppRoute.Wardrobe(), true, internal('/ask')))).toEqual(['NavigateInternal'])
    expect(names(followLink(AppRoute.Home(), true, internal('/account')))).toEqual(['NavigateInternal'])
  })

  test('the board editor, a piece, a look and capture load whole, and so does every link from capture', () => {
    for (const path of [
      `/boards/bd_${'a'.repeat(22)}`,
      '/wardrobe/pc_abc',
      `/looks/lk_${'a'.repeat(22)}`,
      '/wardrobe/add',
    ])
      expect({ path, commands: names(followLink(AppRoute.Wardrobe(), true, internal(path))) }).toEqual({
        path,
        commands: ['Navigate'],
      })
    expect(names(followLink(AppRoute.AddPieces(), true, internal('/wardrobe')))).toEqual(['Navigate'])
    expect(names(followLink(AppRoute.Home(), true, UrlRequest.External({ href: 'mailto:hello@styld.app' })))).toEqual([
      'Navigate',
    ])
  })

  test('someone signed out loads whole; the current tab scrolls back up; a section of it is scrolled to', () => {
    expect(names(followLink(AppRoute.Home(), false, internal('/wardrobe')))).toEqual(['Navigate'])
    expect(names(followLink(AppRoute.Wardrobe(), true, internal('/wardrobe')))).toEqual(['ScrollToTop'])
    expect(names(followLink(AppRoute.Home(), false, internal('/#inspiration')))).toEqual(['NavigateInternal'])
  })

  test('only a change of tab cross-fades', () => {
    expect(isTabChange(AppRoute.Home(), AppRoute.Wardrobe())).toBe(true)
    expect(isTabChange(AppRoute.Ask({ q: Option.none() }), AppRoute.Ask({ q: Option.none() }))).toBe(false)
  })
})

describe('opening a tab page inside the page', () => {
  test('a page seen before shows its pieces at once and asks for them again behind them', () => {
    story(
      update,
      given(
        modifyFields(signedIn('/wardrobe'), {
          wardrobe: (wardrobe) => modifyFields(wardrobe, { pieces: () => PiecesData.Success({ data: [tee] }) }),
        }),
      ),
      message(Message.ChangedUrl({ url: urlOf('/ask') })),
      model(({ route, wardrobe }) => {
        expect(route).toEqual(AppRoute.Ask({ q: Option.none() }))
        expect(wardrobe.pieces).toEqual(PiecesData.Refreshing({ data: [tee] }))
      }),
      Command.expectExact(ListPieces, LoadSearchLanguages, ScrollToTop, FocusPageTitle),
      Command.resolve(ListPieces, WardrobeMessage.SucceededListPieces({ pieces: [tee] })),
      Command.resolve(LoadSearchLanguages, AskMessage.SucceededLoadSearchLanguages()),
      Command.resolve(ScrollToTop, Message.CompletedScrollToTop()),
      Command.resolve(FocusPageTitle, Message.CompletedFocusPageTitle()),
      model(({ wardrobe }) => expect(AsyncData.isSuccess(wardrobe.pieces)).toBe(true)),
    )
  })

  test('a first visit asks, and a request already on its way is not sent again', () => {
    story(
      update,
      given(signedIn('/wardrobe')),
      message(Message.ChangedUrl({ url: urlOf('/looks') })),
      model(({ looks }) => expect(AsyncData.isLoading(looks.saved)).toBe(true)),
      Command.expectExact(ListLooks, ScrollToTop, FocusPageTitle),
      Command.resolve(ListLooks, LooksMessage.SucceededListLooks({ looks: [] })),
      Command.resolve(ScrollToTop, Message.CompletedScrollToTop()),
      Command.resolve(FocusPageTitle, Message.CompletedFocusPageTitle()),
    )
    story(
      update,
      given(
        modifyFields(signedIn('/ask'), {
          wardrobe: (wardrobe) => modifyFields(wardrobe, { pieces: () => PiecesData.Refreshing({ data: [tee] }) }),
        }),
      ),
      message(Message.ChangedUrl({ url: urlOf('/wardrobe') })),
      // The pieces on their way are not asked for again; the count of pieces without a clean picture is.
      Command.expectExact(CountUndrawn, ScrollToTop, FocusPageTitle),
      Command.resolve(CountUndrawn, WardrobeMessage.CompletedCountUndrawn({ pieces: 0 })),
      Command.resolve(ScrollToTop, Message.CompletedScrollToTop()),
      Command.resolve(FocusPageTitle, Message.CompletedFocusPageTitle()),
    )
  })

  test('an address naming a section scrolls there instead of to the top', () => {
    story(
      update,
      given(signedIn('/ask')),
      message(Message.ChangedUrl({ url: urlOf('/account#assistants') })),
      // The account reads its profile, to say where it stands.
      Command.expectExact(LoadProfile, ScrollToAnchor),
      Command.resolve(LoadProfile, AccountMessage.FailedLoadProfile()),
      Command.resolve(ScrollToAnchor, Message.CompletedScrollToAnchor()),
      model(({ route }) => expect(route).toEqual(AppRoute.Account())),
    )
  })

  test('a page that is not a tab loads whole', () => {
    story(
      update,
      given(signedIn('/ask')),
      message(Message.ChangedUrl({ url: urlOf('/wardrobe/add') })),
      Command.expectExact(Navigate),
      Command.resolve(Navigate, Message.CompletedNavigate()),
      model(({ route }) => expect(route).toEqual(AppRoute.Ask({ q: Option.none() }))),
    )
    expect(NavigateInternal.name).toBe('NavigateInternal')
  })
})
