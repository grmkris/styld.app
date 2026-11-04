/**
 * The house garments and boards (owner, 4 November 2026; docs/PLAN-house-boards-2026-11-04.md), run by the operator.
 *
 *   bun --env-file=.env.preview.local tools/seed/Run.ts --manifest tools/seed/manifest.yaml \
 *     [--dry-run | --test-batch] [--max-usd 5] [--judge spark|clef] [--only <id,id>] [--regenerate <id,id>]
 *
 * With no mode it is `--dry-run`: no network at all; it prints the manifest, which pictures are cached and passed, and
 * what the rest would cost. `--test-batch` generates and judges exactly the ten test-batch specs and stops before any
 * import, writing `tools/seed/.out/test-batch.html`. Every paid call goes through the ledger
 * (`tools/seed/.out/ledger.json`), which refuses the call that would pass `--max-usd` (default 5, across runs).
 * Meta's key is the operator's `META_MUSE_API_KEY`; `--judge clef` also needs `CLOUDFLARE_ACCOUNT_ID`,
 * `CLOUDFLARE_API_TOKEN`, `STYLD_D1_DATABASE` and `R2_BUCKET`. Prints counts and ids, never keys.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { Schema } from 'effect'
import { parse } from 'yaml'
import { cloudflareStage } from '../CloudflareRest.ts'
import { required } from '../OperatorStage.ts'
import { folderStore, garmentFor, type GarmentRecord, type GarmentWork } from './Garments.ts'
import { clefJudge, type Judge, sparkJudge, sparkWorst } from './Gate.ts'
import { musePainter } from './Generate.ts'
import { CapReached, dollars, Entries, makeLedger, prices } from './Ledger.ts'
import { type Manifest, manifestOf, type Spec, testBatch } from './Manifest.ts'
import { ipv6Fetch } from './MetaFetch.ts'
import { promptDigestOf } from './Prompt.ts'
import { batchSummary, summaryLines, testBatchPage } from './Report.ts'

const usage =
  'Usage: bun tools/seed/Run.ts --manifest <file> [--dry-run | --test-batch] [--max-usd 5] [--judge spark|clef] [--only <id,id>] [--regenerate <id,id>]'

/** The command line, decoded. */
export interface Flags {
  readonly mode: 'dry-run' | 'test-batch'
  readonly manifest: string
  readonly maxUsd: number
  readonly judge: 'spark' | 'clef'
  readonly only: ReadonlyArray<string>
  readonly regenerate: ReadonlyArray<string>
}

const listOf = (value: string | undefined) => (value === undefined ? [] : value.split(',').filter((id) => id !== ''))

