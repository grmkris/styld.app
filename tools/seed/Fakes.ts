import type { GarmentRecord, GarmentStore, GarmentWork } from './Garments.ts'
import type { Judge, Verdict } from './Gate.ts'
import type { Painter } from './Generate.ts'
import { makeLedger } from './Ledger.ts'
import type { Spec } from './Manifest.ts'

// The seed's tests run no network: a painter and a judge that answer from a script, and a store in memory.

/** A verdict that passes `spec`, changed by `faults`. */
export const verdictFor = (spec: Spec, faults: Partial<Verdict> = {}): Verdict => ({
  garments: 1,
  type: spec.type,
  colours: [...spec.colours],
  person: false,
  text: false,
  hanger: false,
  cropped: false,
  notes: '',
  ...faults,
})

/** A painter that draws a few bytes and remembers every prompt; `fails` throws instead. */
const scriptedPainter = (fails?: () => Error) => {
  const prompts: Array<string> = []
  const painter: Painter = {
    paint: async (prompt) => {
      prompts.push(prompt)
      if (fails !== undefined) throw fails()
      return { bytes: new Uint8Array([137, 80, 78, 71]) }
    },
  }
  return { painter, prompts }
}

/** A judge that answers each look at a spec with the next of its verdicts, then with a pass. */
const scriptedJudge = (verdicts: ReadonlyMap<string, ReadonlyArray<Verdict>>, cost = 2500) => {
  const seen = new Map<string, number>()
  const judge: Judge = {
    name: 'spark',
    worst: 6000,
    judge: async (_png, spec) => {
      const index = seen.get(spec.id) ?? 0
      seen.set(spec.id, index + 1)
      return { verdict: verdicts.get(spec.id)?.[index] ?? verdictFor(spec), cost }
    },
  }
  return { judge, looks: (id: string) => seen.get(id) ?? 0 }
}

/** A store in memory. */
const memoryStore = () => {
  const records = new Map<string, GarmentRecord>()
  const pictures = new Map<string, Uint8Array>()
  const store: GarmentStore = {
    read: async (id) => records.get(id),
    write: async (record) => {
      records.set(record.id, record)
    },
    picture: async (file, png) => {
      pictures.set(file, png)
    },
    load: async (file) => pictures.get(file) ?? new Uint8Array(),
  }
  return { store, records, pictures }
}

/** The work of one test: scripted painter and judge, a ledger with `capUsd`, a memory store. */
export const scriptedWork = (verdicts: ReadonlyMap<string, ReadonlyArray<Verdict>> = new Map(), capUsd = 5) => {
  const painting = scriptedPainter()
  const judging = scriptedJudge(verdicts)
  const memory = memoryStore()
  const ledger = makeLedger([], capUsd * 1_000_000, async () => {})
  const work: GarmentWork = { painter: painting.painter, judge: judging.judge, ledger, store: memory.store }
  return { work, prompts: painting.prompts, looks: judging.looks, memory, ledger }
}

/** A spec for tests. */
export const specOf = (overrides: Partial<Spec> = {}): Spec => ({
  id: 'w-knitwear-white-navy',
  accounts: ['women'],
  type: 'knitwear',
  colours: ['white', 'navy'],
  pattern: 'striped',
  subcategory: 'Breton striped jumper',
  material: 'cotton knit',
  look: 'white with navy horizontal Breton stripes, visible knit texture',
  name: 'Breton stripe jumper, white and navy',
  ...overrides,
})
