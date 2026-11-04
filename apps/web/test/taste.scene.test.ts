import { StyleNoteId, type Taste } from '@styld/protocol'
import { click, Command, expect, given, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import * as Account from '../src/page/Account.ts'
import * as TastePage from '../src/page/Taste.ts'
import { view } from '../src/View.ts'
import { at, withPage } from './AppFixtures.ts'

// What Styld knows about you on the Account page (owner, 4 November 2026), in the reader's language: the occasions
// they dress for, the notes Styld remembers with Remove, and what it learned.

const heels = StyleNoteId.make(`sn_${'heels'.padEnd(22, 'x')}`)

const taste: Taste = {
  showMe: 'men',
  occasions: ['smart'],
  firstRunDone: true,
  notes: [{ id: heels, text: 'Never heels', createdAt: '2026-11-04T10:00:00.000Z' }],
  learned: { aesthetics: ['city-break'], colours: ['navy', 'blue'], wornTypes: ['jeans'] },
}

const account = (shown: Taste, locale: 'en' | 'sl' = 'en') =>
  withPage(at('/account', { signedIn: true, locale }), lenses.account, () =>
    modifyFields(Account.init(), {
      taste: () => modifyFields(TastePage.init(), { taste: () => TastePage.TasteData.Success({ data: shown }) }),
    }),
  )

describe('what Styld knows about you, on the Account page', () => {
  test('shows the occasions, the notes and what was learned; Remove forgets a note', () => {
    scene(
      { update, view },
      given(account(taste)),
      expect(role('heading', { name: 'What Styld knows about you' })).toExist(),
      expect(role('button', { name: 'Smart' })).toHaveAttr('aria-pressed', 'true'),
      expect(role('button', { name: 'Casual' })).toHaveAttr('aria-pressed', 'false'),
      expect(text('Never heels')).toExist(),
      expect(text('Colours you wear most: Navy and Blue')).toExist(),
      expect(text('Boards you saved: city break')).toExist(),
      click(role('button', { name: 'Remove' })),
      Command.resolve(TastePage.RemoveNote, TastePage.Message.SucceededRemoveNote({ noteId: heels })),
      expect(text('Never heels')).not.toExist(),
      expect(text('Nothing yet. When you tell Styld something in a chat, it asks before it remembers it.')).toExist(),
    )
  })

  test('in Slovenian, with nothing learned yet', () => {
    scene(
      { update, view },
      given(account({ ...taste, notes: [], learned: { aesthetics: [], colours: [], wornTypes: [] } }, 'sl')),
      expect(role('heading', { name: 'Kaj Styld ve o tebi' })).toExist(),
      expect(text('Še nič. Raste, ko nosiš kose in shranjuješ table.')).toExist(),
    )
  })
})
