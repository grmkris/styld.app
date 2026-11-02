import { expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { cachedClient, ClientNotLoaded } from '../src/StyldClient.ts'

it.effect('shares client loading, retries a failed import, and retains the successful client', () =>
  Effect.gen(function* () {
    let calls = 0
    const client = { ready: true }
    const load = yield* cachedClient(
      Effect.gen(function* () {
        calls += 1
        yield* Effect.yieldNow
        if (calls === 1) return yield* ClientNotLoaded.make({})
        return client
      }),
    )
    expect(yield* Effect.flip(load)).toEqual(ClientNotLoaded.make({}))
    expect(yield* Effect.all([load, load], { concurrency: 'unbounded' })).toEqual([client, client])
    expect(yield* load).toBe(client)
    expect(calls).toBe(2)
  }),
)
