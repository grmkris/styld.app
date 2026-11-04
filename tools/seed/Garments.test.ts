import { describe, expect, test } from 'vitest'
import { scriptedWork, specOf, verdictFor } from './Fakes.ts'
import { garmentFor } from './Garments.ts'
import { failureOf, passes } from './Gate.ts'
import { notDrawnFor } from './Generate.ts'
import { makeLedger } from './Ledger.ts'

// A house garment is kept only when the judge saw one whole garment of the spec's type and first colour with nothing
// else; a fail is drawn again with what was wrong, at most twice, and a spec that still fails gets no picture at all.

const spec = specOf()

describe('the gate', () => {
  test('passes one whole garment of the spec’s type and first colour', () => {
    expect(passes(verdictFor(spec), spec)).toBe(true)
    expect(failureOf(verdictFor(spec), spec)).toBeUndefined()
  })

  test.each([
    ['a person', { person: true }, 'part of a person'],
    ['text', { text: true }, 'text or a logo'],
    ['a hanger', { hanger: true }, 'No hanger.'],
    ['two garments', { garments: 2 }, 'exactly one garment'],
    ['the wrong type', { type: 'hoodies' as const }, 'did not read as a Breton striped jumper'],
    ['none of its colours', { colours: ['red' as const] }, 'colour was wrong'],
    ['a crop', { cropped: true }, 'cut part of the garment off'],
  ])('fails %s, and says so to the next attempt', (_, faults, said) => {
    const verdict = verdictFor(spec, faults)
    expect(passes(verdict, spec)).toBe(false)
    expect(failureOf(verdict, spec)).toContain(said)
  })

  test('takes any shape for a type that names a use: sportswear joggers read as trousers', () => {
    const joggers = specOf({ type: 'sportswear', colours: ['grey'] })
    expect(passes(verdictFor(joggers, { type: 'trousers' }), joggers)).toBe(true)
  })

  test('needs the spec’s first colour, not only any of them', () => {
    expect(passes(verdictFor(spec, { colours: ['navy'] }), spec)).toBe(false)
  })
})

describe('a garment', () => {
  test('that passes first time is drawn and judged once', async () => {
    const { work, prompts } = scriptedWork()
    const record = await garmentFor(spec, work)
    expect(record.status).toBe('passed')
    expect(prompts).toHaveLength(1)
  })

  test('that fails is drawn again told what was wrong, at most twice, then failed with no picture kept', async () => {
    const hanger = verdictFor(spec, { hanger: true })
    const { work, prompts, looks } = scriptedWork(new Map([[spec.id, [hanger, hanger, hanger, verdictFor(spec)]]]))
    const record = await garmentFor(spec, work)
    expect(record.status).toBe('failed')
    expect(prompts).toHaveLength(3)
    expect(looks(spec.id)).toBe(3)
    expect(prompts[1]).toContain('The last attempt showed a hanger. No hanger.')
    expect(record.attempts.every(({ passed }) => !passed)).toBe(true)
  })

  test('that passed before with the same prompt costs nothing again', async () => {
    const { work, prompts, ledger } = scriptedWork()
    await garmentFor(spec, work)
    const spent = ledger.total()
    const again = await garmentFor(spec, work)
    expect(again.status).toBe('passed')
    expect(prompts).toHaveLength(1)
    expect(ledger.total()).toBe(spent)
  })

  test('is drawn afresh when asked to regenerate', async () => {
    const { work, prompts } = scriptedWork()
    await garmentFor(spec, work)
    await garmentFor(spec, work, true)
    expect(prompts).toHaveLength(2)
  })

  test('Muse refusing every time leaves the spec failed and costs no pictures', async () => {
    const { work } = scriptedWork()
    const ledger = makeLedger([], 5_000_000, async () => {})
    const refusing = {
      ...work,
      ledger,
      painter: { paint: () => Promise.reject(notDrawnFor('refused', false)) },
    }
    const record = await garmentFor(spec, refusing)
    expect(record.status).toBe('failed')
    expect(record.attempts.map(({ error }) => error)).toEqual(Array(3).fill('Muse did not draw it (refused)'))
    expect(ledger.byKind('muse')).toBe(0)
  })

  test('a picture kept before its judge answered is judged on the next run, not drawn again', async () => {
    const { work, prompts, memory } = scriptedWork()
    const failingJudge = { ...work, judge: { ...work.judge, judge: () => Promise.reject(new Error('Spark down')) } }
    await expect(garmentFor(spec, failingJudge)).rejects.toThrow('Spark down')
    expect(memory.records.get(spec.id)?.attempts).toHaveLength(1)
    const record = await garmentFor(spec, work)
    expect(record.status).toBe('passed')
    expect(prompts).toHaveLength(1)
  })
})
