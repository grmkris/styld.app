import { describe, expect, test } from 'vitest'
import { CapReached, makeLedger, prices } from './Ledger.ts'

// The seed's spend is capped (owner, 4 November 2026): a call is refused before it starts when its worst case would
// pass the cap, and a call with no answer counts as spent.

const muse = { kind: 'muse' as const, ref: 'w-coats-navy', worst: prices.musePerImage }

describe('the ledger', () => {
  test('a $0.05 cap stops the run before the sixth $0.01 picture', async () => {
    const ledger = makeLedger([], 50_000, async () => {})
    let drawn = 0
    const draw = () =>
      ledger.paid(
        muse,
        async () => {
          drawn += 1
        },
        () => prices.musePerImage,
        () => prices.musePerImage,
      )
    for (let call = 0; call < 5; call += 1) await draw()
    await expect(draw()).rejects.toBeInstanceOf(CapReached)
    expect(drawn).toBe(5)
    expect(ledger.total()).toBe(50_000)
  })

  test('a call that got no answer stays charged at its worst case; a refusal Meta did not bill costs nothing', async () => {
    const ledger = makeLedger([], 1_000_000, async () => {})
    const lost = ledger.paid(
      muse,
      () => Promise.reject(new Error('lost')),
      () => 0,
      () => prices.musePerImage,
    )
    await expect(lost).rejects.toThrow('lost')
    const declined = ledger.paid(
      muse,
      () => Promise.reject(new Error('refused')),
      () => 0,
      () => 0,
    )
    await expect(declined).rejects.toThrow('refused')
    expect(ledger.total()).toBe(prices.musePerImage)
  })

  test('saves each call before it runs, and what it cost after; earlier runs count against the cap', async () => {
    const saved: Array<ReadonlyArray<unknown>> = []
    const earlier = [{ at: '2026-11-04T00:00:00.000Z', kind: 'judge' as const, ref: 'x', reserved: 9000, spent: 2400 }]
    const ledger = makeLedger(earlier, 20_000, async (entries) => {
      saved.push(entries.map((entry) => ({ ...entry })))
    })
    await ledger.paid(
      { ...muse, worst: 10_000 },
      async () => 'drawn',
      () => 10_000,
      () => 10_000,
    )
    expect(saved).toHaveLength(2)
    expect(ledger.byKind('judge')).toBe(2400)
    await expect(
      ledger.paid(
        muse,
        async () => 'drawn',
        () => 0,
        () => 0,
      ),
    ).rejects.toBeInstanceOf(CapReached)
  })
})
