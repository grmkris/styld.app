/**
 * The house garments and boards (owner, 4 November 2026; docs/PLAN-house-boards-2026-11-04.md), run by the operator.
 *
 *   bun --env-file=.env.preview.local tools/seed/Run.ts --manifest tools/seed/manifest.yaml \
 *     [--catalogue tools/seed/catalogue.yaml] [--dry-run | --test-batch | --full | --prune <seed id,…>] \
 *     [--max-usd 5] [--judge spark|clef] [--only <id,id>] [--regenerate <id,id>]
 *
 * With no mode it is `--dry-run`: no network at all; it prints the manifest, which pictures are cached and passed, what
 * the rest would cost, and with a catalogue every board's garments and operation, the publish order and the first of
 * What's new under each Show me. `--test-batch` generates and judges exactly the ten test-batch specs and stops before
 * any import, writing `tools/seed/.out/test-batch.html`. `--full` (only once the owner approved the test batch)
 * generates what the catalogue needs, imports it into the house accounts, seeds their profiles and boards and writes
 * `tools/seed/.out/report.md`. `--prune` takes the named seeded boards down. Every paid call goes through the ledger
 * (`tools/seed/.out/ledger.json`), which refuses the call that would pass `--max-usd` (default 5, across runs).
 * Meta's key is the operator's `META_MUSE_API_KEY`; the stage's are `STYLD_URL`, `STYLD_OPERATOR_TOKEN`,
 * `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and `R2_BUCKET` (and `STYLD_D1_DATABASE` for `--judge clef`).
 * Prints counts and ids, never keys.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { Schema } from 'effect'
import { parse } from 'yaml'
import { cloudflareStage } from '../CloudflareRest.ts'
import { required } from '../OperatorStage.ts'
import { Catalogue, catalogueFaults } from './Catalogue.ts'
import { fullRun, pruned, stageDeps } from './Full.ts'
import { folderStore, generateAll, type GarmentWork } from './Garments.ts'
import { clefJudge, type Judge, sparkJudge, sparkWorst } from './Gate.ts'
import { musePainter } from './Generate.ts'
import { dollars, Entries, makeLedger, prices } from './Ledger.ts'
import { type Manifest, manifestOf, type Spec, testBatch } from './Manifest.ts'
import { ipv6Fetch } from './MetaFetch.ts'
import { planOf } from './Plan.ts'
import { promptDigestOf } from './Prompt.ts'
import { batchSummary, planLines, summaryLines, testBatchPage } from './Report.ts'

const usage =
  'Usage: bun tools/seed/Run.ts --manifest <file> [--catalogue <file>] [--dry-run | --test-batch | --full | --prune <ids>] [--max-usd 5] [--judge spark|clef] [--only <id,id>] [--regenerate <id,id>]'

/** The command line, decoded. */
export interface Flags {
  readonly mode: 'dry-run' | 'test-batch' | 'full' | 'prune'
  readonly manifest: string
  readonly catalogue: string | undefined
  readonly maxUsd: number
  readonly judge: 'spark' | 'clef'
  readonly only: ReadonlyArray<string>
  readonly regenerate: ReadonlyArray<string>
  readonly prune: ReadonlyArray<string>
}

const listOf = (value: string | undefined) => (value === undefined ? [] : value.split(',').filter((id) => id !== ''))

const options = {
  manifest: { type: 'string' },
  catalogue: { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  'test-batch': { type: 'boolean', default: false },
  full: { type: 'boolean', default: false },
  prune: { type: 'string' },
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
  const modes = [values['dry-run'], values['test-batch'], values.full, values.prune !== undefined].filter(Boolean)
  if (modes.length > 1) throw new Error(`One mode at a time\n${usage}`)
  if (values.manifest === undefined) throw new Error(usage)
  if ((values.full || values.prune !== undefined) && values.catalogue === undefined)
    throw new Error(`--full and --prune need --catalogue\n${usage}`)
  const maxUsd = Number(values['max-usd'])
  if (!Number.isFinite(maxUsd) || maxUsd < 0) throw new Error(`--max-usd takes dollars\n${usage}`)
  const mode = values['test-batch']
    ? 'test-batch'
    : values.full
      ? 'full'
      : values.prune === undefined
        ? 'dry-run'
        : 'prune'
  return {
    mode,
    manifest: values.manifest,
    catalogue: values.catalogue,
    maxUsd,
    judge: judgeOfFlag(values.judge),
    only: listOf(values.only),
    regenerate: listOf(values.regenerate),
    prune: listOf(values.prune),
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

/** The paid work: Muse and the judge, charged to the ledger, with the cache under `.out/pieces`. */
const workOf = async (flags: Flags): Promise<GarmentWork> => {
  const key = required('META_MUSE_API_KEY')
  return {
    painter: musePainter(key, ipv6Fetch),
    judge: await judgeOf(flags, key),
    ledger: await readLedger(flags.maxUsd),
    store: folderStore(pieces),
  }
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
  const judgeTypical = 6000
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

const runTestBatch = async (manifest: Manifest, flags: Flags) => {
  const work = await workOf(flags)
  const records = await generateAll(testBatchSpecs(manifest, flags.only), work, flags.regenerate)
  const spend = { muse: work.ledger.byKind('muse'), judge: work.ledger.byKind('judge') }
  const lines = [`Judge: ${work.judge.name}`, ...summaryLines(batchSummary(records.map(({ record }) => record)), spend)]
  await writeFile(path.join(out, 'test-batch.html'), testBatchPage(records, lines))
  console.log([...lines, `Page: ${path.join(out, 'test-batch.html')}`].join('\n'))
}

/** The catalogue, decoded strictly; one that breaks a rule stops the run with every fault. */
const catalogueOf = async (file: string, manifest: Manifest) => {
  const catalogue = Schema.decodeUnknownSync(Catalogue)(parse(await readFile(file, 'utf8')), {
    onExcessProperty: 'error',
  })
  const faults = catalogueFaults(catalogue, manifest)
  if (faults.length > 0) throw new Error(`The catalogue breaks its rules:\n${faults.join('\n')}`)
  return catalogue
}

const dryRun = async (manifest: Manifest, flags: Flags) => {
  const passed = await Promise.all(manifest.specs.map(async (spec) => ((await cachedPass(spec)) ? [spec.id] : [])))
  console.log(dryRunLines(manifest, new Set(passed.flat()), flags).join('\n'))
  if (flags.catalogue !== undefined)
    console.log(planLines(planOf(await catalogueOf(flags.catalogue, manifest), manifest)).join('\n'))
}

if (import.meta.main) {
  const flags = flagsOf(process.argv.slice(2))
  const manifest = manifestOf(parse(await readFile(flags.manifest, 'utf8')))
  if (flags.mode === 'test-batch') await runTestBatch(manifest, flags)
  else if (flags.mode === 'dry-run' || flags.catalogue === undefined) await dryRun(manifest, flags)
  else {
    const catalogue = await catalogueOf(flags.catalogue, manifest)
    const work = await workOf(flags)
    const deps = stageDeps(work, pieces)
    if (flags.mode === 'prune') await pruned(deps, planOf(catalogue, manifest), flags.prune)
    else {
      const { file } = await fullRun({ catalogue, manifest, work, deps, regenerate: flags.regenerate, out })
      console.log(await readFile(file, 'utf8'))
    }
  }
}
