import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Schema } from 'effect'
import { failureOf, type Judge, judgeCharge, passes, Verdict } from './Gate.ts'
import { museCharge, type Painter } from './Generate.ts'
import { CapReached, type Ledger } from './Ledger.ts'
import type { Spec } from './Manifest.ts'
import { museModel, promptDigestOf, retryPromptOf, sizeOf } from './Prompt.ts'

// One garment per spec (owner, 4 November 2026): drawn, judged, and drawn again with what was wrong at most twice;
// after the third picture fails the spec is failed and its boards are skipped, never given another spec's picture.
// Every picture and verdict is kept (`tools/seed/.out/pieces/`, ignored by Git) the moment it exists, so a run that
// stops loses nothing it paid for, and a passing picture whose prompt is unchanged is never paid for again.

/** At most three pictures per spec: the first and two more. */
const mostAttempts = 3

const Attempt = Schema.Struct({
  file: Schema.String,
  prompt: Schema.String,
  verdict: Schema.NullOr(Verdict),
  judge: Schema.NullOr(Schema.Literals(['spark', 'clef'])),
  passed: Schema.Boolean,
  /** Why Muse drew nothing, when it did not. */
  error: Schema.NullOr(Schema.String),
})
type Attempt = typeof Attempt.Type

export const GarmentRecord = Schema.Struct({
  id: Schema.String,
  model: Schema.String,
  size: Schema.String,
  promptDigest: Schema.String,
  status: Schema.Literals(['passed', 'failed', 'open']),
  attempts: Schema.Array(Attempt),
})
export type GarmentRecord = typeof GarmentRecord.Type

/** Where pictures and their records are kept; a folder on disk, or memory in tests. */
export interface GarmentStore {
  readonly read: (id: string) => Promise<GarmentRecord | undefined>
  readonly write: (record: GarmentRecord) => Promise<void>
  readonly picture: (file: string, png: Uint8Array) => Promise<void>
  readonly load: (file: string) => Promise<Uint8Array>
}

/** The store under `folder`: `<id>.json` and `<id>-<attempt>.png`. */
export const folderStore = (folder: string): GarmentStore => ({
  read: async (id) => {
    const text = await readFile(path.join(folder, `${id}.json`), 'utf8').catch(() => undefined)
    return text === undefined ? undefined : Schema.decodeUnknownSync(Schema.fromJsonString(GarmentRecord))(text)
  },
  write: async (record) => {
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, `${record.id}.json`), `${JSON.stringify(record, undefined, 2)}\n`)
  },
  picture: async (file, png) => {
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, file), png)
  },
  load: async (file) => new Uint8Array(await readFile(path.join(folder, file))),
})

/** What one garment needs: who draws, who judges, the ledger the calls are charged to, and where results go. */
export interface GarmentWork {
  readonly painter: Painter
  readonly judge: Judge
  readonly ledger: Ledger
  readonly store: GarmentStore
}

/** The spec's record as it stands: its own when its prompt is unchanged and `fresh` is not asked, a new one otherwise. */
const startOf = async (spec: Spec, work: GarmentWork, fresh: boolean): Promise<GarmentRecord> => {
  const digest = promptDigestOf(spec)
  const kept = await work.store.read(spec.id)
  if (kept !== undefined && kept.promptDigest === digest && !fresh) return kept
  return { id: spec.id, model: museModel, size: sizeOf(spec.type), promptDigest: digest, status: 'open', attempts: [] }
}

/** Judge a kept picture, charged to the ledger. */
const judged = async (spec: Spec, work: GarmentWork, attempt: Attempt): Promise<Attempt> => {
  const png = await work.store.load(attempt.file)
  const { verdict } = await work.ledger.paid(
    { kind: 'judge', ref: spec.id, ...judgeCharge(work.judge) },
    () => work.judge.judge(png, spec),
    judgeCharge(work.judge).cost,
    judgeCharge(work.judge).failed,
  )
  return { ...attempt, verdict, judge: work.judge.name, passed: passes(verdict, spec) }
}

/** Draw the next picture, told what the last one got wrong, and keep it before it is judged. */
const drawn = async (spec: Spec, work: GarmentWork, record: GarmentRecord): Promise<Attempt> => {
  const last = record.attempts.at(-1)?.verdict
  const prompt = retryPromptOf(spec, last === undefined || last === null ? undefined : failureOf(last, spec))
  const file = `${spec.id}-${String(record.attempts.length + 1)}.png`
  const attempt: Attempt = { file, prompt, verdict: null, judge: null, passed: false, error: null }
  try {
    const picture = await work.ledger.paid(
      { kind: 'muse', ref: spec.id, worst: museCharge.worst },
      () => work.painter.paint(prompt, sizeOf(spec.type)),
      museCharge.cost,
      museCharge.failed,
    )
    await work.store.picture(file, picture.bytes)
    return attempt
  } catch (error) {
    if (!(error instanceof Error) || error instanceof CapReached) throw error
    return { ...attempt, file: '', error: error.message }
  }
}

/** The spec's garment: kept when it already passed, otherwise judged and drawn until it passes or has had three
 * pictures. Each step is saved as it happens. */
export const garmentFor = async (spec: Spec, work: GarmentWork, fresh = false): Promise<GarmentRecord> => {
  let record = await startOf(spec, work, fresh)
  const save = async (next: GarmentRecord) => {
    record = next
    await work.store.write(record)
  }
  while (record.status === 'open') {
    const last = record.attempts.at(-1)
    if (last !== undefined && last.verdict === null && last.error === null) {
      const seen = await judged(spec, work, last)
      await save({ ...record, attempts: [...record.attempts.slice(0, -1), seen] })
    } else if (last?.passed === true) await save({ ...record, status: 'passed' })
    else if (record.attempts.length >= mostAttempts) await save({ ...record, status: 'failed' })
    else await save({ ...record, attempts: [...record.attempts, await drawn(spec, work, record)] })
  }
  return record
}
