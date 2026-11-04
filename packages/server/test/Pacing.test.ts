import { describe, expect, it } from '@effect/vitest'
import { CurrentAccount, SlowDown } from '@styld/protocol'
import { Effect, Record } from 'effect'
import * as Headers from 'effect/http/Headers'
import { type Limiter, networkOf, Pacing } from '../src/kernel/Pacing.ts'
import { paces } from '../src/kernel/Paces.ts'

/** Limiters that allow each key `allowed` times, counting what they were asked, and one that has failed. */
const limiters = (allowed: number) => {
  const asked: Array<string> = []
  const counting: Limiter = {
    limit: ({ key }) => {
      asked.push(key)
      return Promise.resolve({ success: asked.filter((one) => one === key).length <= allowed })
    },
  }
  const broken: Limiter = { limit: () => Promise.reject(new Error('the binding is down')) }
  return { asked, layer: Pacing.layer({ ...Record.map(paces, () => counting), thinking: broken }) }
}

const asAna = Effect.provideService(CurrentAccount, { accountId: 'ac_ana', via: 'session' })

describe('pacing', () => {
  it.effect('lets an account go on within its pace and asks it to slow down past it', () => {
    const { asked, layer } = limiters(2)
    return Effect.gen(function* () {
      const pacing = yield* Pacing
      yield* pacing.account('link')
      yield* pacing.account('link')
      const third = yield* pacing.account('link').pipe(Effect.flip)
      expect(third).toBeInstanceOf(SlowDown)
      expect(asked).toEqual(['ac_ana', 'ac_ana', 'ac_ana'])
    }).pipe(asAna, Effect.provide(layer))
  })

  it.effect('refuses when a limiter fails: a limit is never an open door', () => {
    const { layer } = limiters(100)
    return Effect.gen(function* () {
      const pacing = yield* Pacing
      expect(yield* pacing.allows('thinking', 'ac_ana')).toBe(false)
      expect(yield* pacing.account('thinking').pipe(Effect.flip)).toBeInstanceOf(SlowDown)
    }).pipe(asAna, Effect.provide(layer))
  })

  it('keys a network by the address Cloudflare sets, one shared key without it', () => {
    expect(networkOf(Headers.fromInput({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(networkOf(Headers.empty)).toBe('unknown')
  })
})
