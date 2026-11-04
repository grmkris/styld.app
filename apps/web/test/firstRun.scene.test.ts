import { click, Command, expect, given, inside, Mount, role, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import * as FirstRun from '../src/page/FirstRun.ts'
import * as WhatsNew from '../src/page/WhatsNew.ts'
import { view } from '../src/View.ts'
import { at, withPage } from './AppFixtures.ts'
import { settled } from './HomeFixtures.ts'

// The first run over Home (owner, 4 November 2026), in the reader's language: a modal screen counting its four steps.

const home = (step: FirstRun.Step, locale: 'en' | 'sl' = 'en') =>
  withPage(at('/', { signedIn: true, locale }), lenses.today, (today) =>
    modifyFields(settled(today), {
      firstRun: () => ({ ...FirstRun.init(), stage: FirstRun.Stage.Open({ step }) }),
    }),
  )

describe('the first run on Home', () => {
  test('asks Show me first, then the boards to pick', () => {
    scene(
      { update, view },
      given(home(FirstRun.Step.ShowMe())),
      Mount.resolve(FirstRun.HoldFirstRun, FirstRun.Message.CompletedHold()),
      inside(
        role('dialog', { name: 'What should we show you first?' }),
        expect(role('button', { name: "Men's" })).toExist(),
      ),
      inside(role('dialog'), click(role('button', { name: 'Skip' }))),
      Command.resolve(FirstRun.SaveFirstRunShowMe, FirstRun.Message.CompletedSave()),
      Command.resolve(FirstRun.ReadHouseBoards, FirstRun.Message.FailedReadBoards()),
      // Show me answered: Home reads it again, and What's new in its order.
      Command.resolve(WhatsNew.ReadFeed, WhatsNew.Message.FailedReadFeed()),
      inside(role('dialog', { name: 'Pick 3 boards you like' }), expect(role('button', { name: 'Next' })).toExist()),
    )
  })

  test('the last step closes onto Home, whose first-piece card leads to Add clothes, in Slovenian', () => {
    scene(
      { update, view },
      given(home(FirstRun.Step.Clothes(), 'sl')),
      Mount.resolve(FirstRun.HoldFirstRun, FirstRun.Message.CompletedHold()),
      inside(role('dialog', { name: 'Zdaj še tvoja oblačila' }), expect(role('link')).not.toExist()),
      inside(role('dialog'), click(role('button', { name: 'Končano' }))),
      Command.resolve(WhatsNew.ReadFeed, WhatsNew.Message.FailedReadFeed()),
      expect(role('dialog')).not.toExist(),
      Mount.expectEnded(FirstRun.HoldFirstRun),
    )
  })
})
