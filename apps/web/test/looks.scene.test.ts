import { expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage } from './AppFixtures.ts'
import { SavedData } from '../src/page/Looks.ts'
import { view } from '../src/View.ts'

const looksWith = (saved: SavedData) => withPage(at('/looks', { signedIn: true }), lenses.looks, () => ({ saved }))

describe('the looks tab', () => {
  test('with no looks yet, says where one is made and leads there', () => {
    scene(
      { update, view },
      given(looksWith(SavedData.Success({ data: [] }))),
      expect(role('heading', { name: 'No looks yet' })).toExist(),
      expect(text("Lay pieces out on a board's table and save it as a look, or ask Styld for one.")).toExist(),
      expect(role('link', { name: 'Go to Boards' })).toHaveAttr('href', '/boards'),
    )
  })
})