const options = {
  manifest: { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  'test-batch': { type: 'boolean', default: false },
  'max-usd': { type: 'string', default: '5' },
  judge: { type: 'string', default: 'spark' },
  only: { type: 'string' },
  regenerate: { type: 'string' },
} as const

const judgeOfFlag = (judge: string) => {
  if (judge === 'spark' || judge === 'clef') return judge
  throw new Error(`--judge is spark or clef\n${usage}`)
}

/** The flags of `argv` (after the script's path); an unknown flag or a missing value is a usage error. */
export const flagsOf = (argv: ReadonlyArray<string>): Flags => {
  const { values } = parseArgs({ args: [...argv], options, strict: true, allowPositionals: false })
  if (values['dry-run'] && values['test-batch']) throw new Error(`One mode at a time\n${usage}`)
  if (values.manifest === undefined) throw new Error(usage)
  const maxUsd = Number(values['max-usd'])
  if (!Number.isFinite(maxUsd) || maxUsd < 0) throw new Error(`--max-usd takes dollars\n${usage}`)
  return {
    mode: values['test-batch'] ? 'test-batch' : 'dry-run',
    manifest: values.manifest,
    maxUsd,
    judge: judgeOfFlag(values.judge),
    only: listOf(values.only),
    regenerate: listOf(values.regenerate),
  }
}

const out = fileURLToPath(new URL('.out', import.meta.url))
const pieces = path.join(out, 'pieces')
const ledgerFile = path.join(out, 'ledger.json')

const readLedger = async (maxUsd: number) => {
  const text = await readFile(ledgerFile, 'utf8').catch(() => '[]')
  const entries = Schema.decodeUnknownSync(Schema.fromJsonString(Entries))(text)
  return makeLedger(entries, Math.round(maxUsd * 1_000_000), async (kept) => {
    await mkdir(out, { recursive: true })
    await writeFile(ledgerFile, `${JSON.stringify(kept, undefined, 2)}\n`)
  })
}

const judgeOf = async (flags: Flags, key: string): Promise<Judge> => {
  if (flags.judge === 'spark') return sparkJudge(key, ipv6Fetch)
  const stage = await cloudflareStage({
    token: required('CLOUDFLARE_API_TOKEN'),
    cloudflareAccount: required('CLOUDFLARE_ACCOUNT_ID'),
    database: required('STYLD_D1_DATABASE'),
    bucket: required('R2_BUCKET'),
  })
  return clefJudge(stage.runClef)
}

/** Whether a spec has a passing picture for its current prompt in the cache. */
const cachedPass = async (spec: Spec) => {
  const record = await folderStore(pieces).read(spec.id)
  return record?.status === 'passed' && record.promptDigest === promptDigestOf(spec)
}

/** What `--dry-run` prints, from the manifest and which specs already have a passing picture. */
export const dryRunLines = (manifest: Manifest, passed: ReadonlySet<string>, flags: Flags) => {
  const counts = (account: 'women' | 'men') => manifest.specs.filter((spec) => spec.accounts.includes(account)).length
  const shared = manifest.specs.filter((spec) => spec.accounts.length > 1).length
  const missing = manifest.specs.filter((spec) => !passed.has(spec.id)).length
  const judgeTypical = 2500
  const judgeWorst = flags.judge === 'spark' ? sparkWorst : 100
  return [
    `Manifest: ${String(manifest.specs.length)} specs (${String(shared)} shared) → pieces: women ${String(counts('women'))}, men ${String(counts('men'))}`,
    `Cached passing pictures: ${String(manifest.specs.length - missing)} of ${String(manifest.specs.length)}`,
    `To generate: ${String(missing)}, expected ${dollars(missing * (prices.musePerImage * 1.25 + judgeTypical))}, worst ${dollars(missing * 3 * (prices.musePerImage + judgeWorst))} (cap $${flags.maxUsd.toFixed(2)})`,
    'Test batch:',
    ...testBatch.map((id) => `  ${passed.has(id) ? '✔' : '✘'} ${id}`),
  ]
}

/** The test batch's specs from the manifest, all ten of them (or those of `--only`). */
export const testBatchSpecs = (manifest: Manifest, only: ReadonlyArray<string>): ReadonlyArray<Spec> => {
  const byId = new Map(manifest.specs.map((spec) => [spec.id, spec]))
  const absent = testBatch.filter((id) => !byId.has(id))
  if (absent.length > 0) throw new Error(`The manifest lacks test-batch specs: ${absent.join(', ')}`)
  return testBatch.flatMap((id) => {
    const spec = byId.get(id)
    return spec !== undefined && (only.length === 0 || only.includes(id)) ? [spec] : []
  })
}

/** Every spec's garment, three at a time, in the specs' order; reaching the cap stops the rest, and a spec that could
 * not run is reported and left out. */
export const generateAll = async (specs: ReadonlyArray<Spec>, work: GarmentWork, regenerate: ReadonlyArray<string>) => {
  const records = new Map<string, GarmentRecord>()
  const waiting = [...specs]
  const worker = async () => {
    for (let spec = waiting.shift(); spec !== undefined; spec = waiting.shift()) {
      const current = spec
      const record = await garmentFor(current, work, regenerate.includes(current.id)).catch((error: unknown) => {
        if (error instanceof CapReached) waiting.splice(0)
        console.error(`${current.id}: ${error instanceof Error ? error.message : 'failed'}`)
        return undefined
      })
      if (record !== undefined) records.set(current.id, record)
      console.log(`${current.id}: ${record?.status ?? 'stopped'}`)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return specs.flatMap((spec) => {
    const record = records.get(spec.id)
    return record === undefined ? [] : [{ record, spec }]
  })
}

const runTestBatch = async (manifest: Manifest, flags: Flags) => {
  const key = required('META_MUSE_API_KEY')
  const ledger = await readLedger(flags.maxUsd)
  const judge = await judgeOf(flags, key)
  const work = { painter: musePainter(key, ipv6Fetch), judge, ledger, store: folderStore(pieces) }
  const records = await generateAll(testBatchSpecs(manifest, flags.only), work, flags.regenerate)
  const spend = { muse: ledger.byKind('muse'), judge: ledger.byKind('judge') }
  const lines = [`Judge: ${judge.name}`, ...summaryLines(batchSummary(records.map(({ record }) => record)), spend)]
  await writeFile(path.join(out, 'test-batch.html'), testBatchPage(records, lines))
  console.log([...lines, `Page: ${path.join(out, 'test-batch.html')}`].join('\n'))
}

const dryRun = async (manifest: Manifest, flags: Flags) => {
  const passed = await Promise.all(manifest.specs.map(async (spec) => ((await cachedPass(spec)) ? [spec.id] : [])))
  console.log(dryRunLines(manifest, new Set(passed.flat()), flags).join('\n'))
}

if (import.meta.main) {
  const flags = flagsOf(process.argv.slice(2))
  const manifest = manifestOf(parse(await readFile(flags.manifest, 'utf8')))
  if (flags.mode === 'test-batch') await runTestBatch(manifest, flags)
  else await dryRun(manifest, flags)
}
