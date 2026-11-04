import { Challenges } from '@styld/protocol'
import { Schema } from 'effect'
import { expect, given, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import * as ChallengesPage from '../src/page/Challenges.ts'
import { view } from '../src/View.ts'
import { at, withPage } from './AppFixtures.ts'
import { settled } from './HomeFixtures.ts'
import { boardItem } from './WhatsNewFixtures.ts'

// Challenges on Home (Eva's sketch, owner 4 November 2026): each of her three opens its house board once seeded; with
// none, the row says "Coming soon" and nothing in it is a link.

const red = boardItem('red', 'styld.women')

const home = (challenges: ChallengesPage.Model) =>
  withPage(at('/', { signedIn: true }), lenses.today, (today) =>
    modifyFields(settled(today), { whatsNew: (whatsNew) => ({ ...whatsNew, challenges }) }),
  )

const withRed = modifyFields(ChallengesPage.init(), {
  challenges: () =>
    ChallengesPage.ChallengesData.Success({
      data: Schema.decodeUnknownSync(Challenges)({
        challenges: [{ challenge: 'red', found: { board: red.board, by: red.by, moods: [] } }],
      }),
    }),
})

describe('Challenges on Home', () => {
  test('a challenge with its board opens it; the others stay quiet cards, and nothing says coming soon', () => {
    scene(
      { update, view },
      given(home(withRed)),
      expect(role('link', { name: '30 days of red' })).toHaveAttr('href', `/boards/${red.board.id}`),
      expect(role('link', { name: 'Witch October' })).not.toExist(),
      expect(text('Witch October')).toExist(),
      expect(text('Coming soon')).not.toExist(),
    )
  })

  test('with no boards yet, the row is coming soon and nothing in it is a link', () => {
    scene(
      { update, view },
      given(home(ChallengesPage.init())),
      expect(text('Coming soon')).toExist(),
      expect(role('link', { name: '30 days of red' })).not.toExist(),
    )
  })
})
