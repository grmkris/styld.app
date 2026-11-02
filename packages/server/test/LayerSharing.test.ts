import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'

// The composition root relies on this (`kernel/Module.ts`): a module provides the layers of the modules it uses itself,
// by reference, and the root merges every module's layer; each layer is still built once per build.

class Used extends Context.Service<Used, { readonly id: number }>()('test/Used') {}
class User extends Context.Service<User, { readonly used: number }>()('test/User') {}

describe('a layer provided by reference', () => {
  it.effect('is built once, however many layers provide it', () =>
    Effect.gen(function* () {
      let builds = 0
      const used = Layer.effect(
        Used,
        Effect.sync(() => {
          builds += 1
          return { id: builds }
        }),
      )
      const user = Layer.effect(
        User,
        Effect.map(Used, ({ id }) => ({ used: id })),
      ).pipe(Layer.provide(used))
      const other = Layer.effect(
        User,
        Effect.map(Used, ({ id }) => ({ used: id })),
      ).pipe(Layer.provide([used]))
      const both = yield* Effect.all([Used, User]).pipe(Effect.provide(Layer.mergeAll(used, user, other)))
      expect(builds).toBe(1)
      expect(both[0].id).toBe(both[1].used)
    }),
  )
})
