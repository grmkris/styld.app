import { Schema } from 'effect'

// What the seed's paid calls cost (owner, 4 November 2026: at most $5 for the whole run, `--max-usd`). Every paid call
// reserves its worst case first and is refused when that would pass the cap; once it answers, what it really cost
// replaces the reservation. A call that got no answer may have been taken and billed, so it stays charged at its worst
// case, as the Worker treats such a call (`providers/Call.ts`). The ledger is kept beside the cache, so the cap holds
// across runs: the test batch's spend counts against the full run's.

/** The kinds of spend: a Muse picture, a judge's look at it, and the server's cut-out and description of an imported
 * piece (an estimate: Styld pays those on the stage). */
export const SpendKind = Schema.Literals(['muse', 'judge', 'cutout'])
export type SpendKind = typeof SpendKind.Type

/** One paid call, in millionths of a dollar: its worst case while it runs, then what it cost. */
export const Entry = Schema.Struct({
  at: Schema.String,
  kind: SpendKind,
  ref: Schema.String,
  reserved: Schema.Int,
  /** None while the call runs, or when the run stopped before it answered (charged at `reserved`). */
  spent: Schema.NullOr(Schema.Int),
})
export type Entry = typeof Entry.Type

export const Entries = Schema.Array(Entry)

/** Prices in millionths of a dollar (`providers/Costs.ts` for Muse; Meta's Standard Spark prices, 4 November). */
export const prices = {
  musePerImage: 10_000,
  sparkPerInputToken: 1.25,
  sparkPerOutputToken: 4.25,
  /** The server's cut-out and description of one imported piece: Cloudflare transforms and Clef calls. */
  cutoutPerPiece: 2000,
} as const

/** The next call would take the run past its cap: the run stops before making it. */
export class CapReached extends Schema.TaggedError<CapReached>()('CapReached', {
  kind: SpendKind,
  ref: Schema.String,
  message: Schema.String,
}) {}

const capReached = (kind: SpendKind, ref: string, capMicroUsd: number) =>
  CapReached.make({
    kind,
    ref,
    message: `The next ${kind} call (${ref}) would pass the $${(capMicroUsd / 1_000_000).toFixed(2)} cap; stopping.`,
  })

const charged = (entry: Entry) => entry.spent ?? entry.reserved

/** Dollars, for people. */
export const dollars = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(3)}`

/** The ledger over `entries` with a cap, saving every change with `save` before the call it describes runs. */
export const makeLedger = (
  entries: ReadonlyArray<Entry>,
  capMicroUsd: number,
  save: (entries: ReadonlyArray<Entry>) => Promise<void>,
  now: () => Date = () => new Date(),
) => {
  const kept: Array<Entry> = [...entries]
  const total = () => kept.reduce((sum, entry) => sum + charged(entry), 0)
  const settle = async (index: number, spent: number) => {
    const entry = kept[index]
    if (entry !== undefined) kept[index] = { ...entry, spent }
    await save(kept)
  }
  return {
    /** Everything charged so far, across runs. */
    total,
    /** What each kind cost so far. */
    byKind: (kind: SpendKind) => kept.filter((entry) => entry.kind === kind).reduce((sum, e) => sum + charged(e), 0),
    /** Run one paid call within the cap: refused before it starts when its worst case would pass the cap; charged
     * `cost` of its answer, or `failed` of its failure (its worst case when it may have been billed). */
    paid: async <A>(
      call: { readonly kind: SpendKind; readonly ref: string; readonly worst: number },
      run: () => Promise<A>,
      cost: (answer: A) => number,
      failed: (error: unknown) => number,
    ): Promise<A> => {
      if (total() + call.worst > capMicroUsd) throw capReached(call.kind, call.ref, capMicroUsd)
      const index = kept.push({ at: now().toISOString(), ...call, reserved: call.worst, spent: null }) - 1
      await save(kept)
      try {
        const answer = await run()
        await settle(index, Math.ceil(cost(answer)))
        return answer
      } catch (error) {
        await settle(index, Math.ceil(failed(error)))
        throw error
      }
    },
  }
}

export type Ledger = ReturnType<typeof makeLedger>
