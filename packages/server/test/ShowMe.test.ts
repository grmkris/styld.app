import { describe, expect, it } from '@effect/vitest'
import { CurrentAccount, OperationId } from '@styld/protocol'
import { Effect, Layer } from 'effect'
import { Database } from '../src/kernel/Db.ts'
import { ShowMe, showMeRank } from '../src/social/ShowMe.ts'
import { localD1 } from './LocalD1.ts'

// Show me (owner, 4 November 2026): what a person asked to see first, asked once on Home after they sign in. It ranks,
// never hides: their choice first, the boards for everyone and anything else next, the others last.

describe('Show me’s rank', () => {
  it('puts the choice first, everyone’s and the untagged next, the other last; no choice or Everything ranks all alike', () => {
    const audiences = ['women', 'men', 'all', null] as const
    expect(audiences.map((audience) => showMeRank('women', audience))).toEqual([0, 2, 1, 1])
    expect(audiences.map((audience) => showMeRank('men', audience))).toEqual([2, 0, 1, 1])
    expect(audiences.map((audience) => showMeRank('all', audience))).toEqual([0, 0, 0, 0])
    expect(audiences.map((audience) => showMeRank(null, audience))).toEqual([0, 0, 0, 0])
  })
})

const asAna = () => {
  const database = localD1()
  database.sqlite.exec(
    "INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_ana', 0, 'Ana', 0)",
  )
  return ShowMe.layer.pipe(
    Layer.provideMerge(Database.layer(database)),
    Layer.provideMerge(Layer.succeed(CurrentAccount, CurrentAccount.of({ accountId: 'ac_ana', via: 'session' }))),
  )
}

describe('a person’s Show me', () => {
  it.effect('is nothing chosen and not asked yet, until they answer; then their answer, asked', () =>
    Effect.gen(function* () {
      const showMe = yield* ShowMe
      expect(yield* showMe.getPreferences()).toEqual({ showMe: null, showMeAsked: false })
      expect(yield* showMe.setShowMe({ operationId: OperationId.make('show-me-men-1'), showMe: 'men' })).toEqual({
        showMe: 'men',
        showMeAsked: true,
      })
      expect(yield* showMe.getPreferences()).toEqual({ showMe: 'men', showMeAsked: true })
    }).pipe(Effect.provide(asAna())),
  )

  it.effect('“Not now” puts the card away with nothing chosen, and a late repeat of an answer changes nothing', () =>
    Effect.gen(function* () {
      const showMe = yield* ShowMe
      yield* showMe.setShowMe({ operationId: OperationId.make('show-me-women-1'), showMe: 'women' })
      expect(yield* showMe.setShowMe({ operationId: OperationId.make('show-me-later-1'), showMe: null })).toEqual({
        showMe: null,
        showMeAsked: true,
      })
      // The first answer delivered again: it answers as things are now and writes nothing.
      expect(yield* showMe.setShowMe({ operationId: OperationId.make('show-me-women-1'), showMe: 'women' })).toEqual({
        showMe: null,
        showMeAsked: true,
      })
      const conflict = yield* Effect.flip(
        showMe.setShowMe({ operationId: OperationId.make('show-me-women-1'), showMe: 'men' }),
      )
      expect(conflict).toMatchObject({ _tag: 'OperationConflict' })
    }).pipe(Effect.provide(asAna())),
  )
})
