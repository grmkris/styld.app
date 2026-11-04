import type { Audience } from '@styld/protocol'
import { click, Command, expect, given, role, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import * as Account from '../src/page/Account.ts'
import * as ShowMe from '../src/page/ShowMe.ts'
import * as WhatsNew from '../src/page/WhatsNew.ts'
import { view } from '../src/View.ts'
import { at, withPage } from './AppFixtures.ts'
import { settled } from './HomeFixtures.ts'

// Show me on Home and on the Account page (owner, 4 November 2026): the card asks once above What's new, in the
// reader's language; the Account page changes the choice any time.

const preferences = (showMe: Audience | null, showMeAsked: boolean): ShowMe.Model =>
  modifyFields(ShowMe.init(), {
    preferences: () => ShowMe.PreferencesData.Success({ data: { showMe, showMeAsked } }),
  })

const home = (showMe: ShowMe.Model, locale: 'en' | 'sl' = 'en', answeredHere = false) =>
  withPage(
    modifyFields(at('/', { signedIn: true, locale }), {
      context: (context) => ({ ...context, showMeAnswered: answeredHere }),
    }),
    lenses.today,
    (today) => modifyFields(settled(today), { showMe: () => showMe }),
  )

describe('Show me on Home', () => {
  test('asks above What’s new, and once answered goes away while What’s new reads again in its order', () => {
    scene(
      { update, view },
      given(home(preferences(null, false))),
      expect(role('heading', { name: 'What should we show you first?' })).toExist(),
      expect(role('button', { name: 'Everything' })).toHaveAttr('aria-pressed', 'true'),
      click(role('button', { name: "Men's" })),
      Command.resolve(
        ShowMe.SaveShowMe({ showMe: 'men' }),
        ShowMe.Message.SucceededSaveShowMe({ preferences: { showMe: 'men', showMeAsked: true } }),
      ),
      Command.resolve(WhatsNew.ReadFeed, WhatsNew.Message.FailedReadFeed()),
      Command.resolve(ShowMe.RememberAnswered, ShowMe.Message.CompletedRememberAnswered()),
      expect(role('heading', { name: 'What should we show you first?' })).not.toExist(),
    )
  })

  test('speaks Slovenian to a Slovenian reader, and “Ne zdaj” puts it away', () => {
    scene(
      { update, view },
      given(home(preferences(null, false), 'sl')),
      expect(role('heading', { name: 'Kaj naj ti pokažemo najprej?' })).toExist(),
      expect(role('button', { name: 'Moška oblačila' })).toExist(),
      click(role('button', { name: 'Ne zdaj' })),
      expect(role('heading', { name: 'Kaj naj ti pokažemo najprej?' })).not.toExist(),
      Command.resolve(
        ShowMe.SaveShowMe({ showMe: null }),
        ShowMe.Message.SucceededSaveShowMe({ preferences: { showMe: null, showMeAsked: true } }),
      ),
      Command.resolve(ShowMe.RememberAnswered, ShowMe.Message.CompletedRememberAnswered()),
    )
  })

  test('is there from the first paint while the choice is read, so it never moves Home as it arrives', () => {
    scene(
      { update, view },
      given(home(ShowMe.init())),
      expect(role('heading', { name: 'What should we show you first?' })).toExist(),
    )
  })

  test('is not there once answered, nor in a browser that saw an answer (its cookie)', () => {
    for (const [showMe, answeredHere] of [
      [preferences('women', true), false],
      [ShowMe.init(), true],
    ] as const)
      scene(
        { update, view },
        given(home(showMe, 'en', answeredHere)),
        expect(role('heading', { name: 'What should we show you first?' })).not.toExist(),
      )
  })
})

describe('Show me on the Account page', () => {
  test('shows the saved choice pressed and changes it', () => {
    scene(
      { update, view },
      given(
        withPage(at('/account', { signedIn: true }), lenses.account, () =>
          modifyFields(Account.init(), { showMe: () => preferences('women', true) }),
        ),
      ),
      expect(role('button', { name: "Women's" })).toHaveAttr('aria-pressed', 'true'),
      click(role('button', { name: 'Everything' })),
      Command.resolve(
        ShowMe.SaveShowMe({ showMe: 'all' }),
        ShowMe.Message.SucceededSaveShowMe({ preferences: { showMe: 'all', showMeAsked: true } }),
      ),
      Command.resolve(ShowMe.RememberAnswered, ShowMe.Message.CompletedRememberAnswered()),
      expect(role('button', { name: 'Everything' })).toHaveAttr('aria-pressed', 'true'),
      expect(role('button', { name: "Women's" })).toHaveAttr('aria-pressed', 'false'),
    )
  })
})
