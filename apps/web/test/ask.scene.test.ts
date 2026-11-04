import type { Piece } from '@styld/protocol'
import { Animation, Dialog } from '@foldkit/ui'
import { click, Command, expect, given, Mount, role, scene, Subscription, text, type } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { Option, String } from 'effect'
import { describe, test } from 'vitest'
import { Message as AppMessage, update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import * as Ask from '../src/page/Ask.ts'
import { FocusPageTitle, NavigateInternal, ScrollToTop } from '../src/Navigation.ts'
import * as Boards from '../src/page/Boards.ts'
import { ListBoards, ListPieces, Message as DataMessage } from '../src/ServerData.ts'
import { askRouter } from '../src/route.ts'
import { view } from '../src/View.ts'
import { sceneSheetMoved, sceneSheetOpened } from './SheetFixtures.ts'
import { at, urlOf, withPage, withPieces } from './AppFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

/** Ask open at `/ask?q=…`, the search held only by its address. */
const askWith = (pieces: ReadonlyArray<Piece>, query = '') =>
  withPieces(at(askRouter({ q: Option.liftPredicate(query, String.isNonEmpty) }), { signedIn: true }), pieces)

const tee = pieceFixture('tee', { name: 'White tee', type: 'shortSleeveTops', colours: ['white'] })
const boots = pieceFixture('boots', { type: 'trainers', status: 'processing' })

describe('Ask', () => {
  test('a key replaces the address as typed, a trailing space included, and the pause searches the words', () => {
    scene(
      { update, view },
      given(askWith([tee])),
      type(role('searchbox'), 'red '),
      Command.expectExact(Ask.ReplaceQuery({ q: 'red ' }), Ask.WaitBeforeSearching({ query: 'red', revision: 1 })),
      Command.resolve(Ask.ReplaceQuery, Ask.Message.CompletedReplaceQuery()),
      Command.resolve(Ask.WaitBeforeSearching, Ask.Message.ElapsedSearchPause({ query: 'red', revision: 1 })),
      Command.resolve(
        Ask.SearchPublic({ query: 'red', revision: 1 }),
        Ask.Message.SucceededSearchPublic({ query: 'red', revision: 1, results: { people: [], boards: [] } }),
      ),
      // The replace's own address change only shows what was typed; it searches nothing again.
      Subscription.emit(AppMessage.ChangedUrl({ url: urlOf(askRouter({ q: Option.some('red ') })) })),
      Command.expectNone(),
      expect(role('searchbox')).toHaveValue('red '),
    )
  })

  test('an empty wardrobe says what belongs here and the one way to fill it, with no empty suggestions', () => {
    scene(
      { update, view },
      given(askWith([boots])),
      expect(role('heading', { name: 'Nothing to search yet' })).toExist(),
      expect(role('link', { name: 'Add clothes' })).toHaveAttr('href', '/wardrobe/add'),
      expect(role('group', { name: 'Suggestions' })).not.toExist(),
    )
  })

  test('the + sheet offers adding clothes, adding from a shop’s page, or starting a board', () => {
    const open = withPage(
      askWith([tee]),
      lenses.ask,
      (current) => Ask.update(current, Ask.Message.ClickedAdd(), { query: '' }).model,
    )
    scene(
      { update, view },
      given(open),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      ...sceneSheetMoved(1),
      expect(role('link', { name: /^Add clothes/ })).toHaveAttr('href', '/wardrobe/add'),
      expect(role('link', { name: /^Add from a link/ })).toHaveAttr('href', '/wardrobe/add#link'),
      // Start a board opens Boards with its new-board sheet, where Blank or a template is chosen (F-26). Both are tabs,
      // so the move stays in the page and Boards still knows the sheet was asked for.
      click(role('button', { name: /^Start a board/ })),
      Command.resolve(NavigateInternal({ href: '/boards' }), AppMessage.CompletedNavigateInternal()),
      Command.resolve(
        Animation.WaitForPaint({ generation: 2 }),
        Animation.Message.CompletedWaitForPaint({ generation: 2 }),
      ),
      Command.resolve(Animation.WaitForAnimationSettled, Animation.Message.EndedAnimation({ generation: 2 })),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
      Mount.expectEnded(Dialog.AcquireResources),
      Subscription.emit(AppMessage.ChangedUrl({ url: urlOf('/boards') })),
      Command.resolve(ListBoards, DataMessage.FailedListBoards()),
      Command.resolve(ListPieces, DataMessage.FailedListPieces()),
      Command.resolve(Boards.ListSaved, Boards.Message.FailedListSaved()),
      Command.resolve(ScrollToTop, AppMessage.CompletedScrollToTop()),
      Command.resolve(FocusPageTitle, AppMessage.CompletedFocusPageTitle()),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      ...sceneSheetOpened,
      expect(role('dialog', { name: 'New board' })).toExist(),
    )
  })

  test('suggestions come from the pieces that are ready: their kinds, then their colours', () => {
    scene(
      { update, view },
      given(askWith([tee, boots])),
      expect(role('button', { name: 'T-shirts & short-sleeve tops' })).toExist(),
      expect(role('button', { name: 'White' })).toExist(),
      expect(role('button', { name: 'Trainers' })).not.toExist(),
    )
  })

  test('what was found sits under one head; nothing found says so once and offers a way on', () => {
    scene(
      { update, view },
      given(askWith([tee], 'tee')),
      expect(role('heading', { name: 'In your wardrobe' })).toExist(),
      expect(text('1 piece')).toExist(),
      expect(role('link', { name: 'White tee' })).toHaveAttr('href', `/wardrobe/${tee.id}`),
    )
    scene(
      { update, view },
      given(askWith([tee], 'zzz')),
      expect(text('Nothing in your wardrobe matches “zzz”.')).toExist(),
      expect(text('0 pieces')).not.toExist(),
      expect(role('button', { name: 'T-shirts & short-sleeve tops' })).toExist(),
    )
  })

  test('when the other language did not load, the results say only this one was searched, and Try again loads it', () => {
    const pageOnly = withPage(askWith([tee], 'tee'), lenses.ask, (current) =>
      modifyFields(current, { languages: () => Ask.SearchLanguages.OtherUnavailable() }),
    )
    scene(
      { update, view },
      given(pageOnly),
      expect(text('Only words in this language were searched.')).toExist(),
      click(role('button', { name: 'Try again' })),
      Command.resolve(Ask.LoadSearchLanguages, Ask.Message.FailedLoadSearchLanguages()),
      expect(text('Only words in this language were searched.')).toExist(),
      click(role('button', { name: 'Try again' })),
      Command.resolve(Ask.LoadSearchLanguages, Ask.Message.SucceededLoadSearchLanguages()),
      expect(text('Only words in this language were searched.')).not.toExist(),
    )
  })

  test('Styld answers in the app, and ChatGPT or Claude once connected from the account', () => {
    scene(
      { update, view },
      given(askWith([tee])),
      expect(role('heading', { name: 'Styld, your stylist' })).toExist(),
      expect(role('link', { name: 'Start a chat' })).toHaveAttr('href', '/ask/stylist'),
      expect(role('link', { name: 'Or connect ChatGPT or Claude' })).toHaveAttr('href', '/account#assistants'),
      expect(role('button', { name: 'Add clothes or a board' })).toHaveAttr('aria-haspopup', 'dialog'),
    )
  })

  test('what is typed can be asked of Styld instead of searched', () => {
    scene(
      { update, view },
      given(askWith([tee], 'what goes with white')),
      expect(role('link', { name: 'Ask Styld about “what goes with white”' })).toHaveAttr(
        'href',
        '/ask/stylist?q=what+goes+with+white',
      ),
      // While searching, Styld is the one row under the results, not the card as well.
      expect(role('link', { name: 'Start a chat' })).not.toExist(),
    )
  })
})
