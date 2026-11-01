import type { Piece } from '@styld/protocol'
import { Dialog } from '@foldkit/ui'
import { click, Command, expect, given, Mount, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import * as Ask from '../src/page/Ask.ts'
import { CreateBoard, Message as BoardsMessage } from '../src/page/Boards.ts'
import { view } from '../src/View.ts'
import { sceneSheetMoved } from './SheetFixtures.ts'
import { at, withPage, withPieces } from './AppFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const askWith = (pieces: ReadonlyArray<Piece>, query = '') =>
  withPage(withPieces(at('/ask', { signedIn: true }), pieces), lenses.ask, (current) =>
    modifyFields(current, { query: () => query }),
  )

const tee = pieceFixture('tee', { name: 'White tee', type: 'tops', colours: ['white'] })
const boots = pieceFixture('boots', { type: 'trainers', status: 'processing' })

describe('Ask', () => {
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
    const open = withPage(askWith([tee]), lenses.ask, (current) => Ask.update(current, Ask.Message.ClickedAdd()).model)
    scene(
      { update, view },
      given(open),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      ...sceneSheetMoved(1),
      expect(role('link', { name: /^Add clothes/ })).toHaveAttr('href', '/wardrobe/add'),
      expect(role('link', { name: /^Add from a link/ })).toHaveAttr('href', '/wardrobe/add#link'),
      // Start a board makes one under the default name, as Boards' + does; the sheet stays and says if it was refused.
      click(role('button', { name: /^Start a board/ })),
      Command.resolve(CreateBoard({ name: 'My board' }), BoardsMessage.FailedCreateBoard()),
      expect(role('alert')).toHaveText('The board wasn’t created. Try again.'),
    )
  })

  test('suggestions come from the pieces that are ready: their kinds, then their colours', () => {
    scene(
      { update, view },
      given(askWith([tee, boots])),
      expect(role('button', { name: 'Tops & T-shirts' })).toExist(),
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
      expect(role('button', { name: 'Tops & T-shirts' })).toExist(),
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
