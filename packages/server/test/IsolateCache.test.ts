import { Context, Deferred, Effect, Fiber, Option, Ref } from 'effect'
import { expect, test } from 'vitest'
import { onFirstUse } from '../src/IsolateCache.ts'

class RequestOnly extends Context.Service<RequestOnly, { readonly id: string }>()('test/RequestOnly') {}

test('builds once for every later and concurrent request', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const builds = yield* Ref.make(0)
      const finalized = yield* Ref.make(false)
      const application = yield* onFirstUse((value: string) =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() => Ref.set(finalized, true))
          return `${value}:${yield* Ref.updateAndGet(builds, (count) => count + 1)}`
        }),
      )
      // Each request runs in its own scope, as the Alchemy Worker bridge does.
      const first = yield* Effect.scoped(application('first'))
      const concurrent = yield* Effect.all(
        [Effect.scoped(application('second')), Effect.scoped(application('third'))],
        {
          concurrency: 'unbounded',
        },
      )
      return { first, concurrent, builds: yield* Ref.get(builds), finalized: yield* Ref.get(finalized) }
    }),
  )
  expect(result).toEqual({ first: 'first:1', concurrent: ['first:1', 'first:1'], builds: 1, finalized: false })
})

test('builds without the first request’s own services', async () => {
  const seen = await Effect.runPromise(
    Effect.gen(function* () {
      const application = yield* onFirstUse(() =>
        Effect.map(
          Effect.serviceOption(RequestOnly),
          Option.map(({ id }) => id),
        ),
      )
      return yield* application(undefined).pipe(Effect.provideService(RequestOnly, { id: 'request-1' }))
    }),
  )
  expect(seen).toEqual(Option.none())
})

test('retries a build abandoned by an interrupted first request', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const builds = yield* Ref.make(0)
      const application = yield* onFirstUse(() =>
        Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(builds, (value) => value + 1)
          if (count === 1) {
            yield* Deferred.succeed(started, undefined)
            yield* Deferred.await(release)
          }
          return count
        }),
      )
      const abandoned = yield* Effect.forkChild(application(undefined))
      yield* Deferred.await(started)
      yield* Fiber.interrupt(abandoned)
      return { next: yield* application(undefined), builds: yield* Ref.get(builds) }
    }),
  )
  expect(result).toEqual({ next: 2, builds: 2 })
})
